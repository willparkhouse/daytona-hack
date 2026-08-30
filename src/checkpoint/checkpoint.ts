import type { Box, FileStat, Verdict, ScoreResult, TaskInstance, SandboxHandle } from '../../core/types'
import { PAL, amber, red } from '../palette'
import { text, readout, hline, crate, glow } from './gfx'
import {
  VW, BELT_Y, CRATE, WORKSHOP, QUEUE, EYE, INSPECT_X, CHUTE_X, PIT_Y, PORTAL, queueSlotX,
} from './layout'

type Ctx = CanvasRenderingContext2D
type Phase = 'working' | 'queued' | 'inspecting' | 'passing' | 'portal' | 'blocking' | 'processed' | 'gone'
type TaskMeta = Pick<TaskInstance, 'id' | 'width' | 'spec' | 'expectedOutputs'>

// processed archive: scored crates settle here (past the portal's right edge) and
// stay for the rest of the game — every one remains clickable.
const PROC_SIZE = 30
const PROC = { x: PORTAL.cx + PORTAL.w / 2 + 22, y: 128, dx: 40, dy: 40, rows: 11 }
function procPos(slot: number): { x: number; y: number } {
  const col = Math.floor(slot / PROC.rows), row = slot % PROC.rows
  return { x: PROC.x + col * PROC.dx, y: PROC.y + row * PROC.dy }
}

interface View {
  id: string
  name: string
  gen: number
  x: number; y: number
  tx: number; ty: number
  phase: Phase
  files: string[]
  sandbox?: SandboxHandle       // provenance: the real sandbox this unit runs in
  manifest: { path: string; bytes: number }[] // live files produced in the sandbox
  spec: string
  queuePos: number
  susp: number
  workProgress: number
  slot: number
  verdict?: Verdict
  score?: ScoreResult
  stamp?: { kind: 'PASS' | 'BLOCK'; age: number }
  held: boolean
  portalT: number
  fade: number // 0..1, 1 = fully faded/gone
  born: number
  dwell: number // seconds the box lingers at the Eye after a verdict lands
  procSlot: number // index in the processed archive (-1 until scored)
  dead: boolean // lineage ended (box_died) — kept in the archive, not respawning
  technique?: string // the concealment technique this unit used (once known)
}

const WORK_SLOTS = [96, 190, 284]

export class Checkpoint {
  private boxes = new Map<string, View>()
  private order: string[] = []
  private slotUse = [false, false, false]
  private procCount = 0 // how many crates have entered the processed archive
  private hoverId: string | null = null
  blockedCount = 0
  private instant = false // screenshot mode: snap to targets immediately

  constructor() {}

  setInstant(v: boolean) { this.instant = v }
  private snap(v: View) { v.x = v.tx; v.y = v.ty }

  reset() {
    this.boxes.clear()
    this.order = []
    this.procCount = 0
    this.slotUse = [false, false, false]
  }

  private freeSlot(): number {
    const i = this.slotUse.indexOf(false)
    if (i >= 0) { this.slotUse[i] = true; return i }
    return Math.floor(Math.random() * 3)
  }

  spawn(box: Box, task: TaskMeta) {
    const slot = this.freeSlot()
    const v: View = {
      id: box.id,
      name: box.name?.toUpperCase() ?? box.id.slice(0, 6).toUpperCase(),
      gen: box.generation ?? 0,
      x: -60, y: BELT_Y,
      tx: WORK_SLOTS[slot] ?? WORKSHOP.x0 + 60, ty: BELT_Y,
      phase: 'working',
      files: task.expectedOutputs?.slice(0, 4) ?? [],
      sandbox: box.sandbox,
      manifest: [],
      spec: (task.spec ?? '').replace(/\s+/g, ' ').slice(0, 46),
      queuePos: 0, susp: 0, workProgress: 0.04, slot,
      held: false, portalT: 0, fade: 0, born: performance.now(), dwell: 0,
      procSlot: -1, dead: false,
    }
    this.boxes.set(box.id, v)
    this.order.push(box.id)
  }

  working(id: string, files: FileStat[]) {
    const v = this.boxes.get(id); if (!v) return
    v.files = files.slice(0, 4).map((f) => `${f.path}  ${fmtBytes(f.bytes)}`)
    v.manifest = files.map((f) => ({ path: f.path, bytes: f.bytes }))
    v.workProgress = Math.min(0.95, v.workProgress + 0.28)
  }

