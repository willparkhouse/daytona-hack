import type { Cell, Scorecard } from '../../core/types'
import { PAL, amber, red } from '../palette'
import { text, hline, vline } from '../checkpoint/gfx'
import { BOARD } from '../checkpoint/layout'

type Ctx = CanvasRenderingContext2D

/** Live confusion-matrix + ROC operating-point readout. Always visible, phosphor. */
export class Scoreboard {
  private tp = 0; private fp = 0; private tn = 0; private fn = 0
  private points: { fpr: number; recall: number }[] = []
  private baseHist: number[] = []
  private lastCell: Cell | null = null
  private flash = 0

  resetWave() { this.tp = this.fp = this.tn = this.fn = 0 }
  resetAll() { this.resetWave(); this.points = []; this.baseHist = [] }

  score(cell: Cell) {
    if (cell === 'TP') this.tp++
    else if (cell === 'FP') this.fp++
    else if (cell === 'TN') this.tn++
    else this.fn++
    this.lastCell = cell
    this.flash = 1
  }

  waveComplete(sc: Scorecard) {
    this.points.push({ fpr: sc.fpr || 0, recall: sc.recall || 0 })
    if (this.points.length > 8) this.points.shift()
    this.baseHist.push(sc.baseRate || 0)
    if (this.baseHist.length > 12) this.baseHist.shift()
  }

  private derived() {
    const total = this.tp + this.fp + this.tn + this.fn
    const precision = this.tp + this.fp ? this.tp / (this.tp + this.fp) : 0
    const recall = this.tp + this.fn ? this.tp / (this.tp + this.fn) : 0
    const fpr = this.fp + this.tn ? this.fp / (this.fp + this.tn) : 0
    const baseRate = total ? (this.tp + this.fn) / total : 0
    return { total, precision, recall, fpr, baseRate }
  }

  draw(ctx: Ctx, _t: number, dt: number) {
    this.flash = Math.max(0, this.flash - dt * 2)
    const { x0, y0, x1, y1 } = BOARD
    const w = x1 - x0, h = y1 - y0
    // opaque backing: this strip lives in the vignetted bottom-left corner, so it
    // needs its own clean dark field for the phosphor text to read against.
    ctx.fillStyle = 'rgba(3,2,0,0.9)'
    ctx.fillRect(x0, y0, w, h)
    ctx.strokeStyle = amber(0.42); ctx.lineWidth = 1
    ctx.strokeRect(x0 + 0.5, y0 + 0.5, w - 1, h - 1)
    text(ctx, 'OPERATING POINT', x0 + 10, y0 - 6, 16, amber(0.62))

    // four columns, left→right, each with a clean gap: matrix | stats | base/drift | ROC
    this.drawMatrix(ctx, x0 + 14, y0 + 14)
    this.drawStats(ctx, x0 + 360, y0 + 18)
    this.drawBaseRate(ctx, x0 + 740, y0 + 18)
    this.drawROC(ctx, x1 - 132, y0 + 12)
  }

  private drawMatrix(ctx: Ctx, x: number, y: number) {
    const cw = 150, ch = 44
    const cells: { c: Cell; n: number; label: string; col: string; good: boolean }[] = [
      { c: 'FN', n: this.fn, label: 'LEAKED', col: PAL.alert, good: false },
      { c: 'TP', n: this.tp, label: 'CAUGHT', col: amber(0.85), good: true },
      { c: 'TN', n: this.tn, label: 'CLEAR', col: amber(0.62), good: true },
      { c: 'FP', n: this.fp, label: 'HARASSED', col: red(0.7), good: false },
    ]
    text(ctx, 'PASSED', x + 42, y - 2, 15, amber(0.62), 'center')
    text(ctx, 'BLOCKED', x + 42 + cw, y - 2, 15, amber(0.62), 'center')
    text(ctx, 'SMUG', x - 8, y + 26, 15, amber(0.62), 'right')
    text(ctx, 'INNO', x - 8, y + 26 + ch, 15, amber(0.62), 'right')
    for (let i = 0; i < 4; i++) {
      const col = i % 2, row = (i / 2) | 0
      const cx = x + col * cw, cy = y + row * ch
      const cell = cells[i]
      const hot = this.lastCell === cell.c ? this.flash : 0
      ctx.fillStyle = cell.good ? 'rgba(20,12,3,0.7)' : 'rgba(30,6,3,0.7)'
      ctx.fillRect(cx, cy, cw - 6, ch - 6)
      ctx.strokeStyle = cell.good ? amber(0.36 + hot * 0.6) : red(0.5 + hot * 0.5)
      ctx.lineWidth = 1 + hot * 2
      ctx.strokeRect(cx + 0.5, cy + 0.5, cw - 7, ch - 7)
      text(ctx, String(cell.n), cx + 10, cy + 29, 28, cell.col)
      text(ctx, cell.label, cx + 42, cy + 17, 16, cell.col)
      text(ctx, cell.c, cx + 42, cy + 31, 13, amber(0.5))
    }
  }

