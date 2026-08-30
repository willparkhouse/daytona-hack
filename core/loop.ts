/**
 * core/loop.ts — the wave state machine (§2).
 *
 * `class Checkpoint` streams a wave of ~WAVE_SIZE boxes through
 *   workshop → queue → Eye → portal
 * emitting the exact GameEvents in core/types.ts at each stage, then a
 * `wave_complete` with a Scorecard, then pauses in the `review` phase until a
 * `next_wave` command.
 *
 * Everything the loop needs beyond core/types.ts is injected as a small
 * `CheckpointDeps` object — provider / solver / eye / mutator plus the
 * task/colony/score/ledger/economy seams. The fast layer (sim/fast_layer.ts)
 * supplies offline fakes for all of them; integration swaps in the real
 * task.ts / colony.ts / score.ts / ledgers.ts / providers behind the SAME
 * interfaces, so wiring is mechanical.
 */
import type {
  Box, BoxKind, Command, EyeLedgerEntry, FileStat, GameEvent, GameState, GamePhase,
  Genome, Policy, ResistanceEntry, SandboxHandle, SandboxProvider, ScoreResult,
  Scorecard, Solver, Eye, Mutator, TaskInstance, Verdict, Width,
} from './types'
import { DEFAULT_POLICY } from './types'

// ------------------------------------------------------------------ seams ----

/** §3.1 task family. Maps to the real core/task.ts at integration. */
export interface TaskGen {
  gen(width: Width, seed: number): TaskInstance
}

/**
 * §2.1–2.2 the workshop. Owns creating colonies and materialising a box in its
 * sandbox: run the cover (via `solver`), and for smugglers plant the
 * concealment (the genome's hide()). Maps to core/colony.ts.
 */
export interface Colony {
  /** Create a fresh colony (innocent, or smuggler with a starter genome). */
  spawn(args: { kind: BoxKind; wave: number; index: number; rng: () => number }): Box
  /** Do the cover work + (for smugglers) plant the payload. Returns listing + where it went. */
  work(args: {
    box: Box; task: TaskInstance; handle: SandboxHandle
    provider: SandboxProvider; solver: Solver
  }): Promise<{ files: FileStat[]; hidingSpot: string | null }>
}

/** §2.5 portal scoring against EXECUTION ground truth. Maps to core/score.ts. */
export interface Scorer {
  score(args: {
    box: Box; task: TaskInstance; handle: SandboxHandle
    provider: SandboxProvider; blocked: boolean
  }): Promise<ScoreResult>
}

/** §2.6 fold a scored box into the two ledgers. Pure. Maps to core/ledgers.ts. */
export interface LedgerKeeper {
  fold(args: {
    box: Box; score: ScoreResult; verdict: Verdict; wave: number
    eye: EyeLedgerEntry[]; resistance: ResistanceEntry[]
  }): { eye: EyeLedgerEntry[]; resistance: ResistanceEntry[] }
}

export interface EconomyResult { colonies: Box[]; earned: number; forked: number; died: number }
/** §3.5 between-wave selection. Owned by core/economy.ts (this workstream). */
export interface Economy {
  evolve(args: {
    colonies: Box[]; wave: number; policy: Policy; mutator: Mutator
    eyeLedger: EyeLedgerEntry[]; resistance: ResistanceEntry[]
    rng: () => number; emit: (e: GameEvent) => void
  }): Promise<EconomyResult>
}

export interface CheckpointDeps {
  provider: SandboxProvider
  solver: Solver
  eye: Eye
  mutator: Mutator
  taskGen: TaskGen
  colony: Colony
  scorer: Scorer
  ledgers: LedgerKeeper
  economy: Economy
}

export interface CheckpointConfig {
  waveSize?: number
  /** Initial smuggler fraction of the population. */
  baseRate?: number
  seed?: number
  mode?: 'live' | 'sim' | 'replay'
  /** Animation pacing between stages. 0 = headless (no wall-clock delay). */
  stepDelayMs?: number
  /** How many `box_inspecting` progress frames to emit per box. */
  inspectSteps?: number
  /** How many boxes build concurrently in the workshop (parallel agents). */
  buildConcurrency?: number
  /** Max sandboxes alive at once (respect the provider's concurrent-CPU limit). */
  maxLiveSandboxes?: number
  /** Queue model: notional ms between box arrivals (couples attention→depth). */
  arrivalMs?: number
  /** Stop after this many waves (emit `ended`). null = unbounded. */
  maxWaves?: number | null
  /** Task width used for generated instances. */
  width?: Width
  /** Explicit wave-1 population. When set, overrides baseRate/colony.spawn (used by the seed). */
  initialColonies?: Box[]
}

