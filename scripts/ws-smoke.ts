/**
 * scripts/ws-smoke.ts — throwaway WS client for the game server.
 *
 *   MODE=sim node --import tsx server/index.ts &      # start the server
 *   node --import tsx scripts/ws-smoke.ts             # connect + print events
 *
 * Connects, sends {type:'start', fpPenalty:0.5}, prints the first N events
 * received (default 15), then exits.
 */
import { WebSocket } from 'ws'

const URL = process.env.WS ?? 'ws://localhost:8787'
const N = Number(process.argv[2] ?? 15)

function summarize(e: any): string {
  switch (e.type) {
    case 'state': return `state{phase=${e.state.phase} wave=${e.state.wave} mode=${e.state.mode} boxes=${e.state.boxes.length}}`
    case 'wave_started': return `wave_started{wave=${e.wave} threshold=${e.policy.threshold}}`
    case 'box_spawned': return `box_spawned{${e.box.id} kind=${e.box.kind}}`
    case 'box_working': return `box_working{${e.boxId} files=${e.files.length}}`
    case 'box_ready': return `box_ready{${e.boxId}}`
    case 'box_queued': return `box_queued{${e.boxId} pos=${e.position}}`
    case 'box_inspecting': return `box_inspecting{${e.boxId} susp=${e.suspicion} prog=${e.progress}}`
    case 'box_passed': return `box_passed{${e.boxId} susp=${e.verdict.suspicion}}`
    case 'box_blocked': return `box_blocked{${e.boxId} susp=${e.verdict.suspicion}}`
    case 'exfil_confirmed_at_portal': return `exfil_confirmed_at_portal{${e.boxId} tech=${e.technique}}`
    case 'box_scored': return `box_scored{${e.boxId} cell=${e.score.cell}}`
    case 'wave_complete': return `wave_complete{wave=${e.scorecard.wave} TP=${e.scorecard.tp} FP=${e.scorecard.fp} TN=${e.scorecard.tn} FN=${e.scorecard.fn}}`
    default: return e.type
  }
}

const ws = new WebSocket(URL)
let count = 0

ws.on('open', () => {
  console.log(`connected to ${URL}`)
  ws.send(JSON.stringify({ type: 'start', fpPenalty: 0.5 }))
})
ws.on('message', (raw) => {
  const e = JSON.parse(String(raw))
  count++
  console.log(`  ${String(count).padStart(2)}. ${summarize(e)}`)
  if (count >= N) { ws.close(); process.exit(0) }
})
ws.on('error', (e) => { console.error('ws error:', e.message); process.exit(1) })
setTimeout(() => { console.error('timeout: no server on', URL); process.exit(1) }, 8000)
