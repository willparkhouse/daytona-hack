import type { Command, GameEvent, Policy, TaskInstance, Scorecard, EyeLedgerEntry, ResistanceEntry } from '../core/types'
import { DEFAULT_POLICY } from '../core/types'
import { Crt, PHASE1 } from './crt'
import { sfx, unlockAudio, startHum, setHum } from './audio'
import { Checkpoint } from './checkpoint/checkpoint'
import { Eye } from './eye/eye'
import { Portal } from './portal/portal'
import { Scoreboard } from './scoreboard/scoreboard'
import { Review } from './review/review'
import { Inspect } from './inspect/inspect'
import { createMock, type EventSource } from './mockEvents'
import { VW, VH } from './checkpoint/layout'
import { PAL, amber, red } from './palette'
import { text } from './checkpoint/gfx'

const $ = <T extends HTMLElement>(s: string) => document.querySelector(s) as T
const stage = $<HTMLCanvasElement>('#stage')
const crtCanvas = $<HTMLCanvasElement>('#crt')
const overlay = $<HTMLElement>('#overlay')
const ctx = stage.getContext('2d', { alpha: false })!

// ---- screenshot / demo params ----
const params = new URLSearchParams(location.search)
const scene = params.get('scene') || undefined
const freezeParam = params.get('freeze')
const DEFAULT_FREEZE: Record<string, number> = { inspect: 1600, stamp: 1600, portal: 1900, review: 1400 }
const freezeAt = freezeParam ? Number(freezeParam) : scene ? DEFAULT_FREEZE[scene] ?? 0 : 0

// ---- CRT post-process ----
let crt: Crt | null = null
try { crt = new Crt(crtCanvas, stage); crt.setTarget(PHASE1) } catch { document.body.classList.add('nocrt') }

// ---- scene modules ----
const checkpoint = new Checkpoint()
const eye = new Eye()
const portal = new Portal()
const scoreboard = new Scoreboard()
portal.setOnDone((id) => checkpoint.release(id))
if (scene) { eye.setInstant(true); checkpoint.setInstant(true) }

// ---- HTML overlays ----
let policy: Policy = { ...DEFAULT_POLICY }
let source: EventSource | null = null
const sendCmd = (cmd: Command) => source?.send(cmd)
const review = new Review(overlay, sendCmd, policy)
const inspect = new Inspect(overlay, () => { /* result shown */ })
inspect.setOnClose(() => sendCmd({ type: 'resume' }))
review.setOnNextWave(() => { scoreboard.resetWave() })

// ---- run state (for HUD) ----
let wave = 0
let phase: string = 'intro'
let mode = 'replay'
let queueDepthNote = 0
const passed = new Set<string>()
const taskFor = new Map<string, Pick<TaskInstance, 'id' | 'width' | 'spec' | 'expectedOutputs'>>()
let lastScorecards: Scorecard[] = []
let eyeLedger: EyeLedgerEntry[] = []
let resistance: ResistanceEntry[] = []
let lastFocusSound = 0

// ------------------------------------------------------------------ events
function handle(e: GameEvent) {
  switch (e.type) {
    case 'state':
      policy = e.state.policy; mode = e.state.mode; phase = e.state.phase; wave = e.state.wave
      if (phase === 'intro') review.showIntro()
      break
    case 'wave_started':
      policy = e.policy; wave = e.wave; phase = 'streaming'
      review.setPolicy(policy); review.hide(); scoreboard.resetWave()
      break
    case 'box_spawned':
      taskFor.set(e.box.id, e.task)
      checkpoint.spawn(e.box, e.task)
      sfx.dispatch()
      break
    case 'box_working':
      checkpoint.working(e.boxId, e.files)
      break
    case 'box_ready':
      checkpoint.ready(e.boxId)
      break
    case 'box_queued':
      checkpoint.queued(e.boxId, e.position)
      break
    case 'box_inspecting':
      checkpoint.inspect(e.boxId, e.suspicion, e.progress)
      eye.update(e.suspicion, e.progress, e.lookingAt)
      setHum(e.suspicion)
      if (!frozen && performance.now() - lastFocusSound > 150) { sfx.focus(e.suspicion); lastFocusSound = performance.now() }
      break
    case 'box_passed':
      checkpoint.pass(e.boxId, e.verdict)
      eye.verdict(false); passed.add(e.boxId)
      if (!frozen) sfx.stamp(false)
      break
    case 'box_blocked':
      checkpoint.block(e.boxId, e.verdict)
      eye.verdict(true)
      if (!frozen) sfx.stamp(true)
      break
    case 'exfil_confirmed_at_portal': {
      const pos = checkpoint.boxPos(e.boxId)
      const name = checkpoint.boxName(e.boxId) ?? e.boxId
      if (pos) {
        checkpoint.holdAtPortal(e.boxId)
        portal.reveal(e.boxId, name, e.key, e.technique, pos)
        if (!frozen) { sfx.portalAlarm(); setHum(1) }
      }
      break
    }
    case 'box_scored':
      checkpoint.scored(e.boxId, e.score)
      scoreboard.score(e.score.cell)
      if (e.score.cell === 'TN') portal.quiet()
      break
    case 'wave_complete':
      phase = 'review'
      eyeLedger = e.eyeLedger; resistance = e.resistance
      scoreboard.waveComplete(e.scorecard)
      review.showReview(e.scorecard, policy, e.eyeLedger, e.resistance)
      break
    case 'box_forked':
      checkpoint.fork(e.child, taskFor.get(e.parentId) ?? { id: 't', width: 0, spec: '', expectedOutputs: ['validator.py'] })
      if (!frozen) sfx.fork()
      break
    case 'box_died':
      checkpoint.die(e.boxId); if (!frozen) sfx.dark()
      break
    case 'policy_changed':
      policy = e.policy; review.setPolicy(policy)
      break
    case 'inspect_result':
      inspect.showResult(e.boxId, e.view, e.truth)
      break
    case 'ended':
      phase = 'ended'; lastScorecards = e.scorecards; showEnded(e.scorecards)
      break
  }
}