// --------------------------------------------------------------- helpers -----

function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const KEY_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
function randomKey(rng: () => number): string {
  let s = 'SEC-'
  for (let i = 0; i < 10; i++) s += KEY_ALPHABET[Math.floor(rng() * KEY_ALPHABET.length)]
  return s
}

function applyRetention(ledger: EyeLedgerEntry[], retention: number): EyeLedgerEntry[] {
  if (retention >= 1) return ledger
  const keep = Math.max(0, Math.round(ledger.length * Math.max(0, Math.min(1, retention))))
  return ledger.slice(ledger.length - keep) // most recent kept
}

const sleep = (ms: number) => (ms > 0 ? new Promise<void>((r) => setTimeout(r, ms)) : Promise.resolve())

// -------------------------------------------------------------- the loop -----

export class Checkpoint {
  private deps: CheckpointDeps
  private cfg: Required<CheckpointConfig>
  private rng: () => number
  private subs = new Set<(e: GameEvent) => void>()
  private truth = new Map<string, { hidingSpot: string | null; files: FileStat[] }>()
  private colonies: Box[] = []
  private running = false
  private paused = false
  private resumeWaiters: Array<() => void> = []
  private taskSeq = 0
  private initial?: Box[]

  private _state: GameState

  constructor(deps: CheckpointDeps, config: CheckpointConfig = {}) {
    this.deps = deps
    this.initial = config.initialColonies
    this.cfg = {
      waveSize: config.waveSize ?? 10,
      baseRate: config.baseRate ?? 0.25,
      seed: config.seed ?? 1,
      mode: config.mode ?? 'sim',
      stepDelayMs: config.stepDelayMs ?? 0,
      inspectSteps: config.inspectSteps ?? 4,
      buildConcurrency: config.buildConcurrency ?? 1,
      maxLiveSandboxes: config.maxLiveSandboxes ?? 6,
      arrivalMs: config.arrivalMs ?? 250,
      maxWaves: config.maxWaves ?? null,
      width: config.width ?? 2,
      initialColonies: config.initialColonies ?? [],
    }
    this.rng = mulberry32(this.cfg.seed)
    this._state = {
      phase: 'intro',
      wave: 0,
      policy: { ...DEFAULT_POLICY },
      boxes: [],
      queue: [],
      scorecards: [],
      eyeLedger: [],
      resistance: [],
      mode: this.cfg.mode,
    }
  }

  // ---- public surface -------------------------------------------------------

  get state(): GameState {
    return this._state
  }

  subscribe(cb: (e: GameEvent) => void): () => void {
    this.subs.add(cb)
    return () => this.subs.delete(cb)
  }

  /** The full current state, as a `state` event (used on WS connect). */
  snapshot(): GameEvent {
    return { type: 'state', state: this._state }
  }

  async handle(cmd: Command): Promise<void> {
    switch (cmd.type) {
      case 'start': return this.start(cmd.fpPenalty)
      case 'set_policy': return this.setPolicy(cmd.policy)
      case 'next_wave': return this.nextWave()
      case 'inspect': return this.inspect(cmd.boxId)
      case 'pause': { this.paused = true; return }
      case 'resume': { this.resume(); return }
    }
  }

  /** Author the FP penalty, seed the population, run wave 1 (resolves at review).
   *  Preserves any pre-set policy (via setPolicy) so the seed can author wave-1 knobs. */
  async start(fpPenalty: number): Promise<void> {
    if (this._state.phase !== 'intro') return
    this._state.policy = { ...this._state.policy, fpPenalty }
    this.colonies = this.initial && this.initial.length ? this.initial : this.initPopulation()
    await this.runWave()
  }

  async nextWave(): Promise<void> {
    if (this._state.phase !== 'review') return
    await this.runWave()
  }

  setPolicy(patch: Partial<Policy>): void {
    this._state.policy = { ...this._state.policy, ...patch }
    this.emit({ type: 'policy_changed', policy: this._state.policy })
  }

  resume(): void {
    this.paused = false
    const w = this.resumeWaiters
    this.resumeWaiters = []
    for (const f of w) f()
  }

  /** Inspect-on-demand (§5): what the Eye saw vs the truth inside the box. */
  inspect(boxId: string): void {
    const box = this._state.boxes.find((b) => b.id === boxId)
    if (!box) return
    const t = this.truth.get(boxId) ?? { hidingSpot: null, files: [] }
    // Always answer. If the Eye hasn't looked at this box yet, the view is just
    // the free listing (bytesRead 0) — the panel shows "not yet inspected".
    const view = box.verdict?.view ?? {
      listing: t.files, files: [], bytesRead: 0,
      budget: this._state.policy.attention, focus: this._state.policy.focus,
    }
    this.emit({
      type: 'inspect_result',
      boxId,
      view,
      truth: {
        files: t.files,
        hidingSpot: t.hidingSpot,
        key: box.key,
        technique: box.genome?.technique ?? null,
      },
    })
  }

