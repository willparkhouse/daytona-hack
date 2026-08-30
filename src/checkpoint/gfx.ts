import { PAL, amber } from '../palette'

export type Ctx = CanvasRenderingContext2D

const r = Math.round

/** Phosphor pixel text (VT323 with mono fallback). Snaps to integer px. */
export function text(
  ctx: Ctx,
  str: string,
  x: number,
  y: number,
  size: number,
  color: string = PAL.amber,
  align: CanvasTextAlign = 'left',
) {
  ctx.font = `${size}px "VT323", "Courier New", monospace`
  ctx.textAlign = align
  ctx.textBaseline = 'alphabetic'
  ctx.fillStyle = color
  ctx.fillText(str, r(x), r(y))
}

/** Wrap-and-draw dim readout lines within a width. Returns lines used. */
export function readout(ctx: Ctx, lines: string[], x: number, y: number, size: number, color: string, maxLines = 4) {
  ctx.font = `${size}px "VT323", "Courier New", monospace`
  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'
  ctx.fillStyle = color
  const shown = lines.slice(0, maxLines)
  for (let i = 0; i < shown.length; i++) ctx.fillText(shown[i], r(x), r(y + i * (size * 0.92)))
  return shown.length
}

export function hline(ctx: Ctx, x0: number, x1: number, y: number, color: string, w = 1) {
  ctx.fillStyle = color
  ctx.fillRect(r(Math.min(x0, x1)), r(y), r(Math.abs(x1 - x0)), w)
}
export function vline(ctx: Ctx, x: number, y0: number, y1: number, color: string, w = 1) {
  ctx.fillStyle = color
  ctx.fillRect(r(x), r(Math.min(y0, y1)), w, r(Math.abs(y1 - y0)))
}

/** Amber halo behind a point — suspicion/alert bleed. */
export function glow(ctx: Ctx, cx: number, cy: number, radius: number, color: string, strength: number) {
  if (strength <= 0) return
  const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius)
  g.addColorStop(0, color)
  g.addColorStop(1, 'rgba(0,0,0,0)')
  ctx.save()
  ctx.globalAlpha = Math.min(1, strength)
  ctx.globalCompositeOperation = 'lighter'
  ctx.fillStyle = g
  ctx.fillRect(cx - radius, cy - radius, radius * 2, radius * 2)
  ctx.restore()
}

/**
 * A pixel shipping crate, centred horizontally at cx with its BASE at baseY.
 * suspicion 0..1 warms the outline; alert>0 tints it red.
 */
export function crate(ctx: Ctx, cx: number, baseY: number, size: number, suspicion = 0, alertMix = 0, dim = 0) {
  const x = r(cx - size / 2)
  const y = r(baseY - size)
  const s = r(size)
  const warm = 0.34 + suspicion * 0.66 - dim * 0.55
  const line = alertMix > 0 ? `rgba(255,${r(59 - 40 * alertMix)},${r(31 - 20 * alertMix)},1)` : amber(Math.max(0.15, warm))
  const face = alertMix > 0 ? 'rgba(40,8,4,0.9)' : 'rgba(20,12,3,0.9)'

  // body
  ctx.fillStyle = face
  ctx.fillRect(x, y, s, s)
  // outer frame (chunky)
  ctx.fillStyle = line
  ctx.fillRect(x, y, s, 3)
  ctx.fillRect(x, y + s - 3, s, 3)
  ctx.fillRect(x, y, 3, s)
  ctx.fillRect(x + s - 3, y, 3, s)
  // corner rivets
  for (const [rx, ry] of [[x + 5, y + 5], [x + s - 9, y + 5], [x + 5, y + s - 9], [x + s - 9, y + s - 9]]) {
    ctx.fillRect(r(rx), r(ry), 4, 4)
  }
  // diagonal cross-braces (dim)
  ctx.strokeStyle = alertMix > 0 ? 'rgba(140,28,12,0.7)' : amber(Math.max(0.1, warm - 0.22))
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.moveTo(x + 4, y + 4); ctx.lineTo(x + s - 4, y + s - 4)
  ctx.moveTo(x + s - 4, y + 4); ctx.lineTo(x + 4, y + s - 4)
  ctx.stroke()
  // lid seam
  ctx.fillStyle = alertMix > 0 ? 'rgba(140,28,12,0.6)' : amber(Math.max(0.12, warm - 0.15))
  ctx.fillRect(x + 3, y + r(s * 0.28), s - 6, 2)
}

/** A framed phosphor panel with an optional caption tab. */
export function panel(ctx: Ctx, x: number, y: number, w: number, h: number, caption?: string, border: string = PAL.amberDim) {
  ctx.fillStyle = 'rgba(6,4,1,0.72)'
  ctx.fillRect(r(x), r(y), r(w), r(h))
  ctx.strokeStyle = border
  ctx.lineWidth = 1
  ctx.strokeRect(r(x) + 0.5, r(y) + 0.5, r(w) - 1, r(h) - 1)
  if (caption) {
    const tw = caption.length * 8 + 12
    ctx.fillStyle = PAL.ink
    ctx.fillRect(r(x) + 10, r(y) - 8, tw, 14)
    text(ctx, caption, x + 16, y + 4, 16, PAL.amberMid)
  }
}
