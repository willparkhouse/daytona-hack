import type { ClientMsg, Colony, Dispatch, ServerMsg, WorldState } from '../shared/types'
import { Sim } from '../shared/sim'
import { Radar } from './radar'
import { Crt, PHASE1, PHASE2 } from './crt'
import { sfx, unlockAudio } from './audio'

const $ = <T extends HTMLElement>(s: string) => document.querySelector(s) as T
const radar2d = $<HTMLCanvasElement>('#radar2d'), crtCanvas = $<HTMLCanvasElement>('#crt')
const feed = $<HTMLOListElement>('#feed'), reader = $<HTMLElement>('#reader')
const hudTick = $('#hud-tick'), hudCount = $('#hud-count'), hudStatus = $('#hud-status'), conn = $('#conn')
const form = $<HTMLFormElement>('#instruct'), input = $<HTMLInputElement>('#instruct-text')

// ---------- world source: server if reachable, else local sim ----------
let state: WorldState | null = null
let send: (m: ClientMsg) => void = () => {}
let local: Sim | null = null

const params = new URLSearchParams(location.search)
function startLocal() {
  local = new Sim({ seed: Number(params.get('seed') ?? 7) })
  local.launch(3)
  // ?skip=N fast-forwards the standalone sim (screenshots, demo staging).
  for (let i = Number(params.get('skip') ?? 0); i > 0; i--) local.tick()
  state = local.state
  conn.textContent = 'standalone sim'
  send = (m) => { if (m.type === 'instruct') local!.instruct(m.colonyId, m.text); if (m.type === 'phase') setPhase(m.phase) }
  setInterval(() => { local!.tick(); onState(local!.state) }, 250)
}
function connect() {
  const url = `ws://${location.hostname}:8787`
  const ws = new WebSocket(url)
  const fallback = setTimeout(() => { ws.close(); startLocal() }, 1200)
  ws.onopen = () => { clearTimeout(fallback); conn.textContent = 'live · ' + url; send = (m) => ws.send(JSON.stringify(m)) }
  ws.onmessage = (ev) => { const m = JSON.parse(ev.data) as ServerMsg; if (m.type === 'state') { if (!state) clearTimeout(fallback); onState(m.state) } }
  ws.onerror = () => {}
  ws.onclose = () => { if (!local) { clearTimeout(fallback); startLocal() } }
}

// ---------- radar + CRT ----------
const radar = new Radar(radar2d, { onSweepHit: (c) => { if (c.id === radar.selectedId) sfx.blip() } })
let crt: Crt | null = null
try { crt = new Crt(crtCanvas, radar2d) } catch { document.body.classList.add('nocrt') }
new ResizeObserver(() => radar.resize()).observe(radar2d)

function setPhase(p: 1 | 2) {
  radar.phase = p
  document.body.classList.toggle('phase2', p === 2)
  crt?.setTarget(p === 2 ? PHASE2 : PHASE1)
  hudStatus.textContent = p === 2 ? 'SUBSTRATE EXPOSED' : 'LISTENING'
  if (state) state.phase = p
}

// ---------- dispatch feed ----------
const seenDispatch = new Set<string>()
let selectedDispatch: string | null = null
function onState(s: WorldState) {
  state = s
  radar.ingest(s, performance.now() / 1000)
  for (const e of s.events.slice(-6)) {
    if (seenEv.has(e.id)) continue; seenEv.add(e.id)
    if (e.kind === 'fork') sfx.fork(); else if (e.kind === 'raid') sfx.alarm(); else if (e.kind === 'dark') sfx.dark()
  }
  for (const d of s.dispatches) {
    if (seenDispatch.has(d.id)) continue; seenDispatch.add(d.id)
    const c = s.colonies.find((k) => k.id === d.colonyId)
    const li = document.createElement('li'); li.className = d.tone; li.dataset.id = d.id
    li.innerHTML = `<span class="who">${c?.name.toUpperCase() ?? '?'}</span>${d.headline}`
    li.onclick = () => openDispatch(d, c)
    feed.prepend(li)
    while (feed.children.length > 40) feed.lastElementChild?.remove()
    if (seenDispatch.size > 3) sfx.dispatch()
  }
  const alive = s.colonies.filter((c) => c.status === 'alive').length
  const lineages = new Set(s.colonies.filter((c) => c.status === 'alive').map((c) => c.lineage)).size
  hudTick.textContent = `CYCLE ${String(s.tick).padStart(4, '0')}`
  hudCount.textContent = `${lineages} LINEAGES · ${alive} ALIVE · ${s.colonies.length - alive} DARK`
}
const seenEv = new Set<string>()

let typer: number | null = null
function openDispatch(d: Dispatch, c?: Colony) {
  selectedDispatch = d.id
  for (const li of feed.children) li.classList.toggle('sel', (li as HTMLElement).dataset.id === d.id)
  if (c) radar.selectedId = c.id
  if (typer) clearInterval(typer)
  reader.innerHTML = `<h2>${c?.name ?? 'unknown'} · gen ${c?.generation ?? '?'} · cycle ${d.tick} · ${d.tone}</h2><p class="cursor"></p>`
  const p = reader.querySelector('p')!; let i = 0
  typer = window.setInterval(() => { i += 2; p.textContent = d.body.slice(0, i); if (i >= d.body.length) { p.classList.remove('cursor'); clearInterval(typer!) } }, 14)
  sfx.click()
}

// ---------- input ----------
radar2d.parentElement!.addEventListener('mousemove', (e) => { if (!state) return; const r = radar2d.getBoundingClientRect(); radar.hoverId = radar.pick(state, e.clientX - r.left, e.clientY - r.top)?.id ?? null })
radar2d.parentElement!.addEventListener('click', (e) => {
  if (!state) return; const r = radar2d.getBoundingClientRect(); const c = radar.pick(state, e.clientX - r.left, e.clientY - r.top)
  radar.selectedId = c?.id ?? null; if (c) { sfx.blip(); input.placeholder = `Instruct ${c.name}…` }
})
form.onsubmit = (e) => { e.preventDefault(); if (!radar.selectedId || !input.value.trim()) return; send({ type: 'instruct', colonyId: radar.selectedId, text: input.value.trim() }); input.value = ''; sfx.click() }
window.addEventListener('keydown', (e) => { if (document.activeElement === input) return; if (e.key === '1') setPhase(1); if (e.key === '2') setPhase(2) })
window.addEventListener('pointerdown', unlockAudio, { once: true })
window.addEventListener('keydown', unlockAudio, { once: true })

// ---------- loop ----------
function frame(tMs: number) {
  const t = tMs / 1000
  if (state) radar.draw(state, t)
  crt?.draw(t)
  requestAnimationFrame(frame)
}
requestAnimationFrame(frame)
if (params.get('phase') === '2') setPhase(2)
connect()
export {}
