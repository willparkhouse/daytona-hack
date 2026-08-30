import WebSocket from 'ws'
const ws = new WebSocket('ws://localhost:8787')
const t0 = Date.now()
const ms = () => String(Date.now() - t0).padStart(6)
let started = false
ws.on('open', () => console.log('connected'))
ws.on('message', (raw) => {
  const e = JSON.parse(String(raw))
  if (e.type === 'state') { console.log(`${ms()} state phase=${e.state.phase} boxes=${e.state.boxes.length}`); if (e.state.phase === 'intro' && !started) { started = true; ws.send(JSON.stringify({ type: 'start', fpPenalty: 0.5 })); console.log('-> sent start') } ; return }
  const id = e.boxId ?? e.box?.id ?? ''
  if (e.type === 'box_inspecting') return // too chatty
  console.log(`${ms()} ${e.type} ${id}${e.type==='wave_complete'?' ['+e.scorecard.tp+'/'+e.scorecard.fp+'/'+e.scorecard.tn+'/'+e.scorecard.fn+']':''}`)
})
setTimeout(() => { console.log('done'); process.exit(0) }, Number(process.argv[2] ?? 18) * 1000)
