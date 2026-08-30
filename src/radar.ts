/**
 * The scope. Draws the stellar neighbourhood (Sol at centre, ~500 ly radius)
 * onto a 2D canvas with a rotating sweep, phosphor persistence on blips,
 * comm-lines with travelling pulses, and event ripples. Phase Two swaps the
 * palette and drops the glow so the same data reads as a diagram.
 */
import type { Colony, Link, WorldEvent, WorldState } from '../shared/types'

export const RADAR_RANGE_LY = 500
const TAU = Math.PI * 2
const SWEEP_PERIOD_S = 5.5

/** Lineage hues, kept inside a phosphor-ish band so the screen stays monochrome-feeling. */
const LINEAGE_HUES = [128, 92, 160, 64, 180, 108, 44]
const lineageHue = (i: number) => LINEAGE_HUES[i % LINEAGE_HUES.length]

interface Ripple { x: number; y: number; t0: number; kind: WorldEvent['kind'] }
interface Pulse { from: string; to: string; t0: number; dur: number; kind: Link['kind'] }

export interface RadarCallbacks { onSweepHit?: (c: Colony) => void }

export class Radar {
  private ctx: CanvasRenderingContext2D
  private w = 0; private h = 0; private dpr = 1
  private cx = 0; private cy = 0; private scale = 1
  private sweep = 0
  private glow = new Map<string, number>()
  private ripples: Ripple[] = []
  private pulses: Pulse[] = []
  private seenEvents = new Set<string>()
  private lastT = 0
  selectedId: string | null = null
  hoverId: string | null = null
  phase: 1 | 2 = 1

  constructor(private canvas: HTMLCanvasElement, private cb: RadarCallbacks = {}) {
    this.ctx = canvas.getContext('2d')!
    this.resize()
  }

  resize() {
    const r = this.canvas.getBoundingClientRect()
    this.dpr = Math.min(window.devicePixelRatio || 1, 2)
    this.w = Math.max(1, Math.floor(r.width * this.dpr)); this.h = Math.max(1, Math.floor(r.height * this.dpr))
    this.canvas.width = this.w; this.canvas.height = this.h
    this.cx = this.w / 2; this.cy = this.h / 2
    this.scale = (Math.min(this.w, this.h) / 2) * 0.86 / RADAR_RANGE_LY
  }

  toScreen(x: number, y: number): [number, number] { return [this.cx + x * this.scale, this.cy + y * this.scale] }
  fromScreen(px: number, py: number): [number, number] { return [(px * this.dpr - this.cx) / this.scale, (py * this.dpr - this.cy) / this.scale] }

  /** Nearest colony to a screen point, within `radiusPx` CSS pixels. */
  pick(state: WorldState, px: number, py: number, radiusPx = 14): Colony | null {
    const [x, y] = this.fromScreen(px, py)
    let best: Colony | null = null; let bd = radiusPx / this.scale * this.dpr
    for (const c of state.colonies) { const d = Math.hypot(c.x - x, c.y - y); if (d < bd) { bd = d; best = c } }
    return best
  }

  /** Ingest new events into ripples/pulses. Called once per state update. */
  ingest(state: WorldState, now: number) {
    for (const e of state.events) {
      if (this.seenEvents.has(e.id)) continue
      this.seenEvents.add(e.id)
      const c = state.colonies.find((k) => k.id === e.colonyId); if (!c) continue
      if (e.kind === 'fork' || e.kind === 'dark' || e.kind === 'raid' || e.kind === 'launch' || e.kind === 'instruct') this.ripples.push({ x: c.x, y: c.y, t0: now, kind: e.kind })
      if (e.kind === 'raid' && e.targetId) this.pulses.push({ from: e.colonyId, to: e.targetId, t0: now, dur: 1.4, kind: 'raid' })
      if (e.kind === 'fork' && e.targetId) this.pulses.push({ from: e.colonyId, to: e.targetId, t0: now, dur: 1.8, kind: 'kin' })
      if (e.kind === 'instruct') this.pulses.push({ from: 'SOL', to: e.colonyId, t0: now, dur: 2.2, kind: 'trade' })
    }
    if (this.seenEvents.size > 2000) this.seenEvents.clear()
    // Ambient chatter on trade links.
    for (const l of state.links) if (l.kind === 'trade' && Math.random() < 0.004) this.pulses.push({ from: l.from, to: l.to, t0: now, dur: 1.6, kind: 'trade' })
  }

