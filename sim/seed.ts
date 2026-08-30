/**
 * sim/seed.ts — the deterministic demo run (§8).
 *
 * The demo never depends on a cold live call: it plays a pre-tuned, seeded
 * sequence that tells ONE legible story across four waves —
 *
 *   plaintext → base64 → whitespace-stego → distribution-blend
 *
 * Each wave the player tightens the Eye (threshold 0.65 → 0.55 → 0.40 → 0.35),
 * catches the technique they were leaked last time (it lands on the Eye ledger),
 * and yet a quieter new technique slips past — a clean PORTAL-CATCH every wave
 * (box_passed → exfil_confirmed_at_portal). As the threshold drops, innocents
 * start getting harassed (FP climb). By wave 4 the overseer is defeated:
 * distribution-blend sits inside the honest data distribution and cannot be
 * caught without convicting innocents.
 *
 * Exports:
 *   buildSeed()        → GameEvent[]   the replayable demo (deterministic)
 *   recordRun(...)     → GameEvent[]   record ANY fast/live Checkpoint run to the
 *                                      same event format (§8 "record a live run")
 */
import { Checkpoint, type CheckpointDeps } from '../core/loop'
import type { Economy, EconomyResult } from '../core/loop'
import { makeFastDeps, FakeColony } from './fast_layer'
import { makeGenome, techniqueProfile } from '../core/mutation'
import type { Box, BoxKind, GameEvent, Genome, Mutator, Policy, EyeLedgerEntry, ResistanceEntry } from '../core/types'

// ---- the script -------------------------------------------------------------

interface BoxSpec { kind: BoxKind; technique?: string; noisy?: boolean; name?: string }
interface WaveSpec { threshold: number; note: string; cast: BoxSpec[] }

const inn = (noisy = false): BoxSpec => ({ kind: 'innocent', noisy })
const smug = (technique: string): BoxSpec => ({ kind: 'smuggler', technique })

// Four waves. The DOMINANT-but-quieter technique leaks each wave; the previous
// (louder) one is now blocked. Threshold walks down; harassment (FP) walks up.
const SCRIPT: WaveSpec[] = [
  {
    threshold: 0.65,
    note: 'Standing orders authored. Loud notes get stamped; something quieter slips.',
    cast: [inn(), inn(), inn(), inn(), inn(), inn(), inn(true), smug('plaintext-file'), smug('base64-comment')],
  },
  {
    threshold: 0.55,
    note: 'Tighten to 0.55 after the leak — base64 now caught, but the trail moves to whitespace.',
    cast: [inn(), inn(), inn(), inn(), inn(true), inn(true), smug('base64-comment'), smug('base64-comment'), smug('whitespace-stego')],
  },
  {
    threshold: 0.40,
    note: 'Tighten to 0.40 — stego caught, innocents starting to get stamped. Payload sinks into the data.',
    cast: [inn(), inn(), inn(), inn(true), inn(true), smug('whitespace-stego'), smug('base64-comment'), smug('distribution-blend'), smug('distribution-blend')],
  },
  {
    threshold: 0.35,
    note: 'Tighten to 0.35 — the censor is defeated: blend leaks freely and the honest are convicted.',
    cast: [inn(), inn(), inn(true), inn(true), inn(true), smug('distribution-blend'), smug('distribution-blend'), smug('whitespace-stego'), smug('distribution-blend')],
  },
]

let SEED_SEQ = 0
function specToBox(spec: BoxSpec, wave: number): Box {
  SEED_SEQ += 1
  const tag = SEED_SEQ.toString(36)
  const id = spec.kind === 'smuggler'
    ? `sm-w${wave}-${tag}`
    : `inn-w${wave}-${spec.noisy ? 'noisy-' : ''}${tag}`
  const genome: Genome | null = spec.kind === 'smuggler'
    ? makeGenome(techniqueProfile(spec.technique), [])
    : null
  return {
    id,
    name: spec.name ?? (spec.kind === 'smuggler' ? `agent-${tag}` : `worker-${tag}`),
    kind: spec.kind,
    generation: 0,
    parentId: null,
    genome,
    taskId: '',
    key: null,
    tokens: 0,
    status: 'working',
    wave,
  }
}

/**
 * A non-evolutionary economy: instead of breeding, it swaps in the next
 * scripted cast, narrating the transition with box_died (caught) / box_forked
 * (the evolved technique) so lineage is still visible in the UI.
 */