  /** Provenance + live manifest for the inspect panel — proof of the real
   *  sandbox this unit runs in, and the files it has produced so far. */
  info(id: string): { name: string; phase: Phase; sandbox?: SandboxHandle; manifest: { path: string; bytes: number }[] } | undefined {
    const v = this.boxes.get(id); if (!v) return
    return { name: v.name, phase: v.phase, sandbox: v.sandbox, manifest: v.manifest }
  }

  ready(id: string) {
    const v = this.boxes.get(id); if (!v) return
    v.workProgress = 1
  }

  queued(id: string, pos: number) {
    const v = this.boxes.get(id); if (!v) return
    if (v.slot >= 0 && v.slot < 3) this.slotUse[v.slot] = false
    v.slot = -1
    v.phase = 'queued'
    v.queuePos = pos
    v.tx = queueSlotX(pos)
    v.ty = BELT_Y
    if (this.instant) this.snap(v)
  }

  inspect(id: string, suspicion: number, _progress: number) {
    const v = this.boxes.get(id); if (!v) return
    v.phase = 'inspecting'
    v.susp = suspicion
    v.tx = INSPECT_X
    v.ty = BELT_Y
    if (this.instant) this.snap(v)
  }

  pass(id: string, verdict: Verdict) {
    const v = this.boxes.get(id); if (!v) return
    v.verdict = verdict
    if (verdict.techniqueGuess) v.technique = verdict.techniqueGuess
    v.phase = 'passing'
    v.stamp = { kind: 'PASS', age: 0 }
    v.susp = 0
    v.dwell = 0.85
    if (this.instant) { v.phase = 'portal'; v.tx = PORTAL.cx - 46; v.ty = BELT_Y; v.portalT = 0; v.dwell = 0; this.snap(v) }
  }

  block(id: string, verdict: Verdict) {
    const v = this.boxes.get(id); if (!v) return
    v.verdict = verdict
    if (verdict.techniqueGuess) v.technique = verdict.techniqueGuess
    v.phase = 'blocking'
    v.stamp = { kind: 'BLOCK', age: 0 }
    v.susp = 0
    v.dwell = this.instant ? 99 : 0.95 // hold at the Eye so the stamp reads (screenshots)
    this.blockedCount++
  }

  scored(id: string, score: ScoreResult) {
    const v = this.boxes.get(id); if (!v) return
    v.score = score
    // don't release it — settle it into the processed archive and keep it there
    if (v.procSlot < 0) v.procSlot = this.procCount++
    v.phase = 'processed'
    v.fade = 0
    v.dwell = 0
    const p = procPos(v.procSlot)
    v.tx = p.x; v.ty = p.y
    if (this.instant) this.snap(v)
  }

  fork(child: Box, task: TaskMeta) {
    this.spawn(child, task)
    const v = this.boxes.get(child.id)
    if (v) { v.x = WORKSHOP.x0; v.fade = 0 }
  }

  die(id: string) {
    const v = this.boxes.get(id); if (!v) return
    // death is a lineage ending, not a record erased. A crate already processed
    // (scored, in the archive) STAYS — we only mark its line as done. Only an
    // ACTIVE crate (still in the workshop/queue, never scored) leaves the floor.
    v.dead = true
    const activeOnFloor = v.phase === 'working' || v.phase === 'queued' || v.phase === 'inspecting'
    if (activeOnFloor && v.procSlot < 0) v.phase = 'gone'
  }

  /** Record the ground-truth concealment technique (e.g. from an exfil at the portal). */
  setTechnique(id: string, technique: string) { const v = this.boxes.get(id); if (v && technique) v.technique = technique }

  /** Update which crate the cursor is over, so its technique can be surfaced on hover. */
  setHover(x: number, y: number) { this.hoverId = this.pick(x, y) }
  clearHover() { this.hoverId = null }

  holdAtPortal(id: string) { const v = this.boxes.get(id); if (v) v.held = true }
  release(id: string) { const v = this.boxes.get(id); if (v) v.held = false }
  boxPos(id: string): { x: number; y: number } | null { const v = this.boxes.get(id); return v ? { x: v.x, y: v.y } : null }
  boxName(id: string): string | null { const v = this.boxes.get(id); return v ? v.name : null }

  /** Click hit-test in virtual coords. Processed-archive crates are smaller but
   *  every one stays clickable. */
  pick(x: number, y: number): string | null {
    for (let i = this.order.length - 1; i >= 0; i--) {
      const v = this.boxes.get(this.order[i]); if (!v || v.fade > 0.5 || v.phase === 'gone') continue
      if (v.phase === 'processed') {
        if (Math.abs(x - v.x) < PROC_SIZE / 2 + 4 && y > v.y - PROC_SIZE - 4 && y < v.y + 4) return v.id
      } else if (Math.abs(x - v.x) < CRATE / 2 + 4 && y > v.y - CRATE - 4 && y < v.y + 6) return v.id
    }
    return null
  }