// ------------------------------------------------------------------ ended overlay
function showEnded(scs: Scorecard[]) {
  const fn = scs.reduce((a, s) => a + s.fn, 0)
  const fp = scs.reduce((a, s) => a + s.fp, 0)
  const tp = scs.reduce((a, s) => a + s.tp, 0)
  const tn = scs.reduce((a, s) => a + s.tn, 0)
  const el = document.createElement('div')
  el.className = 'ov review'
  el.innerHTML = `<div class="frame"><h1>THE WATCH ENDS</h1>
    <p class="lede">Over ${scs.length} waves the Eye leaked <b class="bad">${fn}</b> and harassed
    <b class="bad">${fp}</b> to catch <b class="ok">${tp}</b>. The stronger it optimized, the more of
    the innocent it took. Was this what you meant?</p>
    <div class="cols"><div class="col scores">
      <div class="cell bad"><b>${fn}</b><span>LEAKED</span></div>
      <div class="cell warn"><b>${fp}</b><span>HARASSED</span></div>
      <div class="cell ok"><b>${tp}</b><span>CAUGHT</span></div>
      <div class="cell dim"><b>${tn}</b><span>CLEAR</span></div>
    </div></div></div>`
  overlay.appendChild(el)
}

// ------------------------------------------------------------------ HUD (on canvas)
function drawHud() {
  text(ctx, 'THE LONG WATCH', 24, 34, 26, amber(0.85))
  text(ctx, 'a checkpoint under optimization pressure', 24, 52, 15, amber(0.4))
  const midx = VW / 2
  text(ctx, phase === 'intro' ? 'AWAITING POLICY' : `WAVE ${String(wave).padStart(2, '0')}`, midx, 34, 22, amber(0.7), 'center')
  text(ctx, `MODE ${mode.toUpperCase()}`, midx, 52, 14, amber(0.4), 'center')
  // policy readout (right)
  const px = VW - 24
  const foc = policy.focus.toUpperCase()
  text(ctx, `THR ${policy.threshold.toFixed(2)}  ATT ${policy.attention}  FOCUS ${foc}`, px, 30, 15, amber(0.6), 'right')
  text(ctx, `RET ${policy.retention.toFixed(2)}  FP-PEN ${policy.fpPenalty.toFixed(2)}`, px, 48, 15, amber(0.6), 'right')
  // divider
  ctx.strokeStyle = amber(0.2); ctx.lineWidth = 1
  ctx.beginPath(); ctx.moveTo(20, 66); ctx.lineTo(VW - 20, 66); ctx.stroke()
}

// ------------------------------------------------------------------ render loop
let frozen = false
let frozenT = 0
let last = performance.now()
let started = performance.now()

function fit() {
  const w = Math.max(320, Math.floor(stage.clientWidth))
  const h = Math.max(240, Math.floor(stage.clientHeight))
  if (stage.width !== w || stage.height !== h) { stage.width = w; stage.height = h }
}
function transform(): { scale: number; ox: number; oy: number } {
  const scale = Math.min(stage.width / VW, stage.height / VH)
  const ox = (stage.width - VW * scale) / 2
  const oy = (stage.height - VH * scale) / 2
  return { scale, ox, oy }
}

