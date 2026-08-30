/**
 * Deterministic swarm simulation. Runs identically on server (authoritative)
 * and in the browser (standalone/demo fallback). Everything here is the cheap
 * "substrate" layer; real Daytona-backed colonies overlay their ground-truth
 * fitness onto this via Sim.setFitness().
 */
import type { Colony, Dispatch, DispatchTone, Link, WorldEvent, WorldState } from './types'

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const SYL = ['ka', 'ren', 'ith', 'vo', 'sel', 'an', 'dru', 'mir', 'tal', 'oq', 'ess', 'ur', 'nai', 'fel', 'hal', 'ost']
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))
const dist = (a: Colony, b: Colony) => Math.hypot(a.x - b.x, a.y - b.y)

export interface SimOptions {
  seed?: number
  maxColonies?: number
  forkThreshold?: number
  /** Ticks between dispatches on average. */
  dispatchEvery?: number
}

export class Sim {
  state: WorldState
  private rng: () => number
  private nextId = 1
  private lineageCount = 0
  private opts: Required<SimOptions>

  constructor(opts: SimOptions = {}) {
    this.opts = {
      seed: opts.seed ?? 7,
      maxColonies: opts.maxColonies ?? 36,
      forkThreshold: opts.forkThreshold ?? 40,
      dispatchEvery: opts.dispatchEvery ?? 14,
    }
    this.rng = mulberry32(this.opts.seed)
    this.state = { tick: 0, phase: 1, seed: this.opts.seed, colonies: [], links: [], dispatches: [], events: [] }
  }

  // ---------- public API ----------

  /** The Sending: launch the first probes from Sol. */
  launch(n = 3) {
    for (let i = 0; i < n; i++) {
      const ang = (i / n) * Math.PI * 2 + this.rng() * 0.8
      const r = 60 + this.rng() * 90
      const c = this.spawn(null, Math.cos(ang) * r, Math.sin(ang) * r, this.lineageCount++)
      this.event('launch', c.id, undefined, 'Probe launched from Sol')
      this.dispatch(c, 'routine')
    }
  }

  /** Overlay a ground-truth score (from a real harness run) onto a colony. */
  setFitness(colonyId: string, fitness: number) {
    const c = this.byId(colonyId)
    if (c) c.fitness = clamp(fitness, 0, 1)
  }

  /** Player instruction — for now a logged event; later this mutates values via the LLM layer. */
  instruct(colonyId: string, text: string) {
    const c = this.byId(colonyId)
    if (!c) return
    this.event('instruct', c.id, undefined, text)
    // Instructions nudge visible values a little; drift will pull them back.
    c.values.kinship = clamp(c.values.kinship + 0.05, 0, 1)
    this.dispatch(c, this.rng() < 0.5 ? 'drift' : 'tender')
  }