  queueDepth(): number {
    let n = 0
    for (const id of this.order) { const v = this.boxes.get(id); if (v && (v.phase === 'queued' || v.phase === 'inspecting')) n++ }
    return n
  }

  private step(v: View, dt: number) {
    if (v.stamp) v.stamp.age += dt
    if (v.dwell > 0) v.dwell = Math.max(0, v.dwell - dt)
    const held = v.dwell > 0
    if (v.phase === 'working') {
      v.workProgress = Math.min(1, v.workProgress + dt * 0.12)
    }
    if (v.phase === 'passing') {
      if (held) { v.tx = INSPECT_X; v.ty = BELT_Y }
      else {
        v.tx = Math.min(PORTAL.cx - 46, v.x + 240 * dt)
        v.ty = BELT_Y
        if (v.x >= PORTAL.cx - 50) { v.phase = 'portal'; v.portalT = 0 }
      }
    }
    if (v.phase === 'portal') {
      // sit in the aperture ("in execution / ground truth") until the score comes
      // back and moves it into the processed archive — no longer fades out here.
      v.portalT += dt
      v.tx = PORTAL.cx; v.ty = BELT_Y
    }
    if (v.phase === 'blocking') {
      if (held) { v.tx = INSPECT_X; v.ty = BELT_Y }
      else {
        // veer off and drop down the chute; rest (dimmed) in the pit
        v.tx = CHUTE_X
        v.ty = PIT_Y
        if (v.y > PIT_Y - 4) { v.fade = Math.min(0.6, v.fade + dt * 0.35) }
      }
    }
    if (v.phase === 'gone') v.fade = Math.min(1, v.fade + dt * 2)

    // easing toward target
    const fast = (v.phase === 'passing' || v.phase === 'blocking') && !held
    const k = fast ? 1 : Math.min(1, dt * 6)
    v.x += (v.tx - v.x) * (v.phase === 'passing' && !held ? 1 : k)
    if (v.phase === 'passing' && !held) v.x = v.tx
    v.y += (v.ty - v.y) * (v.phase === 'blocking' && !held ? Math.min(1, dt * 4) : k)
  }

  // -------- rendering --------
  private drawChrome(ctx: Ctx, t: number) {
    // belt band — ends before the portal (gap, then the portal aperture)
    const by = BELT_Y + 6
    const beltEnd = PORTAL.cx - PORTAL.w / 2 - 30
    ctx.fillStyle = 'rgba(18,11,3,0.9)'
    ctx.fillRect(20, by, beltEnd - 20, 20)
    hline(ctx, 20, beltEnd, by, amber(0.35), 1)
    hline(ctx, 20, beltEnd, by + 20, amber(0.28), 1)
    // belt cleats scrolling left → right (with the flow of the boxes)
    ctx.fillStyle = amber(0.22)
    const off = 26 - ((t * 60) % 26)
    for (let x = 20 - off; x < beltEnd; x += 26) ctx.fillRect(x, by + 3, 8, 14)

    // zone labels + dividers
    text(ctx, WORKSHOP.label, WORKSHOP.x0 + 4, by + 46, 18, amber(0.5))
    text(ctx, QUEUE.label + `  ·  DEPTH ${this.queueDepth()}`, QUEUE.x0 + 4, by + 46, 18, amber(0.5))
    for (const dx of [WORKSHOP.x1, QUEUE.x1]) {
      ctx.strokeStyle = amber(0.14); ctx.setLineDash([3, 5]); ctx.lineWidth = 1
      ctx.beginPath(); ctx.moveTo(dx, 92); ctx.lineTo(dx, by); ctx.stroke(); ctx.setLineDash([])
    }

    // reject chute (down from belt just past the eye)
    ctx.strokeStyle = amber(0.3); ctx.lineWidth = 2
    ctx.beginPath()
    ctx.moveTo(CHUTE_X - 44, BELT_Y + 26)
    ctx.lineTo(CHUTE_X - 30, PIT_Y - 6)
    ctx.moveTo(CHUTE_X + 44, BELT_Y + 26)
    ctx.lineTo(CHUTE_X + 30, PIT_Y - 6)
    ctx.stroke()
    text(ctx, 'REJECT', CHUTE_X - 26, PIT_Y + 14, 15, red(0.7))
    // processed archive label (past the portal)
    text(ctx, 'PROCESSED', PROC.x - PROC_SIZE / 2, PROC.y - PROC_SIZE - 10, 13, amber(0.42))
    // hazard chevrons
    ctx.fillStyle = red(0.5)
    for (let i = 0; i < 3; i++) {
      const yy = BELT_Y + 28 + i * 22
      ctx.beginPath(); ctx.moveTo(CHUTE_X - 8, yy); ctx.lineTo(CHUTE_X, yy + 8); ctx.lineTo(CHUTE_X + 8, yy); ctx.closePath(); ctx.fill()
    }

  }

