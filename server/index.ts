/**
 * Authoritative world server. Ticks the shared sim, broadcasts snapshots over
 * WebSocket, accepts player instructions. Daytona-backed colonies (when
 * enabled) overlay ground-truth fitness onto the sim via the Swarm adapter.
 *
 *   pnpm server            # sim only
 *   SWARM=1 pnpm server    # also spin real sandboxes for the first probes
 */
import { WebSocketServer, WebSocket } from 'ws'
import { Sim } from '../shared/sim'
import type { ClientMsg, ServerMsg } from '../shared/types'
import { Swarm } from './daytona'

const PORT = Number(process.env.PORT ?? 8787)
const TICK_MS = Number(process.env.TICK_MS ?? 250)
const sim = new Sim({ seed: Number(process.env.SEED ?? 7) })
sim.launch(3)

const swarm = process.env.SWARM && Swarm.enabled() ? new Swarm() : null
if (swarm) {
  console.log('[swarm] Daytona enabled — launching sandboxes for initial probes')
  for (const c of sim.state.colonies) swarm.launch(c.id).then((sb) => { c.sandboxId = sb.id; console.log(`[swarm] ${c.name} → ${sb.id}`) }).catch((e) => console.error('[swarm] launch failed', e))
}

const wss = new WebSocketServer({ port: PORT })
const broadcast = (m: ServerMsg) => { const s = JSON.stringify(m); for (const c of wss.clients) if (c.readyState === WebSocket.OPEN) c.send(s) }

wss.on('connection', (ws) => {
  ws.send(JSON.stringify({ type: 'state', state: sim.state } satisfies ServerMsg))
  ws.on('message', (raw) => {
    let m: ClientMsg
    try { m = JSON.parse(String(raw)) } catch { return }
    if (m.type === 'instruct') { console.log(`[instruct] ${m.colonyId}: ${m.text}`); sim.instruct(m.colonyId, m.text) }
    if (m.type === 'phase') sim.state.phase = m.phase
  })
})

setInterval(() => { sim.tick(); broadcast({ type: 'state', state: sim.state }) }, TICK_MS)
console.log(`[world] ws://localhost:${PORT} · tick ${TICK_MS}ms · seed ${sim.state.seed}`)

process.on('SIGINT', async () => { console.log('\n[world] shutting down'); await swarm?.dispose(); process.exit(0) })