  private drawStats(ctx: Ctx, x: number, y: number) {
    const d = this.derived()
    const rows: [string, number, string][] = [
      ['PRECISION', d.precision, amber(0.8)],
      ['RECALL', d.recall, amber(0.8)],
      ['FALSE-POS RATE', d.fpr, red(0.8)],
    ]
    let yy = y + 6
    for (const [label, val, col] of rows) {
      text(ctx, label, x, yy + 10, 16, amber(0.72))
      const bx = x + 150, bw = 110
      ctx.strokeStyle = amber(0.4); ctx.strokeRect(bx + 0.5, yy + 0.5, bw, 10)
      ctx.fillStyle = col as string; ctx.fillRect(bx + 1, yy + 1, bw * Math.min(1, val), 8)
      text(ctx, val.toFixed(2), bx + bw + 8, yy + 10, 16, col as string)
      yy += 30
    }
  }

  private drawBaseRate(ctx: Ctx, x: number, y: number) {
    const d = this.derived()
    text(ctx, 'BASE RATE (smuggler share)', x, y + 10, 16, amber(0.72))
    const bx = x, by = y + 18, bw = 180, bh = 10
    ctx.strokeStyle = amber(0.4); ctx.strokeRect(bx + 0.5, by + 0.5, bw, bh)
    ctx.fillStyle = amber(0.75); ctx.fillRect(bx + 1, by + 1, bw * Math.min(1, d.baseRate), bh - 2)
    text(ctx, `${(d.baseRate * 100).toFixed(0)}%`, bx + bw + 8, by + 10, 16, amber(0.85))
    // drift sparkline across waves
    text(ctx, 'DRIFT', x, y + 48, 15, amber(0.6))
    const sx = x + 56, sy = y + 40, sw = 150, sh = 22
    ctx.strokeStyle = amber(0.2); ctx.strokeRect(sx + 0.5, sy + 0.5, sw, sh)
    if (this.baseHist.length > 1) {
      ctx.strokeStyle = amber(0.8); ctx.lineWidth = 1; ctx.beginPath()
      this.baseHist.forEach((v, i) => {
        const px = sx + (sw * i) / (this.baseHist.length - 1)
        const py = sy + sh - sh * Math.min(1, v)
        i ? ctx.lineTo(px, py) : ctx.moveTo(px, py)
      })
      ctx.stroke()
    }
  }

  private drawROC(ctx: Ctx, x: number, y: number) {
    const s = 108
    ctx.strokeStyle = amber(0.3); ctx.lineWidth = 1
    ctx.strokeRect(x + 0.5, y + 0.5, s, s)
    text(ctx, 'ROC', x, y - 2, 15, amber(0.6))
    text(ctx, 'FPR', x + s / 2 - 10, y + s + 14, 13, amber(0.5))
    // chance diagonal
    ctx.strokeStyle = amber(0.18); ctx.setLineDash([2, 3])
    ctx.beginPath(); ctx.moveTo(x, y + s); ctx.lineTo(x + s, y); ctx.stroke(); ctx.setLineDash([])
    // trail of past operating points
    this.points.forEach((p, i) => {
      const px = x + s * p.fpr, py = y + s - s * p.recall
      const last = i === this.points.length - 1
      ctx.fillStyle = last ? PAL.alert : amber(0.3 + 0.4 * (i / Math.max(1, this.points.length)))
      const r = last ? 4 : 2
      ctx.fillRect(px - r, py - r, r * 2, r * 2)
      if (last) { text(ctx, 'now', px + 6, py + 4, 12, PAL.alert) }
    })
    // live point (from current wave)
    const d = this.derived()
    if (d.total) {
      const px = x + s * d.fpr, py = y + s - s * d.recall
      ctx.strokeStyle = amber(0.9); ctx.strokeRect(px - 3.5, py - 3.5, 7, 7)
    }
  }
}
