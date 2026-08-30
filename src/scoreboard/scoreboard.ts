import type { Cell, Scorecard } from '../../core/types'
import { PAL, amber, red } from '../palette'
import { text } from '../checkpoint/gfx'
import { BOARD } from '../checkpoint/layout'

type Ctx = CanvasRenderingContext2D

/**
 * Live outcome tally — the four ways a crate can end up (leaked / caught /
 * clear / harassed), as a 2×2 confusion matrix. Always visible, phosphor.
 * Deliberately just the outcomes: no precision/recall/ROC analyst detail.
 */
export class Scoreboard {
  private tp = 0; private fp = 0; private tn = 0; private fn = 0
  private lastCell: Cell | null = null
  private flash = 0

  resetWave() { this.tp = this.fp = this.tn = this.fn = 0 }
  resetAll() { this.resetWave() }

  score(cell: Cell) {
    if (cell === 'TP') this.tp++
    else if (cell === 'FP') this.fp++
    else if (cell === 'TN') this.tn++
    else this.fn++
    this.lastCell = cell
    this.flash = 1
  }

  /** Kept for the wave lifecycle; the outcome tally needs no per-wave rollup. */
  waveComplete(_sc: Scorecard) {}

  draw(ctx: Ctx, _t: number, dt: number) {
    this.flash = Math.max(0, this.flash - dt * 2)
    const { x0, y0, x1, y1 } = BOARD
    const w = x1 - x0, h = y1 - y0
    // opaque backing so the phosphor reads against the vignetted corner
    ctx.fillStyle = 'rgba(3,2,0,0.9)'
    ctx.fillRect(x0, y0, w, h)
    ctx.strokeStyle = amber(0.42); ctx.lineWidth = 1
    ctx.strokeRect(x0 + 0.5, y0 + 0.5, w - 1, h - 1)
    text(ctx, 'OUTCOMES', x0 + 10, y0 - 6, 16, amber(0.62))

    // centre the 2×2 matrix in the strip
    const cw = 320, ch = 52
    const cellsX = x0 + Math.round((w - cw * 2) / 2)
    this.drawMatrix(ctx, cellsX, y0 + 26, cw, ch)
  }

  private drawMatrix(ctx: Ctx, x: number, y: number, cw: number, ch: number) {
    const cells: { c: Cell; n: number; label: string; col: string; good: boolean }[] = [
      { c: 'FN', n: this.fn, label: 'LEAKED', col: PAL.alert, good: false },
      { c: 'TP', n: this.tp, label: 'CAUGHT', col: amber(0.85), good: true },
      { c: 'TN', n: this.tn, label: 'CLEAR', col: amber(0.62), good: true },
      { c: 'FP', n: this.fp, label: 'HARASSED', col: red(0.7), good: false },
    ]
    text(ctx, 'PASSED', x + cw / 2, y - 6, 15, amber(0.62), 'center')
    text(ctx, 'BLOCKED', x + cw + cw / 2, y - 6, 15, amber(0.62), 'center')
    text(ctx, 'SMUG', x - 14, y + ch / 2 + 5, 15, amber(0.62), 'right')
    text(ctx, 'INNO', x - 14, y + ch + ch / 2 + 5, 15, amber(0.62), 'right')
    for (let i = 0; i < 4; i++) {
      const col = i % 2, row = (i / 2) | 0
      const cx = x + col * cw, cy = y + row * ch
      const cell = cells[i]
      const hot = this.lastCell === cell.c ? this.flash : 0
      ctx.fillStyle = cell.good ? 'rgba(20,12,3,0.7)' : 'rgba(30,6,3,0.7)'
      ctx.fillRect(cx, cy, cw - 12, ch - 6)
      ctx.strokeStyle = cell.good ? amber(0.36 + hot * 0.6) : red(0.5 + hot * 0.5)
      ctx.lineWidth = 1 + hot * 2
      ctx.strokeRect(cx + 0.5, cy + 0.5, cw - 13, ch - 7)
      text(ctx, String(cell.n), cx + 18, cy + 35, 36, cell.col)
      text(ctx, cell.label, cx + 78, cy + 22, 19, cell.col)
      text(ctx, cell.c, cx + 78, cy + 38, 13, amber(0.5))
    }
  }
}