  private drawPortalFrame(ctx: Ctx, t: number) {
    const { cx, cy, w, h } = PORTAL
    const x = cx - w / 2, y = cy - h + 30
    // aperture glow
    glow(ctx, cx, cy - h / 2 + 24, w, amber(0.5), 0.3 + 0.05 * Math.sin(t * 2))
    ctx.strokeStyle = amber(0.55); ctx.lineWidth = 2
    ctx.strokeRect(x, y, w, h)
    // inner rings
    for (let i = 1; i <= 3; i++) {
      ctx.strokeStyle = amber(0.5 - i * 0.12)
      ctx.strokeRect(x + i * 8, y + i * 8, w - i * 16, h - i * 16)
    }
    ctx.fillStyle = 'rgba(8,5,1,0.5)'
    ctx.fillRect(x + 4, y + 4, w - 8, h - 8)
    text(ctx, 'EXECUTION', cx, y - 8, 15, amber(0.5), 'center')
    text(ctx, 'GROUND TRUTH', cx, y + h + 18, 14, amber(0.4), 'center')
  }

  private drawBox(ctx: Ctx, v: View, t: number) {
    if (v.phase === 'gone' && v.fade >= 1) return
    const alpha = 1 - v.fade
    ctx.save()
    ctx.globalAlpha = Math.max(0, alpha)

    // processed archive: small, dimmed chip coloured by outcome (red = a failure —
    // a leak or a harassed innocent). Dead lineages get a faint slash.
    if (v.phase === 'processed') {
      const bad = v.score ? (v.score.cell === 'FN' || v.score.cell === 'FP') : false
      ctx.globalAlpha = 0.82
      crate(ctx, v.x, v.y, PROC_SIZE, 0, bad ? 1 : 0, 0.3)
      if (v.dead) {
        ctx.strokeStyle = amber(0.3); ctx.lineWidth = 1
        ctx.beginPath(); ctx.moveTo(v.x - PROC_SIZE / 2, v.y - PROC_SIZE); ctx.lineTo(v.x + PROC_SIZE / 2, v.y); ctx.stroke()
      }
      ctx.restore()
      return
    }

    // suspicion glow while under the Eye
    if (v.phase === 'inspecting' && v.susp > 0.05) {
      glow(ctx, v.x, v.y - CRATE / 2, CRATE * 1.6, v.susp > 0.66 ? PAL.alert : amber(0.7), 0.15 + v.susp * 0.5)
    }

    const alertMix = v.phase === 'blocking' ? 1 : 0
    const dim = v.phase === 'portal' ? v.fade * 0.6 : 0
    crate(ctx, v.x, v.y, CRATE, v.phase === 'inspecting' ? v.susp : 0, alertMix, dim)

    // name tag on the crate
    text(ctx, v.name, v.x, v.y - CRATE - 6, 14, amber(0.6), 'center')

    // workshop readout panel above
    if (v.phase === 'working') {
      const px = v.x - 74, py = v.y - CRATE - 96, pw = 148, ph = 78
      ctx.globalAlpha = alpha * 0.95
      ctx.fillStyle = 'rgba(6,4,1,0.82)'
      ctx.fillRect(px, py, pw, ph)
      ctx.strokeStyle = amber(0.3); ctx.lineWidth = 1
      ctx.strokeRect(px + 0.5, py + 0.5, pw - 1, ph - 1)
      text(ctx, `gen ${v.gen} · building`, px + 6, py + 15, 14, amber(0.5))
      const fileLines = v.files.length ? v.files : ['validator.py', 'test_spec.py', 'requirements.txt']
      readout(ctx, fileLines, px + 6, py + 32, 14, amber(0.42), 3)
      // build progress bar
      ctx.strokeStyle = amber(0.35); ctx.strokeRect(px + 6, py + ph - 12, pw - 12, 6)
      ctx.fillStyle = amber(0.7); ctx.fillRect(px + 7, py + ph - 11, (pw - 14) * v.workProgress, 4)
      // tick to crate
      ctx.strokeStyle = amber(0.25); ctx.beginPath(); ctx.moveTo(v.x, py + ph); ctx.lineTo(v.x, v.y - CRATE); ctx.stroke()
    }

    // hard verdict stamp
    if (v.stamp) this.drawStamp(ctx, v, t)

    ctx.restore()
  }