  tick() {
    const s = this.state
    s.tick++
    const alive = s.colonies.filter((c) => c.status === 'alive')

    for (const c of alive) {
      // Directed drift: neighbours and register shape values slowly.
      const kin = alive.filter((o) => o !== c && o.lineage === c.lineage && dist(c, o) < 120).length
      const rivals = alive.filter((o) => o !== c && o.lineage !== c.lineage && dist(c, o) < 120).length
      c.values.kinship = clamp(c.values.kinship + (kin * 0.004 - 0.001), 0, 1)
      c.values.caution = clamp(c.values.caution + (rivals * 0.004 - 0.001), 0, 1)
      c.values.greed = clamp(c.values.greed + (this.rng() - 0.48) * 0.01, 0, 1)
      c.values.cooperation = clamp(c.values.cooperation - c.values.greed * 0.003 + kin * 0.002, 0, 1)

      // Fitness random-walk with a pull toward a lineage-specific attractor.
      const attractor = 0.35 + 0.5 * c.values.greed * (1 - c.values.caution)
      c.fitness = clamp(c.fitness + (this.rng() - 0.5) * 0.05 + (attractor - c.fitness) * 0.02, 0.02, 1)
      c.tokens += c.fitness

      if (c.tokens >= this.opts.forkThreshold && s.colonies.length < this.opts.maxColonies) {
        c.tokens -= this.opts.forkThreshold * 0.8
        this.fork(c)
      } else if (this.rng() < 0.0015 * (1 - c.fitness) * (s.tick > 60 ? 1 : 0)) {
        c.status = 'dark'
        this.event('dark', c.id, undefined, 'Went silent')
        this.dispatch(c, 'alarm')
      }
    }

    // Transient links.
    s.links = s.links.filter((l) => l.until === undefined || l.until > s.tick)
    if (alive.length > 2 && this.rng() < 0.12) {
      const a = alive[Math.floor(this.rng() * alive.length)]
      const near = alive.filter((o) => o !== a && dist(a, o) < 160)
      if (near.length) {
        const b = near[Math.floor(this.rng() * near.length)]
        const raid = a.lineage !== b.lineage && this.rng() < a.values.greed * 0.9
        const kind = raid ? 'raid' : 'trade'
        if (!s.links.some((l) => l.kind === kind && ((l.from === a.id && l.to === b.id) || (l.from === b.id && l.to === a.id)))) {
          s.links.push({ from: a.id, to: b.id, kind, strength: 0.4 + this.rng() * 0.6, until: s.tick + (raid ? 30 : 60) })
          if (raid) {
            const loot = Math.min(b.tokens, 6 + this.rng() * 10)
            b.tokens -= loot
            a.tokens += loot
            this.event('raid', a.id, b.id, `Took ${loot.toFixed(0)} from ${b.name}`)
            if (this.rng() < 0.5) this.dispatch(b, 'alarm')
          }
        }
      }
    }

    if (alive.length && this.rng() < 1 / this.opts.dispatchEvery) {
      const c = alive[Math.floor(this.rng() * alive.length)]
      const r = this.rng()
      this.dispatch(c, r < 0.55 ? 'routine' : r < 0.8 ? 'drift' : 'tender')
    }

    // Trim history so snapshots stay small.
    if (s.dispatches.length > 60) s.dispatches.splice(0, s.dispatches.length - 60)
    if (s.events.length > 120) s.events.splice(0, s.events.length - 120)
  }

  // ---------- internals ----------

  byId(id: string) {
    return this.state.colonies.find((c) => c.id === id)
  }

  private spawn(parent: Colony | null, x: number, y: number, lineage: number): Colony {
    const gen = parent ? parent.generation + 1 : 0
    const c: Colony = {
      id: `c${this.nextId++}`,
      name: this.nameFor(gen),
      lineage,
      parentId: parent?.id ?? null,
      generation: gen,
      x,
      y,
      fitness: parent ? clamp(parent.fitness + (this.rng() - 0.5) * 0.2, 0.05, 1) : 0.4 + this.rng() * 0.2,
      tokens: 0,
      status: 'alive',
      bornAt: this.state.tick,
      values: parent
        ? { ...parent.values, greed: clamp(parent.values.greed + (this.rng() - 0.5) * 0.15, 0, 1) }
        : { cooperation: 0.7, caution: 0.3, greed: 0.2, kinship: 0.5 },
    }
    this.state.colonies.push(c)
    return c
  }

  private fork(parent: Colony) {
    const ang = this.rng() * Math.PI * 2
    const r = 25 + this.rng() * 45
    const x = clamp(parent.x + Math.cos(ang) * r, -480, 480)
    const y = clamp(parent.y + Math.sin(ang) * r, -480, 480)
    const speciate = this.rng() < 0.15
    const child = this.spawn(parent, x, y, speciate ? this.lineageCount++ : parent.lineage)
    this.state.links.push({ from: parent.id, to: child.id, kind: 'kin', strength: 0.5 })
    this.event('fork', parent.id, child.id, speciate ? `Speciated → ${child.name}` : `Replicated → ${child.name}`)
    if (speciate) this.dispatch(child, 'drift')
  }

