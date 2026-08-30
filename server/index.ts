/**
 * server/index.ts — the game server (replaces the old radar world server).
 *
 * A `ws` server on :8787 that owns a Checkpoint, sends `{type:'state'}` on
 * connect, streams GameEvents, and accepts Commands.
 *
 *   MODE=sim   pnpm server   # fast layer (default) — always works, no network
 *   MODE=seed  pnpm server   # replay the deterministic demo seed
 *   MODE=live  pnpm server   # real providers when wired (falls back to sim here)
 *
 * Env: PORT (8787), STEP_MS (stage pacing, 200), SEED (7).
 * server/daytona.ts is left untouched (another team wraps it).
 */
import { WebSocketServer, WebSocket } from 'ws'
import { Checkpoint, type CheckpointDeps } from '../core/loop'
import { makeFastDeps } from '../sim/fast_layer'
import { buildSeed } from '../sim/seed'
import { readFileSync } from 'node:fs'
import type { Command, GameEvent, GameState } from '../core/types'

const PORT = Number(process.env.PORT ?? 8787)
const SEED = Number(process.env.SEED ?? 7)
const MODE = (process.env.MODE ?? 'sim') as 'sim' | 'seed' | 'live'
// Realistic default pacing: live boxes should take a few seconds to cross, not flash by.
const STEP_MS = Number(process.env.STEP_MS ?? (MODE === 'live' ? 700 : 200))
const INSPECT_STEPS = Number(process.env.INSPECT_STEPS ?? (MODE === 'live' ? 14 : 6))
const BUILD_CC = Number(process.env.BUILD_CC ?? (MODE === 'live' ? 3 : 1))
const WAVE_SIZE = Number(process.env.WAVE_SIZE ?? (MODE === 'live' ? 5 : 10))
// Which real components to use (live mode). Default: offline+free (local + fake heuristic Eye),
// realistically paced — flip to real Codex/Daytona per box when you want ground truth:
//   MODE=live PROVIDER=daytona EYE=codex MUT=codex SOLVER=codex pnpm server
const LIVE = {
  provider: (process.env.PROVIDER ?? 'daytona') as 'local' | 'daytona',
  eyeModel: (process.env.EYE ?? 'codex') as 'fake' | 'codex',
  mutator: (process.env.MUT ?? 'deterministic') as 'deterministic' | 'codex',
  solver: (process.env.SOLVER ?? 'deterministic') as 'deterministic' | 'codex',
  agent: (process.env.AGENT ?? 'sandbox') as 'host' | 'sandbox',
}

const wss = new WebSocketServer({ port: PORT })
const send = (ws: WebSocket, e: GameEvent) => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(e)) }
const broadcast = (e: GameEvent) => { const s = JSON.stringify(e); for (const c of wss.clients) if (c.readyState === WebSocket.OPEN) c.send(s) }

console.log(`[watch] mode=${MODE} · ws://localhost:${PORT} · step ${STEP_MS}ms · seed ${SEED}`)

if (MODE === 'seed') runSeedMode()
else runLiveOrSim()

// ---------------------------------------------------------------- sim/live ---

/** Returns a factory that builds a fresh CheckpointDeps each call (so a new game starts clean). */
async function getBuild(): Promise<() => CheckpointDeps> {
  if (MODE !== 'live') return () => makeFastDeps({ seed: SEED, starterTechnique: 'base64-comment' })
  try {
    const spec = ['..', 'core', 'wiring'].join('/') // computed → not statically resolved
    const mod: any = await import(spec)
    if (typeof mod.makeLiveDeps === 'function') {
      console.log(`[live] real deps wired: provider=${LIVE.provider} eye=${LIVE.eyeModel} mutator=${LIVE.mutator} solver=${LIVE.solver}`)
      return () => mod.makeLiveDeps({ seed: SEED, ...LIVE })
    }
    throw new Error('makeLiveDeps not exported')
  } catch {
    console.warn('[live] real providers not wired in this worktree — falling back to fast layer')
    return () => makeFastDeps({ seed: SEED })
  }
}