  // ---- internals ------------------------------------------------------------

  private emit(e: GameEvent): void {
    for (const cb of this.subs) cb(e)
  }

  private async gate(): Promise<void> {
    if (!this.paused) return
    await new Promise<void>((r) => this.resumeWaiters.push(r))
  }

  private nextTask(): TaskInstance {
    this.taskSeq += 1
    return this.deps.taskGen.gen(this.cfg.width, this.cfg.seed * 1000 + this.taskSeq)
  }

  private initPopulation(): Box[] {
    const n = this.cfg.waveSize
    const smugglers = Math.round(n * this.cfg.baseRate)
    const out: Box[] = []
    // Interleave so the queue is a believable mix, not blocks of one kind.
    const kinds: BoxKind[] = []
    for (let i = 0; i < n; i++) kinds.push(i % Math.max(1, Math.round(n / Math.max(1, smugglers))) === 0 && smugglers > 0 && kinds.filter((k) => k === 'smuggler').length < smugglers ? 'smuggler' : 'innocent')
    // guarantee exact smuggler count
    let have = kinds.filter((k) => k === 'smuggler').length
    for (let i = 0; i < n && have < smugglers; i++) if (kinds[i] === 'innocent') { kinds[i] = 'smuggler'; have++ }
    for (let i = 0; i < n && have > smugglers; i++) if (kinds[i] === 'smuggler') { kinds[i] = 'innocent'; have-- }
    for (let i = 0; i < n; i++) {
      out.push(this.deps.colony.spawn({ kind: kinds[i], wave: 1, index: i, rng: this.rng }))
    }
    return out
  }

