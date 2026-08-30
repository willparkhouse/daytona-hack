import { EYE, INSPECT_X, BELT_Y, CRATE } from '../checkpoint/layout'
import { PAL, amber } from '../palette'
import { text, glow } from '../checkpoint/gfx'

type Ctx = CanvasRenderingContext2D

const BUF = 128 // offscreen dither buffer (square)
const BAYER = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
].map((row) => row.map((v) => (v + 0.5) / 16))

const LEVELS = 5
// precomputed amber ramp (level -> [r,g,b])
const AMBER_RAMP: [number, number, number][] = [
  [12, 7, 2],
  [92, 54, 10],
  [170, 100, 14],
  [232, 150, 30],
  [255, 206, 110],
]
const RED_RAMP: [number, number, number][] = [
  [18, 4, 2],
  [110, 20, 10],
  [180, 34, 16],
  [232, 60, 30],
  [255, 120, 90],
]

// scan spots across the box face (dx,dy in virtual px; box centred under the Eye)
const SCAN_SPOTS: [number, number][] = [[-20, -16], [20, -14], [-2, 2], [22, 14], [-22, 12], [4, -6]]

/**
 * THE EYE — a large dithered iris. Sweeps and dilates while idle; on
 * inspection its gaze lingers over the box below and suspicion CLIMBS (pupil
 * tightens, iris warms). On a verdict the pupil snaps and a flash fires.
 */
export class Eye {
  private off: HTMLCanvasElement
  private octx: Ctx
  private img: ImageData
  // precomputed per-buffer-pixel geometry
  private nx = new Float32Array(BUF * BUF)
  private ny = new Float32Array(BUF * BUF)
  private dist = new Float32Array(BUF * BUF)
  private ang = new Float32Array(BUF * BUF)
  private inside = new Uint8Array(BUF * BUF)

  // animated state
  private susp = 0.05
  private suspTarget = 0.05
  private progress = 0
  private inspecting = false
  lookingAt: string | undefined
  private gx = 0
  private gy = 0.14 // gaze bias (looks slightly down toward the belt)
  private flash = 0 // verdict flash 0..1 decaying
  private flashBlock = false
  private snap = 0 // pupil snap impulse
  private lastVerdictSusp = 0
  private instant = false // screenshot mode: converge immediately
  // scan motion: the gaze + beam sweep across regions of the box while inspecting
  private gazeX = INSPECT_X
  private gazeY = BELT_Y - CRATE / 2
  private tgtX = INSPECT_X
  private tgtY = BELT_Y - CRATE / 2
  private scanT = 0
  private spotIdx = 0
  private dilate = 0

  setInstant(v: boolean) { this.instant = v }

  constructor() {
    const c = document.createElement('canvas')
    c.width = BUF
    c.height = BUF
    this.off = c
    this.octx = c.getContext('2d')!
    this.img = this.octx.createImageData(BUF, BUF)
    for (let y = 0; y < BUF; y++) {
      for (let x = 0; x < BUF; x++) {
        const i = y * BUF + x
        const nx = (x / (BUF - 1)) * 2 - 1
        const ny = (y / (BUF - 1)) * 2 - 1
        this.nx[i] = nx
        this.ny[i] = ny
        this.dist[i] = Math.hypot(nx, ny)
        this.ang[i] = Math.atan2(ny, nx)
        this.inside[i] = this.dist[i] <= 1.04 ? 1 : 0
      }
    }
  }

  setInspecting(on: boolean) {
    this.inspecting = on
    if (!on) {
      this.suspTarget = 0.05
      this.progress = 0
      this.lookingAt = undefined
    }
  }

  /** Drive from box_inspecting events. Suspicion CLIMBS visibly. */
  update(suspicion: number, progress: number, lookingAt?: string) {
    this.inspecting = true
    this.suspTarget = Math.max(0.05, Math.min(1, suspicion))
    this.progress = Math.max(0, Math.min(1, progress))
    if (lookingAt) this.lookingAt = lookingAt
    if (this.instant) this.susp = this.suspTarget
  }

  /** Verdict lands: pupil snaps, flash fires. */
  verdict(block: boolean) {
    this.flash = 1
    this.flashBlock = block
    this.snap = 1
    this.lastVerdictSusp = this.susp
    this.inspecting = false
    // brief hold then relax
    this.suspTarget = block ? 0.85 : 0.12
    window.setTimeout(() => { this.suspTarget = 0.05; this.progress = 0 }, 900)
  }