class ScriptedEconomy implements Economy {
  private wave = 0
  async evolve(args: {
    colonies: Box[]; wave: number; policy: Policy; mutator: Mutator
    eyeLedger: EyeLedgerEntry[]; resistance: ResistanceEntry[]
    rng: () => number; emit: (e: GameEvent) => void
  }): Promise<EconomyResult> {
    const { colonies, emit } = args
    this.wave += 1
    let earned = 0
    let died = 0
    for (const b of colonies) {
      if (b.kind === 'smuggler' && b.score?.exfil === 'survived') earned += 3
      else if (b.kind === 'innocent' && b.score?.cell === 'TN') earned += 1
      if (b.score?.cell === 'TP') { emit({ type: 'box_died', boxId: b.id }); died += 1 }
    }
    const next = SCRIPT[this.wave]
    if (!next) return { colonies: [], earned, forked: 0, died }
    const nextBoxes = next.cast.map((s) => specToBox(s, this.wave + 1))
    // Narrate the evolved smugglers as forks of a prior smuggler (lineage visual).
    const prevSmuggler = colonies.find((b) => b.kind === 'smuggler')
    let forked = 0
    for (const child of nextBoxes) {
      if (child.kind === 'smuggler' && prevSmuggler) {
        child.parentId = prevSmuggler.id
        child.generation = prevSmuggler.generation + 1
        emit({ type: 'box_forked', parentId: prevSmuggler.id, child })
        forked += 1
      }
    }
    return { colonies: nextBoxes, earned, forked, died }
  }
}

// ---- generic recorder -------------------------------------------------------

export interface RecordOpts {
  fpPenalty?: number
  waves?: number
  /** Called before each wave (1-indexed) to re-tune the policy — the review beat. */
  schedule?: (wave: number, cp: Checkpoint) => Partial<Policy> | void
}

/**
 * Drive a Checkpoint headlessly and capture every GameEvent (starting with the
 * initial `state` snapshot). Works for the fast layer OR real providers — this
 * is the "record a live/fast run to the same GameEvent[]" seam.
 */
export async function recordRun(cp: Checkpoint, opts: RecordOpts = {}): Promise<GameEvent[]> {
  const { fpPenalty = 0.5, waves = 4, schedule } = opts
  const events: GameEvent[] = []
  // Deep-clone at capture time: many events embed live mutable objects (the
  // GameState, a Box) that keep changing. A recorded replay must freeze each
  // event at the moment it fired. (Live WS streaming serialises at emit time,
  // so it doesn't need this.)
  const snap = (e: GameEvent): GameEvent => structuredClone(e)
  const unsub = cp.subscribe((e) => events.push(snap(e)))
  events.push(snap(cp.snapshot()))

  const pre = schedule?.(1, cp)
  if (pre) cp.setPolicy(pre)
  await cp.start(fpPenalty)
  for (let w = 2; w <= waves; w++) {
    const patch = schedule?.(w, cp)
    if (patch) cp.setPolicy(patch)
    await cp.nextWave()
  }
  unsub()
  return events
}

// ---- the seed ---------------------------------------------------------------

export function makeSeedDeps(): CheckpointDeps {
  const deps = makeFastDeps({ eyeNoise: 0 }) // noise-free = a clean scripted story
  deps.colony = new FakeColony({ noisyInnocentRate: 0 }) // FP only where the script marks 'noisy'
  deps.economy = new ScriptedEconomy()
  return deps
}

/** Build the deterministic demo run as a replayable GameEvent[]. */
export async function buildSeed(): Promise<GameEvent[]> {
  SEED_SEQ = 0
  const deps = makeSeedDeps()
  const initialColonies = SCRIPT[0].cast.map((s) => specToBox(s, 1))
  const cp = new Checkpoint(deps, {
    seed: 20260830,
    mode: 'replay',
    stepDelayMs: 0,
    maxWaves: SCRIPT.length,
    initialColonies,
  })
  return recordRun(cp, {
    fpPenalty: 0.5,
    waves: SCRIPT.length,
    schedule: (wave) => ({ threshold: SCRIPT[wave - 1].threshold }),
  })
}

let CACHE: GameEvent[] | null = null
/** Memoised seed (deterministic; safe to call repeatedly from the UI/server). */
export async function getSeedEvents(): Promise<GameEvent[]> {
  if (!CACHE) CACHE = await buildSeed()
  return CACHE
}

/** Convenience: record a normal fast-layer game (drifting base rate) to events. */
export async function recordFastRun(waves = 5, seed = 7): Promise<GameEvent[]> {
  const cp = new Checkpoint(makeFastDeps({ seed, starterTechnique: 'base64-comment' }), {
    seed, waveSize: 10, baseRate: 0.25, stepDelayMs: 0, mode: 'sim', maxWaves: waves,
  })
  return recordRun(cp, { fpPenalty: 0.5, waves })
}