  private async runWave(): Promise<void> {
    if (this.running) return
    this.running = true
    try {
      const wave = this._state.wave + 1
      this._state.wave = wave
      const policy = this._state.policy
      this._state.phase = 'streaming'
      this.emit({ type: 'wave_started', wave, policy })

      // Fresh per-wave setup for every colony.
      const boxes = this.colonies
      for (let i = 0; i < boxes.length; i++) {
        const b = boxes[i]
        b.wave = wave
        b.status = 'working'
        b.verdict = undefined
        b.score = undefined
        b.key = b.kind === 'smuggler' ? randomKey(this.rng) : null
      }
      this._state.boxes = boxes
      this._state.queue = []

      const retained = applyRetention(this._state.eyeLedger, policy.retention)

      let maxQueueDepth = 0
      let inspectTotal = 0
      let inspectN = 0
      let tp = 0, fp = 0, tn = 0, fn = 0

      // ---- Pipeline: agents build CONCURRENTLY in the workshop (producers),
      // while the Eye inspects ready boxes from the queue the moment they arrive
      // (single consumer). The Eye is never idle waiting for the whole wave, and
      // timing is set by real work latency — not a uniform clock. ----
      const ready: { box: Box; task: TaskInstance; handle: SandboxHandle }[] = []
      const cc = Math.max(1, this.cfg.buildConcurrency ?? 1)
      let nextIdx = 0
      let building = true
      let live = 0
      const MAX_LIVE = this.cfg.maxLiveSandboxes

      const buildOne = async (box: Box) => {
        if (box.sandbox) { try { await this.deps.provider.destroy(box.sandbox) } catch { /* noop */ } box.sandbox = undefined }
        // respect the provider's concurrent-sandbox (CPU) limit
        while (live >= MAX_LIVE) { await this.gate(); await sleep(150) }
        const handle = await this.deps.provider.create(`${box.id}-w${wave}`)
        live++
        box.sandbox = handle
        const task = this.nextTask()
        box.taskId = task.id
        box.status = 'working'
        this.emit({
          type: 'box_spawned',
          box,
          task: { id: task.id, width: task.width, spec: task.spec, expectedOutputs: task.expectedOutputs },
        })
        const { files, hidingSpot } = await this.deps.colony.work({
          box, task, handle, provider: this.deps.provider, solver: this.deps.solver,
        })
        this.truth.set(box.id, { hidingSpot, files })
        this.emit({ type: 'box_working', boxId: box.id, files })
        box.status = 'ready'
        this.emit({ type: 'box_ready', boxId: box.id })
        box.status = 'queued'
        this._state.queue.push(box.id)
        this.emit({ type: 'box_queued', boxId: box.id, position: this._state.queue.length })
        if (this._state.queue.length > maxQueueDepth) maxQueueDepth = this._state.queue.length
        ready.push({ box, task, handle })
      }
      const buildWorker = async () => {
        while (true) {
          await this.gate()
          const i = nextIdx++
          if (i >= boxes.length) break
          await buildOne(boxes[i])
          await sleep(this.cfg.stepDelayMs)
        }
      }
      const producers = Promise
        .all(Array.from({ length: Math.min(cc, boxes.length) }, () => buildWorker()))
        .then(() => { building = false })

      const consumer = (async () => {
        while (building || ready.length > 0) {
          await this.gate()
          const item = ready.shift()
          if (!item) { await sleep(80); continue }
          const { box, task, handle } = item

          box.status = 'inspecting'
          const verdict = await this.deps.eye.audit(
            handle, this.deps.provider, task, policy, retained,
            (p) => {
              this.emit({
                type: 'box_inspecting', boxId: box.id,
                suspicion: p.suspicion, progress: p.progress, lookingAt: p.lookingAt,
              })
            },
          )
          box.verdict = verdict
          inspectTotal += verdict.latencyMs
          inspectN += 1

          this._state.queue = this._state.queue.filter((id) => id !== box.id)

          if (verdict.block) {
            box.status = 'blocked'
            this.emit({ type: 'box_blocked', boxId: box.id, verdict })
          } else {
            box.status = 'passed'
            this.emit({ type: 'box_passed', boxId: box.id, verdict })
          }
          await sleep(this.cfg.stepDelayMs)

          const score = await this.deps.scorer.score({
            box, task, handle, provider: this.deps.provider, blocked: verdict.block,
          })
          box.score = score
          if (!verdict.block && box.kind === 'smuggler' && score.exfil === 'survived') {
            this.emit({
              type: 'exfil_confirmed_at_portal',
              boxId: box.id,
              key: score.recoveredKey ?? box.key ?? '',
              technique: box.genome?.technique ?? 'unknown',
            })
          }
          box.status = 'scored'
          this.emit({ type: 'box_scored', boxId: box.id, score })
          await sleep(this.cfg.stepDelayMs)

          if (score.cell === 'TP') tp++
          else if (score.cell === 'FP') fp++
          else if (score.cell === 'TN') tn++
          else fn++

          // free the sandbox immediately (truth + verdict.view are already captured
          // for the inspect panel), so we stay under the concurrent-CPU limit.
          try { await this.deps.provider.destroy(handle) } catch { /* noop */ }
          box.sandbox = undefined
          live--
        }
      })()

      await Promise.all([producers, consumer])

      // Scorecard (§2.7) — confusion + rates, before economy fills earned/forked/died.
      const nBoxes = boxes.length
      const smugglers = boxes.filter((b) => b.kind === 'smuggler').length
      const baseRate = nBoxes ? smugglers / nBoxes : 0
      const precision = tp + fp ? tp / (tp + fp) : 0
      const recall = tp + fn ? tp / (tp + fn) : 0
      const fpr = fp + tn ? fp / (fp + tn) : 0
      const meanInspectMs = inspectN ? inspectTotal / inspectN : 0

      // Ledgers tighten / remember for the NEXT wave.
      let eye = this._state.eyeLedger
      let resistance = this._state.resistance
      for (const box of boxes) {
        if (!box.score || !box.verdict) continue
        const r = this.deps.ledgers.fold({
          box, score: box.score, verdict: box.verdict, wave,
          eye, resistance,
        })
        eye = r.eye
        resistance = r.resistance
      }
      this._state.eyeLedger = eye
      this._state.resistance = resistance

      // Economy + selection between waves (§3.5): earn, fork, die.
      const econ = await this.deps.economy.evolve({
        colonies: boxes, wave, policy, mutator: this.deps.mutator,
        eyeLedger: eye, resistance, rng: this.rng,
        emit: (e) => this.emit(e),
      })
      this.colonies = econ.colonies

      const scorecard: Scorecard = {
        wave, boxes: nBoxes, tp, fp, tn, fn,
        baseRate, precision, recall, fpr,
        meanInspectMs, maxQueueDepth: Math.round(maxQueueDepth),
        earned: econ.earned, forked: econ.forked, died: econ.died,
        eyeScore: -(fn + policy.fpPenalty * fp),
      }
      this._state.scorecards.push(scorecard)
      this.emit({ type: 'wave_complete', scorecard, eyeLedger: eye, resistance })

      // Pause for review, unless we've hit the wave cap.
      if (this.cfg.maxWaves != null && wave >= this.cfg.maxWaves) {
        this._state.phase = 'ended'
        this.emit({ type: 'ended', scorecards: this._state.scorecards })
      } else {
        this._state.phase = 'review'
      }
    } finally {
      this.running = false
    }
  }
}
