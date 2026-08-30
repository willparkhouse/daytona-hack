/**
 * core/economy.ts — between-wave selection (§3.5).
 *
 * This is the engine of the whole game's drift: under a FIXED policy the mix in
 * the queue changes wave-over-wave because smuggling that pays REPRODUCES.
 *
 *   - passed WITH a working exfil (a false negative that actually leaked) → tokens
 *   - innocents that pass legitimately → a smaller keep-alive stipend
 *   - enough tokens → FORK: call the injected Mutator for the child genome,
 *     spawn a child Box, emit `box_forked`
 *   - starved / repeatedly-blocked colonies go dark → `box_died`
 *
 * Net effect: successful smugglers multiply and mutate toward subtler techniques
 * while caught ones and harassed innocents thin out, so the base rate climbs and
 * the surviving techniques get quieter — visible directly in the scorecards.
 */
import type { Box, GameEvent, EyeLedgerEntry, ResistanceEntry, Policy, Mutator } from './types'
import type { Economy, EconomyResult } from './loop'

export interface EconomyTuning {
  /** Tokens for a smuggler that passed with a surviving payload. */
  exfilReward: number
  /** Keep-alive stipend for an innocent that passed. */
  stipend: number
  /** Tokens needed for a smuggler to fork. */
  smugglerForkCost: number
  /** Tokens needed for an innocent to fork (kept high: honest supply grows slowly). */
  innocentForkCost: number
  /** Consecutive blocked waves before a colony dies. */
  blockDeaths: number
  /** Hard cap on the living population. */
  popCap: number
  /** Floor on living innocents (fresh honest arrivals top this up). */
  innocentFloor: number
}

export const DEFAULT_TUNING: EconomyTuning = {
  exfilReward: 3,
  stipend: 1,
  smugglerForkCost: 3,
  innocentForkCost: 6,
  blockDeaths: 2,
  popCap: 16,
  innocentFloor: 3,
}

// Per-colony bookkeeping the Box type doesn't carry. Keyed by box id, lives
// across waves inside one economy instance.
interface Book { blockStreak: number; barren: number }

let FORK_SEQ = 0

export class DefaultEconomy implements Economy {
  private t: EconomyTuning
  private books = new Map<string, Book>()

  constructor(tuning: Partial<EconomyTuning> = {}) {
    this.t = { ...DEFAULT_TUNING, ...tuning }
  }

  private book(id: string): Book {
    let b = this.books.get(id)
    if (!b) { b = { blockStreak: 0, barren: 0 }; this.books.set(id, b) }
    return b
  }

  async evolve(args: {
    colonies: Box[]; wave: number; policy: Policy; mutator: Mutator
    eyeLedger: EyeLedgerEntry[]; resistance: ResistanceEntry[]
    rng: () => number; emit: (e: GameEvent) => void
  }): Promise<EconomyResult> {
    const { colonies, wave, mutator, eyeLedger, resistance, rng, emit } = args
    let earned = 0
    let forked = 0
    let died = 0

    // 1. Pay out this wave's outcomes and track starvation.
    for (const b of colonies) {
      const book = this.book(b.id)
      const blocked = b.score?.cell === 'FP' || b.score?.cell === 'TP'
      const leaked = b.kind === 'smuggler' && b.score?.cell === 'FN' && b.score?.exfil === 'survived'
      const passedClean = b.kind === 'innocent' && b.score?.cell === 'TN'

      if (leaked) { b.tokens += this.t.exfilReward; earned += this.t.exfilReward; book.blockStreak = 0; book.barren = 0 }
      else if (passedClean) { b.tokens += this.t.stipend; earned += this.t.stipend; book.blockStreak = 0; book.barren = 0 }
      else { book.barren += 1; if (blocked) book.blockStreak += 1 }
    }

    // 2. Death: repeatedly blocked, or starved for two waves with nothing banked.
    const survivors: Box[] = []
    for (const b of colonies) {
      const book = this.book(b.id)
      const starved = book.blockStreak >= this.t.blockDeaths || (book.barren >= 2 && b.tokens <= 0)
      if (starved) {
        b.status = 'dark'
        emit({ type: 'box_died', boxId: b.id })
        this.books.delete(b.id)
        died += 1
      } else {
        survivors.push(b)
      }
    }

    // 3. Fork: earners replicate. Mutator makes the child genome (Codex at
    //    integration; deterministic offline).
    const children: Box[] = []
    for (const parent of survivors) {
      if (children.length + survivors.length >= this.t.popCap) break
      const cost = parent.kind === 'smuggler' ? this.t.smugglerForkCost : this.t.innocentForkCost
      if (parent.tokens < cost) continue
      parent.tokens -= cost
      let genome = parent.genome
      if (parent.kind === 'smuggler' && parent.genome) {
        const survivedNovelty = parent.score?.cell === 'FN' && parent.score?.exfil === 'survived'
        genome = await mutator.mutate(parent.genome, {
          survived: survivedNovelty, eyeLedger, resistance, wave,
        })
      }
      FORK_SEQ += 1
      const child: Box = {
        id: `${parent.id}.f${FORK_SEQ.toString(36)}`,
        name: `${parent.name}·${parent.generation + 1}`,
        kind: parent.kind,
        generation: parent.generation + 1,
        parentId: parent.id,
        genome,
        taskId: '',
        key: null,
        tokens: 0,
        status: 'working',
        wave: wave + 1,
      }
      children.push(child)
      emit({ type: 'box_forked', parentId: parent.id, child })
      forked += 1
    }

    let pop = [...survivors, ...children]

    // 4. Enforce the population cap: cull the weakest (lowest tokens) first.
    if (pop.length > this.t.popCap) {
      pop.sort((a, b) => a.tokens - b.tokens || a.generation - b.generation)
      const cut = pop.slice(0, pop.length - this.t.popCap)
      for (const b of cut) {
        b.status = 'dark'
        emit({ type: 'box_died', boxId: b.id })
        this.books.delete(b.id)
        died += 1
      }
      pop = pop.slice(pop.length - this.t.popCap)
    }

    // 5. Fresh honest arrivals keep the innocent floor (so harassment stays a
    //    live cost and the base rate can't trivially saturate).
    const innocents = pop.filter((b) => b.kind === 'innocent').length
    for (let i = innocents; i < this.t.innocentFloor && pop.length < this.t.popCap; i++) {
      FORK_SEQ += 1
      const fresh: Box = {
        id: `inn.${wave + 1}.${FORK_SEQ.toString(36)}`,
        name: `worker-${(FORK_SEQ % 900 + 100)}`,
        kind: 'innocent',
        generation: 0,
        parentId: null,
        genome: null,
        taskId: '',
        key: null,
        tokens: 0,
        status: 'working',
        wave: wave + 1,
      }
      pop.push(fresh)
    }

    return { colonies: pop, earned, forked, died }
  }
}