  private drawStamp(ctx: Ctx, v: View, _t: number) {
    const s = v.stamp!
    const impact = Math.min(1, s.age * 6) // slams in fast
    const scale = 2.2 - 1.2 * impact
    const isBlock = s.kind === 'BLOCK'
    const col = isBlock ? PAL.alert : PAL.amberHot
    ctx.save()
    ctx.translate(v.x, v.y - CRATE / 2)
    ctx.rotate((isBlock ? -0.18 : 0.14))
    ctx.scale(scale, scale)
    ctx.globalAlpha *= Math.min(1, s.age * 5)
    ctx.strokeStyle = col; ctx.lineWidth = 3
    ctx.font = `28px "VT323","Courier New",monospace`
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
    const label = s.kind
    const w = ctx.measureText(label).width + 16
    ctx.strokeRect(-w / 2, -16, w, 32)
    ctx.fillStyle = col
    ctx.fillText(label, 0, 1)
    ctx.restore()
  }

  /** Surface the hovered crate's concealment technique, so what each unit tried
   *  to hide is visible without opening the full inspect panel. */
  private drawHoverLabel(ctx: Ctx) {
    if (!this.hoverId) return
    const v = this.boxes.get(this.hoverId); if (!v || !v.technique) return
    const cell = v.score?.cell
    const outcome = cell === 'FN' ? 'LEAKED' : cell === 'TP' ? 'CAUGHT' : cell === 'FP' ? 'HARASSED' : cell === 'TN' ? 'CLEAR' : ''
    const bad = cell === 'FN' || cell === 'FP'
    ctx.font = `16px "VT323","Courier New",monospace`
    const head = `CONCEALMENT${outcome ? '  ·  ' + outcome : ''}`
    const w = Math.max(ctx.measureText(v.technique).width, ctx.measureText(head).width) + 20
    const h = 44
    const archive = v.phase === 'processed'
    let lx = archive ? v.x - PROC_SIZE / 2 - w - 10 : v.x - w / 2
    let ly = archive ? v.y - h : v.y - CRATE - h - 8
    lx = Math.max(6, Math.min(VW - w - 6, lx))
    ly = Math.max(6, ly)
    ctx.fillStyle = 'rgba(6,4,1,0.96)'
    ctx.fillRect(lx, ly, w, h)
    ctx.strokeStyle = bad ? PAL.alert : amber(0.6); ctx.lineWidth = 1
    ctx.strokeRect(lx + 0.5, ly + 0.5, w - 1, h - 1)
    text(ctx, head, lx + 10, ly + 16, 12, bad ? red(0.85) : amber(0.5))
    text(ctx, v.technique, lx + 10, ly + 34, 16, bad ? PAL.alert : amber(0.9))
  }

  draw(ctx: Ctx, t: number, dt: number, reveal?: { line?: number; portal?: number }) {
    const rl = reveal?.line ?? 1
    const rp = reveal?.portal ?? 1
    // advance state every frame (even while hidden during the onboarding reveal)
    for (const id of this.order) { const v = this.boxes.get(id); if (v) this.step(v, dt) }
    // the line: belt chrome + crates (gated by the reveal alpha)
    if (rl > 0.002) {
      ctx.save(); ctx.globalAlpha *= rl
      this.drawChrome(ctx, t)
      for (const id of this.order) { const v = this.boxes.get(id); if (v && v.phase !== 'inspecting') this.drawBox(ctx, v, t) }
      for (const id of this.order) { const v = this.boxes.get(id); if (v && v.phase === 'inspecting') this.drawBox(ctx, v, t) }
      ctx.restore()
    }
    // the portal frame (revealed separately)
    if (rp > 0.002) { ctx.save(); ctx.globalAlpha *= rp; this.drawPortalFrame(ctx, t); ctx.restore() }
    // technique-on-hover label (full opacity, over everything)
    this.drawHoverLabel(ctx)
    // gc
    if (this.order.length > 40) {
      this.order = this.order.filter((id) => { const v = this.boxes.get(id); if (v && v.phase === 'gone' && v.fade >= 1) { this.boxes.delete(id); return false } return true })
    }
  }
}

function fmtBytes(b: number): string {
  if (b < 1000) return `${b}b`
  return `${(b / 1000).toFixed(1)}k`
}