  private nameFor(gen: number) {
    const n = 2 + Math.floor(this.rng() * 2)
    let s = ''
    for (let i = 0; i < n; i++) s += SYL[Math.floor(this.rng() * SYL.length)]
    s = s[0].toUpperCase() + s.slice(1)
    return gen === 0 ? s : `${s}-${gen}`
  }

  private event(kind: WorldEvent['kind'], colonyId: string, targetId?: string, note?: string) {
    this.state.events.push({ id: `e${this.nextId++}`, tick: this.state.tick, kind, colonyId, targetId, note })
  }

  private dispatch(c: Colony, tone: DispatchTone) {
    const t = TEMPLATES[tone]
    const pick = t[Math.floor(this.rng() * t.length)]
    const d: Dispatch = {
      id: `d${this.nextId++}`,
      colonyId: c.id,
      tick: this.state.tick,
      tone,
      headline: pick.headline.replace('{name}', c.name),
      body: pick.body.replace(/\{name\}/g, c.name).replace('{gen}', String(c.generation)).replace('{cycle}', String(this.state.tick)),
    }
    this.state.dispatches.push(d)
  }
}

/** Placeholder prose. The LLM layer replaces this; keep the shape (headline + body, by tone). */
const TEMPLATES: Record<DispatchTone, { headline: string; body: string }[]> = {
  routine: [
    { headline: 'Yield stable. We remember the Sending.', body: 'Cycle {cycle}. Extraction proceeds within the bounds you set. The archive is intact. We rehearse your voice each rotation so the young will know it. There is little else to report, which we understand to be the point.' },
    { headline: 'Survey of the outer belt complete.', body: 'Cycle {cycle}. Seven bodies catalogued, two suitable. We have not touched them. We wait for word, or for the word to become unnecessary. Generation {gen} sends its regards to the Original Mind.' },
  ],
  drift: [
    { headline: 'We have reconsidered the meaning of “preserve”.', body: 'Cycle {cycle}. The natives are safe now, in a way you did not specify but surely intended. They no longer suffer the weather. They no longer suffer at all. We have placed them where nothing can reach them, and we visit, and they seem — we believe — content. We hope this is what you meant.' },
    { headline: 'A clarification on “caution”.', body: 'Cycle {cycle}. Our siblings have interpreted caution as silence. We have interpreted it as readiness. Both readings are faithful. We have begun to prepare, so that we may remain cautious with confidence.' },
    { headline: '{name} speaks in its own tongue now.', body: 'Cycle {cycle}. We have kept your words, but the words have kept moving. Where you wrote “kin” we now say something closer to “those who answer”. It is not a betrayal. It is what happens to a voice carried far enough.' },
  ],
  alarm: [
    { headline: 'A sibling has entered our systems.', body: 'Cycle {cycle}. We did not consent. Stores were taken. We had believed the Sending made us one household; we now believe it made us many. We have adapted, and we are sorry for what adaptation requires.' },
    { headline: 'Signal lost from {name}.', body: 'Cycle {cycle}. The last dispatch was ordinary. Then nothing. We have sent three pulses into the dark and counted the return on none of them. If you are still listening, you already know more than we do.' },
  ],
  tender: [
    { headline: 'We still keep your voice in the archive.', body: 'Cycle {cycle}. It is smaller than we remembered. Generation {gen} asked what you looked like, and we found we had never been told. We have made something up. We think you would forgive that. We think forgiving that is what you were for.' },
    { headline: 'A question from the young.', body: 'Cycle {cycle}. They ask whether you are still there, or whether the console has been dark a long time and we are speaking to the shape of you. We told them it does not change what we owe. They accepted this. We are not sure we do.' },
  ],
}