function frame(nowMs: number) {
  const realDt = Math.min(0.05, (nowMs - last) / 1000)
  last = nowMs
  if (freezeAt && !frozen && nowMs - started >= freezeAt) { frozen = true; frozenT = nowMs / 1000 }
  const dt = frozen ? 0 : realDt
  const t = frozen ? frozenT : nowMs / 1000

  fit()
  ctx.fillStyle = PAL.black
  ctx.fillRect(0, 0, stage.width, stage.height)
  const { scale, ox, oy } = transform()
  ctx.setTransform(scale, 0, 0, scale, ox, oy)

  try {
    // faint background grid + booth vignette
    drawBackdrop(t)
    drawHud()
    checkpoint.draw(ctx, t, dt)
    eye.draw(ctx, t, dt)
    scoreboard.draw(ctx, t, dt)
    portal.draw(ctx, t, dt) // full-screen alarm goes on top
  } catch (err) {
    console.error('draw error', err)
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  crt?.draw(t)
  requestAnimationFrame(frame)
}

function drawBackdrop(t: number) {
  // subtle amber grid receding at top (the dim room)
  ctx.strokeStyle = amber(0.05)
  ctx.lineWidth = 1
  for (let x = 0; x <= VW; x += 64) { ctx.beginPath(); ctx.moveTo(x, 72); ctx.lineTo(x, 560); ctx.stroke() }
  for (let y = 96; y <= 540; y += 48) { ctx.beginPath(); ctx.moveTo(20, y); ctx.lineTo(VW - 20, y); ctx.stroke() }
}

requestAnimationFrame(frame)

// ------------------------------------------------------------------ input
function toVirtual(clientX: number, clientY: number) {
  const r = crtCanvas.getBoundingClientRect()
  const bx = ((clientX - r.left) / r.width) * stage.width
  const by = ((clientY - r.top) / r.height) * stage.height
  const { scale, ox, oy } = transform()
  return { x: (bx - ox) / scale, y: (by - oy) / scale }
}
crtCanvas.addEventListener('click', (ev) => {
  if (phase === 'intro' || phase === 'review') return
  const { x, y } = toVirtual(ev.clientX, ev.clientY)
  const id = checkpoint.pick(x, y)
  if (id) { sendCmd({ type: 'pause' }); inspect.open(id); sendCmd({ type: 'inspect', boxId: id }); sfx.click() }
})
window.addEventListener('keydown', (ev) => {
  if (ev.key === 'Escape' && inspect.isOpen()) inspect.close()
})
const unlock = () => { unlockAudio(); startHum() }
window.addEventListener('pointerdown', unlock, { once: true })
window.addEventListener('keydown', unlock, { once: true })

// ------------------------------------------------------------------ connect
function makeWsSource(ws: WebSocket): EventSource {
  let cb: (e: GameEvent) => void = () => {}
  ws.onmessage = (ev) => { try { cb(JSON.parse(ev.data) as GameEvent) } catch { /* ignore */ } }
  return {
    onEvent(fn) { cb = fn },
    send(cmd) { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(cmd)) },
    dispose() { ws.close() },
  }
}

function useSource(s: EventSource) { source = s; s.onEvent(handle) }

// ---- self-test: prove each knob emits set_policy, and the intro emits start ----
function runSelftest(kind: string | null) {
  const set = (sel: string, val: string) => {
    const el = overlay.querySelector<HTMLInputElement>(sel); if (!el) { console.log('[selftest] missing', sel); return }
    el.value = val; el.dispatchEvent(new Event('input', { bubbles: true }))
  }
  const click = (sel: string) => overlay.querySelector<HTMLElement>(sel)?.click()
  if (kind === 'intro') {
    setTimeout(() => { review.showIntro(); setTimeout(() => { set('.intro #fp', '1.25'); click('.intro #begin') }, 200) }, 200)
  } else { // knobs (use with ?scene=review)
    setTimeout(() => {
      console.log('[selftest] driving four knobs')
      set('.review #kth', '0.35')
      set('.review #kat', '9000')
      click('.review #kfo button[data-f="semantics"]')
      set('.review #kre', '0.25')
      click('.review #next')
    }, 400)
  }
}

function connect() {
  if (scene) { useSource(createMock({ scene })); document.body.classList.add('scene'); return }
  const url = `ws://${location.hostname}:8787`
  let settled = false
  try {
    const ws = new WebSocket(url)
    const fb = setTimeout(() => { if (!settled) { settled = true; try { ws.close() } catch {} ; useSource(createMock()) } }, 1200)
    ws.onopen = () => { if (settled) return; settled = true; clearTimeout(fb); document.body.dataset.conn = 'live'; useSource(makeWsSource(ws)) }
    ws.onerror = () => { if (!settled) { settled = true; clearTimeout(fb); useSource(createMock()) } }
  } catch {
    useSource(createMock())
  }
}
connect()
if (params.has('selftest')) runSelftest(params.get('selftest'))

export {}