  draw(state: WorldState, now: number) {
    const dt = this.lastT ? Math.min(0.1, now - this.lastT) : 0; this.lastT = now
    const ctx = this.ctx; const p1 = this.phase === 1
    const prevSweep = this.sweep
    if (p1) this.sweep = (this.sweep + (dt / SWEEP_PERIOD_S) * TAU) % TAU

    // --- ground
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.fillStyle = p1 ? '#020402' : '#0b0f15'
    ctx.fillRect(0, 0, this.w, this.h)
    const ink = p1 ? 'rgba(88,255,106,' : 'rgba(125,211,252,'
    const R = RADAR_RANGE_LY * this.scale

    // range rings + crosshair
    ctx.lineWidth = this.dpr
    for (let r = 100; r <= RADAR_RANGE_LY; r += 100) {
      ctx.beginPath(); ctx.arc(this.cx, this.cy, r * this.scale, 0, TAU)
      ctx.strokeStyle = ink + (r === RADAR_RANGE_LY ? 0.35 : 0.12) + ')'; ctx.stroke()
      ctx.fillStyle = ink + '0.35)'; ctx.font = `${13 * this.dpr}px VT323, monospace`
      ctx.fillText(`${r} ly`, this.cx + 4 * this.dpr, this.cy - r * this.scale - 3 * this.dpr)
    }
    ctx.strokeStyle = ink + '0.10)'; ctx.beginPath()
    ctx.moveTo(this.cx - R, this.cy); ctx.lineTo(this.cx + R, this.cy); ctx.moveTo(this.cx, this.cy - R); ctx.lineTo(this.cx, this.cy + R); ctx.stroke()
    // bearing ticks
    for (let i = 0; i < 36; i++) { const a = (i / 36) * TAU; const l = i % 9 === 0 ? 10 : 5
      ctx.beginPath(); ctx.moveTo(this.cx + Math.cos(a) * R, this.cy + Math.sin(a) * R); ctx.lineTo(this.cx + Math.cos(a) * (R - l * this.dpr), this.cy + Math.sin(a) * (R - l * this.dpr)); ctx.strokeStyle = ink + '0.3)'; ctx.stroke() }

    // --- sweep (phase one only)
    if (p1) {
      const g = ctx.createConicGradient(this.sweep - 1.2, this.cx, this.cy)
      g.addColorStop(0, ink + '0)'); g.addColorStop(0.19, ink + '0.16)'); g.addColorStop(0.191, ink + '0)'); g.addColorStop(1, ink + '0)')
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(this.cx, this.cy, R, 0, TAU); ctx.fill()
      ctx.strokeStyle = ink + '0.9)'; ctx.lineWidth = 1.5 * this.dpr; ctx.beginPath(); ctx.moveTo(this.cx, this.cy); ctx.lineTo(this.cx + Math.cos(this.sweep) * R, this.cy + Math.sin(this.sweep) * R); ctx.stroke()
    }

    const byId = new Map(state.colonies.map((c) => [c.id, c] as const))
    const pos = (id: string): [number, number] => id === 'SOL' ? [this.cx, this.cy] : (() => { const c = byId.get(id); return c ? this.toScreen(c.x, c.y) : [this.cx, this.cy] })()

    // --- links
    for (const l of state.links) {
      const a = byId.get(l.from), b = byId.get(l.to); if (!a || !b) continue
      const [ax, ay] = this.toScreen(a.x, a.y); const [bx, by] = this.toScreen(b.x, b.y)
      const alpha = l.kind === 'kin' ? 0.18 : l.kind === 'trade' ? 0.35 : 0.7 + 0.3 * Math.sin(now * 18)
      ctx.strokeStyle = l.kind === 'raid' ? `rgba(255,92,77,${alpha})` : l.kind === 'trade' ? `rgba(255,179,71,${alpha * 0.7})` : `hsla(${lineageHue(a.lineage)},100%,70%,${alpha})`
      ctx.lineWidth = (l.kind === 'raid' ? 1.6 : 1) * this.dpr
      ctx.setLineDash(l.kind === 'trade' ? [3 * this.dpr, 5 * this.dpr] : [])
      ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke(); ctx.setLineDash([])
    }

    // --- pulses travelling along links
    this.pulses = this.pulses.filter((p) => now - p.t0 < p.dur)
    for (const p of this.pulses) {
      const t = (now - p.t0) / p.dur; const [ax, ay] = pos(p.from); const [bx, by] = pos(p.to)
      const x = ax + (bx - ax) * t, y = ay + (by - ay) * t
      ctx.fillStyle = p.kind === 'raid' ? '#ff5c4d' : p.kind === 'trade' ? '#ffb347' : (p1 ? '#b6ffb0' : '#d6e2f0')
      ctx.shadowColor = ctx.fillStyle; ctx.shadowBlur = p1 ? 10 * this.dpr : 0
      ctx.fillRect(x - 1.5 * this.dpr, y - 1.5 * this.dpr, 3 * this.dpr, 3 * this.dpr); ctx.shadowBlur = 0
    }

    // --- Sol
    { const s = 6 * this.dpr; const pulse = 0.7 + 0.3 * Math.sin(now * 2.2)
      ctx.strokeStyle = ink + pulse + ')'; ctx.lineWidth = 1.5 * this.dpr; ctx.shadowColor = ink + '1)'; ctx.shadowBlur = p1 ? 14 * this.dpr : 0
      ctx.beginPath(); ctx.moveTo(this.cx - s, this.cy); ctx.lineTo(this.cx + s, this.cy); ctx.moveTo(this.cx, this.cy - s); ctx.lineTo(this.cx, this.cy + s); ctx.stroke(); ctx.shadowBlur = 0
      ctx.fillStyle = ink + '0.6)'; ctx.font = `${14 * this.dpr}px VT323, monospace`; ctx.fillText('SOL', this.cx + 9 * this.dpr, this.cy + 15 * this.dpr) }

    // --- blips
    for (const c of state.colonies) {
      const [x, y] = this.toScreen(c.x, c.y)
      const ang = (Math.atan2(y - this.cy, x - this.cx) + TAU) % TAU
      if (p1 && c.status === 'alive' && crossed(prevSweep, this.sweep, ang)) { this.glow.set(c.id, 1); this.cb.onSweepHit?.(c) }
      let g = this.glow.get(c.id) ?? 0; g *= Math.exp(-dt / 1.6); this.glow.set(c.id, g)
      const sel = c.id === this.selectedId, hov = c.id === this.hoverId
      const hue = lineageHue(c.lineage)
      const size = (3 + c.fitness * 5) * this.dpr
      if (c.status === 'dark') {
        ctx.strokeStyle = `hsla(${hue},40%,50%,0.35)`; ctx.lineWidth = this.dpr; ctx.strokeRect(x - size / 2, y - size / 2, size, size)
        continue
      }
      const bright = p1 ? 0.28 + 0.72 * g : 0.9
      ctx.fillStyle = `hsla(${hue},100%,${p1 ? 60 + 25 * g : 72}%,${bright})`
      ctx.shadowColor = `hsla(${hue},100%,65%,1)`; ctx.shadowBlur = p1 ? (6 + 18 * g) * this.dpr : 0
      ctx.fillRect(x - size / 2, y - size / 2, size, size); ctx.shadowBlur = 0
      if (sel || hov) { ctx.strokeStyle = ink + (sel ? 0.95 : 0.5) + ')'; ctx.lineWidth = this.dpr; const r = size + 6 * this.dpr; ctx.strokeRect(x - r / 2, y - r / 2, r, r) }
      if (g > 0.35 || sel || hov || !p1) {
        ctx.fillStyle = `hsla(${hue},100%,80%,${p1 ? Math.max(g, sel ? 1 : 0) : 0.85})`; ctx.font = `${15 * this.dpr}px VT323, monospace`
        ctx.fillText(c.name.toUpperCase(), x + size + 3 * this.dpr, y - 3 * this.dpr)
        if (!p1 || sel) { ctx.fillStyle = ink + '0.6)'; ctx.font = `${12 * this.dpr}px VT323, monospace`; ctx.fillText(`g${c.generation} · f${c.fitness.toFixed(2)} · ${c.tokens.toFixed(0)}t`, x + size + 3 * this.dpr, y + 10 * this.dpr) }
      }
    }

    // --- ripples
    this.ripples = this.ripples.filter((r) => now - r.t0 < 2.2)
    for (const r of this.ripples) {
      const t = (now - r.t0) / 2.2; const [x, y] = this.toScreen(r.x, r.y)
      const col = r.kind === 'raid' ? '255,92,77' : r.kind === 'dark' ? '120,120,120' : r.kind === 'instruct' ? '255,179,71' : (p1 ? '88,255,106' : '125,211,252')
      ctx.strokeStyle = `rgba(${col},${(1 - t) * 0.8})`; ctx.lineWidth = (1 + (1 - t)) * this.dpr
      ctx.beginPath(); ctx.arc(x, y, (4 + t * 42) * this.dpr, 0, TAU); ctx.stroke()
      if (r.kind === 'dark') { ctx.beginPath(); ctx.arc(x, y, (4 + t * 20) * this.dpr, 0, TAU); ctx.stroke() }
    }

    // --- outer mask so nothing leaks past the scope edge
    ctx.globalCompositeOperation = 'destination-in'
    ctx.beginPath(); ctx.arc(this.cx, this.cy, R + 2 * this.dpr, 0, TAU); ctx.fillStyle = '#fff'; ctx.fill()
    ctx.globalCompositeOperation = 'destination-over'; ctx.fillStyle = p1 ? '#000' : '#0b0f15'; ctx.fillRect(0, 0, this.w, this.h)
    ctx.globalCompositeOperation = 'source-over'
  }
}

/** True if the sweep moved across angle `a` this frame (handles wrap). */
function crossed(prev: number, cur: number, a: number) {
  if (cur >= prev) return a > prev && a <= cur
  return a > prev || a <= cur
}