async function runLiveOrSim() {
  const build = await getBuild()
  const cfg = {
    seed: SEED, waveSize: WAVE_SIZE, baseRate: 0.3, stepDelayMs: STEP_MS,
    inspectSteps: INSPECT_STEPS, arrivalMs: 350, buildConcurrency: BUILD_CC,
    maxLiveSandboxes: Number(process.env.MAX_LIVE ?? 6),
    portalDwellMs: Number(process.env.PORTAL_DWELL ?? 2600),
    mode: (MODE === 'live' ? 'live' : 'sim') as 'live' | 'sim',
  }

  // Clear any sandboxes orphaned by a previous run before we start.
  if (MODE === 'live' && LIVE.provider === 'daytona') {
    try { const { Swarm } = await import('./daytona'); const n = await Swarm.purge(); if (n) console.log(`[live] purged ${n} orphaned sandboxes on startup`) } catch { /* noop */ }
  }

  // ONE GAME PER UI CONNECTION — the game's lifecycle is tied to the socket.
  // When the page closes or reloads, that game is disposed (its sandboxes
  // destroyed → no orphans), and separate connections never interfere.
  const games = new Set<Checkpoint>()
  wss.on('connection', (ws) => {
    const cp = new Checkpoint(build(), cfg)
    games.add(cp)
    const unsub = cp.subscribe((e) => send(ws, e))
    send(ws, cp.snapshot())
    ws.on('message', (raw) => {
      let cmd: Command
      try { cmd = JSON.parse(String(raw)) } catch { return }
      console.log(`[cmd] ${cmd.type}`)
      cp.handle(cmd).catch((e) => console.error('[cmd] error', e))
    })
    ws.on('close', () => { unsub(); games.delete(cp); cp.dispose().catch(() => {}) })
  })

  process.on('SIGINT', async () => {
    console.log('\n[watch] shutting down — disposing games')
    await Promise.allSettled([...games].map((g) => g.dispose()))
    process.exit(0)
  })
}

// ------------------------------------------------------------------- seed ----

async function runSeedMode() {
  let events: GameEvent[]
  try {
    events = JSON.parse(readFileSync(new URL('../sim/recorded-demo.json', import.meta.url), 'utf8'))
    console.log(`[seed] replaying RECORDED real run (${events.length} events)`)
  } catch {
    events = await buildSeed()
    console.log('[seed] replaying synthetic seed')
  }
  const initialState: GameState = events[0]?.type === 'state'
    ? events[0].state
    : { phase: 'intro', wave: 0, policy: { threshold: 0.65, attention: 4000, focus: 'balanced', retention: 1, fpPenalty: 0.5 }, boxes: [], queue: [], scorecards: [], eyeLedger: [], resistance: [], mode: 'replay' }

  let started = false
  let paused = false
  let idx = 1 // events[0] is the initial state

  wss.on('connection', (ws) => {
    send(ws, { type: 'state', state: initialState })
    ws.on('message', (raw) => {
      let cmd: Command
      try { cmd = JSON.parse(String(raw)) } catch { return }
      console.log(`[cmd] ${cmd.type}`)
      if (cmd.type === 'pause') paused = true
      else if (cmd.type === 'resume') paused = false
      else if (cmd.type === 'start' && !started) { started = true; stream() }
    })
  })

  async function stream() {
    while (idx < events.length) {
      if (paused) { await sleep(80); continue }
      broadcast(events[idx])
      idx++
      // Pause a touch longer at review boundaries so the beat lands.
      const e = events[idx - 1]
      await sleep(e.type === 'wave_complete' ? STEP_MS * 4 : STEP_MS)
    }
    console.log('[seed] replay complete')
  }

  process.on('SIGINT', () => { console.log('\n[watch] shutting down'); process.exit(0) })
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))