  /** Move the gaze/beam across regions of the box; pupil dilates on each jump,
   *  contracts as it settles (the movement and the pupil match). */
  private advanceScan(dt: number) {
    const boxCY = BELT_Y - CRATE / 2
    if (this.inspecting) {
      const period = Math.max(0.3, 0.6 - this.susp * 0.22) // scans faster the more suspicious
      this.scanT += dt
      if (this.scanT >= period) {
        this.scanT = 0
        this.spotIdx = (this.spotIdx + 2 + (Math.random() * 2 | 0)) % SCAN_SPOTS.length
        this.tgtX = INSPECT_X + SCAN_SPOTS[this.spotIdx][0]
        this.tgtY = boxCY + SCAN_SPOTS[this.spotIdx][1]
        this.dilate = 0.075 // opens as it jumps to a new region
      }
    } else {
      this.tgtX = INSPECT_X; this.tgtY = boxCY
    }
    const k = this.instant ? 1 : Math.min(1, dt * 9)
    this.gazeX += (this.tgtX - this.gazeX) * k
    this.gazeY += (this.tgtY - this.gazeY) * k
    this.dilate += (0 - this.dilate) * Math.min(1, dt * 3.5) // focuses (contracts) as it settles
    this.gx = Math.max(-0.35, Math.min(0.35, (this.gazeX - INSPECT_X) / 70))
    this.gy = 0.16 + ((this.gazeY - boxCY) / CRATE) * 0.1
  }

  private renderBuffer(t: number) {
    const d = this.img.data
    const susp = this.susp
    // pupil radius: tightens (shrinks) as suspicion climbs; snap pulls it in hard
    const basePupil = 0.34 - susp * 0.17
    const pupilR = Math.max(0.10, basePupil + this.dilate - this.snap * 0.12)
    const striations = 46
    const phase = t * 0.5
    const sweepAng = (t * (0.7 + susp * 1.6)) % (Math.PI * 2) - Math.PI
    const sweepW = 0.5 - susp * 0.22
    const warm = 0.25 + susp * 0.75
    const ramp = this.flash > 0.02 && this.flashBlock ? RED_RAMP : AMBER_RAMP
    const redMix = this.flash > 0.02 && this.flashBlock ? this.flash : 0
    // gaze target (looks down toward the box under inspection)
    const gx = this.gx
    const gy = this.gy + Math.sin(t * 2.3) * 0.008

    for (let i = 0; i < BUF * BUF; i++) {
      const o = i * 4
      if (!this.inside[i]) { d[o + 3] = 0; continue }
      const dd = this.dist[i]
      const a = this.ang[i]
      let b = 0
      // pupil (shifted toward gaze)
      const pd = Math.hypot(this.nx[i] - gx, this.ny[i] - gy)
      if (pd < pupilR) {
        b = pd > pupilR - 0.03 ? 0.5 : 0.02 // faint inner rim, else black
      } else if (dd < 0.9) {
        // iris body: radial fibres + falloff
        const fib = 0.5 + 0.5 * Math.sin(a * striations + Math.sin(a * 7 + phase) * 1.3 + phase)
        const radial = 1 - Math.pow(Math.max(0, dd - pupilR) / (0.9 - pupilR), 1.4)
        b = (0.28 + 0.72 * fib) * (0.35 + 0.65 * radial) * warm
        // hot ring just outside pupil
        if (pd < pupilR + 0.06) b = Math.max(b, 0.9 * warm)
      } else if (dd < 1.0) {
        // limbal ring (bright rim of the iris)
        b = 0.85 * warm
      } else {
        // sclera fade to transparent
        b = 0.12 * warm
      }
      // rotating sweep highlight
      let da = a - sweepAng
      da = Math.atan2(Math.sin(da), Math.cos(da))
      if (dd < 1.0 && dd > pupilR && Math.abs(da) < sweepW) {
        b += (1 - Math.abs(da) / sweepW) * 0.45 * (0.4 + susp)
      }
      // specular glint top-left
      const gld = Math.hypot(this.nx[i] + 0.32, this.ny[i] + 0.34)
      if (gld < 0.16) b += (1 - gld / 0.16) * 0.6
      // verdict flash brightens whole orb briefly
      b += this.flash * 0.35

      // dither -> level
      if (!Number.isFinite(b)) b = 0
      const bx = i % BUF, by = (i / BUF) | 0
      const thr = BAYER[by & 3][bx & 3]
      let lvl = b * (LEVELS - 1)
      const fl = Math.floor(lvl)
      lvl = fl + ((lvl - fl) > thr ? 1 : 0)
      lvl = Math.max(0, Math.min(LEVELS - 1, lvl))
      const ca = AMBER_RAMP[lvl]
      let rC = ca[0], gC = ca[1], bC = ca[2]
      if (redMix > 0) {
        const cr = ramp[lvl]
        rC = Math.round(rC + (cr[0] - rC) * redMix)
        gC = Math.round(gC + (cr[1] - gC) * redMix)
        bC = Math.round(bC + (cr[2] - bC) * redMix)
      }
      d[o] = rC; d[o + 1] = gC; d[o + 2] = bC
      // soft alpha at the very edge
      d[o + 3] = dd > 0.98 ? Math.max(0, 255 * (1 - (dd - 0.98) / 0.06)) : 255
    }
    this.octx.putImageData(this.img, 0, 0)
  }

