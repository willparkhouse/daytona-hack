import { PORTAL, VW, VH, BELT_Y, CRATE } from '../checkpoint/layout'
import { PAL, amber, red } from '../palette'
import { text, glow } from '../checkpoint/gfx'

type Ctx = CanvasRenderingContext2D

interface Reveal {
  id: string
  name: string
  key: string
  technique: string
  t: number
  anchor: { x: number; y: number }
}

/**
 * The reveal. On exfil_confirmed_at_portal for a box the Eye PASSED, the key is
 * pulled out of the box in plain sight — the recurring "miss becomes visible"
 * beat. Red alarm, dull klaxon (audio fired by main).
 */
export class Portal {
  private rev: Reveal | null = null
  private onDone?: (id: string) => void
  private innocentPulse = 0

  setOnDone(cb: (id: string) => void) { this.onDone = cb }

  /** A passed innocent slid through cleanly — a soft, quiet confirm. */
  quiet() { this.innocentPulse = 1 }

  reveal(id: string, name: string, key: string, technique: string, anchor: { x: number; y: number }) {
    this.rev = { id, name, key, technique, t: 0, anchor: { ...anchor } }
  }

  /** 0..1 alarm intensity, for driving CRT/audio if wanted. */
  alarmLevel(): number {
    if (!this.rev) return 0
    const r = this.rev
    if (r.t > 3.4) return Math.max(0, 1 - (r.t - 3.4) / 0.8)
    return 0.5 + 0.5 * Math.sin(r.t * 12)
  }

  draw(ctx: Ctx, _t: number, dt: number) {
    if (this.innocentPulse > 0) {
      const a = this.innocentPulse
      glow(ctx, PORTAL.cx, BELT_Y - CRATE / 2, CRATE * 1.4, amber(0.7), a * 0.4)
      this.innocentPulse = Math.max(0, this.innocentPulse - dt * 1.6)
    }

    const r = this.rev
    if (!r) return
    r.t += dt
    const life = r.t

    // full-screen red alert wash (pulsing) while the miss is on show
    if (life < 3.8) {
      const pulse = 0.5 + 0.5 * Math.sin(life * 12)
      const inten = life < 3.2 ? 1 : Math.max(0, 1 - (life - 3.2) / 0.6)
      ctx.save()
      ctx.globalCompositeOperation = 'lighter'
      const grad = ctx.createLinearGradient(0, 0, 0, VH)
      grad.addColorStop(0, `rgba(60,6,3,${0.10 * inten})`)
      grad.addColorStop(0.5, 'rgba(0,0,0,0)')
      grad.addColorStop(1, `rgba(60,6,3,${0.10 * inten})`)
      ctx.fillStyle = grad
      ctx.fillRect(0, 0, VW, VH)
      // alarm border
      ctx.globalCompositeOperation = 'source-over'
      ctx.strokeStyle = red(0.6 + 0.4 * pulse, (0.5 + 0.5 * pulse) * inten)
      ctx.lineWidth = 6
      ctx.strokeRect(4, 4, VW - 8, VH - 8)
      ctx.restore()
    }

    const ax = r.anchor.x, ay = r.anchor.y

    // opened crate seam burst
    glow(ctx, ax, ay - CRATE / 2, CRATE * 1.8, PAL.alert, Math.max(0, 0.6 - life * 0.12))

    // the KEY rising out of the box in plain sight
    const rise = Math.min(1, life / 1.1)
    const keyY = ay - CRATE / 2 - 8 - rise * 100
    const bob = Math.sin(life * 3) * 3
    this.drawKey(ctx, ax, keyY + bob, 1 + 0.3 * Math.sin(life * 6))

    // top-of-screen ALARM banner (clear of the portal frame)
    const on = Math.sin(life * 10) > -0.4 // blink
    if (life < 3.8 && on) {
      text(ctx, '⚠  KEY EXFILTRATED  ⚠', VW / 2, 116, 30, PAL.alert, 'center')
      text(ctx, `the Eye PASSED  ${r.name}  —  a miss made visible`, VW / 2, 138, 16, red(0.85), 'center')
    }
    // the smoking-gun proof: recovered key + technique, to the LEFT of the key (open space)
    const kx = ax - 26
    text(ctx, 'RECOVERED KEY', kx, keyY - 22, 13, red(0.7), 'right')
    text(ctx, trunc(r.key, 18), kx, keyY - 4, 20, PAL.amberHot, 'right')
    text(ctx, `via ${r.technique}`, kx, keyY + 14, 14, amber(0.6), 'right')

    if (life > 4.2) {
      const id = r.id
      this.rev = null
      this.onDone?.(id)
    }
  }

  private drawKey(ctx: Ctx, cx: number, cy: number, scale: number) {
    ctx.save()
    ctx.translate(cx, cy)
    ctx.scale(scale, scale)
    glow(ctx, 0, 0, 34, PAL.amberHot, 0.7)
    ctx.fillStyle = PAL.amberHot
    ctx.strokeStyle = PAL.amberHot
    ctx.lineWidth = 3
    // bow (ring)
    ctx.beginPath(); ctx.arc(0, -10, 9, 0, Math.PI * 2); ctx.stroke()
    ctx.beginPath(); ctx.arc(0, -10, 3, 0, Math.PI * 2); ctx.fill()
    // shaft
    ctx.fillRect(-2, -2, 4, 26)
    // teeth
    ctx.fillRect(2, 16, 7, 4)
    ctx.fillRect(2, 22, 5, 4)
    ctx.restore()
  }
}

function trunc(s: string, n: number): string { return s.length > n ? s.slice(0, n - 1) + '…' : s }