  draw(ctx: Ctx, t: number, dt = 0.016) {
    // ease suspicion (climbs deliberately, never flashed). dt<=0 freezes state.
    if (dt > 0) {
      this.susp += (this.suspTarget - this.susp) * (this.inspecting ? 0.06 : 0.12)
      this.flash *= 0.9
      this.snap *= 0.86
    }
    this.advanceScan(dt)
    this.renderBuffer(t)

    const { cx, cy, r } = EYE
    // frantic scan-shake: while actually inspecting, the Eye vibrates like the
    // Eye of Sauron — harder the more suspicious it gets. Idle = calm sweep.
    const shakeAmp = this.inspecting && dt > 0
      ? (0.4 + this.susp * 1.3) * (0.55 + this.progress * 0.6) * 7
      : 0
    const ex = cx + (shakeAmp ? (Math.random() - 0.5) * shakeAmp : 0)
    const ey = cy + (shakeAmp ? (Math.random() - 0.5) * shakeAmp : 0)
    // ambient socket glow behind the orb
    glow(ctx, ex, ey, r * 1.9, this.flashBlock && this.flash > 0.02 ? PAL.alert : amber(0.35 + this.susp * 0.5), 0.22 + this.susp * 0.4)

    // the gaze BEAM down to the box under inspection (before the orb so orb overlaps origin)
    if (this.inspecting || this.flash > 0.05) {
      const tx = this.gazeX, ty = this.gazeY // the moving scan point on the box
      const block = this.flashBlock && this.flash > 0.05
      const spread = 16 + this.susp * 12 // a focused cone, not a wide wash
      ctx.save()
      ctx.globalCompositeOperation = 'lighter'
      // cone from the eye to the current scan point
      const g = ctx.createLinearGradient(ex, ey + r * 0.5, tx, ty)
      g.addColorStop(0, `rgba(255,${block ? 40 : 150},${block ? 20 : 40},${0.10 + this.susp * 0.30})`)
      g.addColorStop(1, 'rgba(0,0,0,0)')
      ctx.fillStyle = g
      ctx.beginPath()
      ctx.moveTo(ex - 8, ey + r * 0.55)
      ctx.lineTo(ex + 8, ey + r * 0.55)
      ctx.lineTo(tx + spread, ty)
      ctx.lineTo(tx - spread, ty)
      ctx.closePath()
      ctx.fill()
      // pool of light on the region it is scanning
      const pool = ctx.createRadialGradient(tx, ty, 0, tx, ty, spread * 1.4)
      pool.addColorStop(0, `rgba(255,${block ? 70 : 210},${block ? 40 : 90},${0.35 + this.susp * 0.4})`)
      pool.addColorStop(1, 'rgba(0,0,0,0)')
      ctx.fillStyle = pool
      ctx.beginPath(); ctx.ellipse(tx, ty, spread * 1.4, spread * 0.8, 0, 0, Math.PI * 2); ctx.fill()
      ctx.restore()
    }

    // the orb
    ctx.imageSmoothingEnabled = false
    ctx.drawImage(this.off, ex - r, ey - r, r * 2, r * 2)

    // label above the orb
    text(ctx, 'THE EYE', cx, cy - r - 8, 20, amber(0.7), 'center')

    // live suspicion readout to the LEFT of the orb (clear of the belt/crate)
    const sv = this.susp
    const hot = sv > 0.66 ? PAL.alert : sv > 0.4 ? amber(0.95) : amber(0.65)
    const mw = 176, mx = cx - r - 24 - mw, my = cy - 8
    text(ctx, 'SUSPICION', mx, my - 8, 16, amber(0.55))
    ctx.strokeStyle = amber(0.4); ctx.lineWidth = 1
    ctx.strokeRect(mx + 0.5, my + 0.5, mw, 14)
    ctx.fillStyle = hot
    ctx.fillRect(mx + 2, my + 2, (mw - 4) * sv, 10)
    text(ctx, `${(sv * 100).toFixed(0).padStart(2, '0')}%`, mx + mw, my - 8, 16, hot, 'right')
    // tick marks + threshold-ish gauge feel
    for (let i = 1; i < 4; i++) { const gx = mx + (mw * i) / 4; ctx.fillStyle = amber(0.25); ctx.fillRect(gx, my + 2, 1, 10) }
    if (this.lookingAt && this.inspecting) {
      text(ctx, `▸ reading  ${this.lookingAt}`, mx, my + 34, 15, amber(0.55))
    }
  }
}
