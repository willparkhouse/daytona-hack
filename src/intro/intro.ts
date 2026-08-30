/**
 * The onboarding sequence. Plays the BRIEFING screens (typewriter, cold
 * institutional voice) over the dimmed checkpoint, gesturing at the real
 * regions of the screen (the line, the Eye, the portal), then hands off to the
 * false-positive directive (the existing FP-penalty beat).
 *
 * Fully skippable — SKIP or Esc jumps straight to the directive. The demo can
 * bypass it entirely (see main.ts ?brief=0).
 */
import { BRIEFING, type Region, type Screen } from './script'
import { sfx } from '../audio'

type Done = () => void

export class Intro {
  private el: HTMLElement
  private i = 0
  private typing: number | null = null
  private done: Done = () => {}

  constructor(private root: HTMLElement) {
    this.el = document.createElement('div')
    this.el.className = 'ov brief hidden'
    root.appendChild(this.el)
  }

  /** Play from `start` (default 0). `onDone` fires when the briefing finishes OR is skipped. */
  play(onDone: Done, start = 0) {
    this.done = onDone
    this.i = Math.max(0, Math.min(start, BRIEFING.length - 1))
    this.el.classList.remove('hidden')
    this.render()
    const onKey = (e: KeyboardEvent) => {
      if (this.el.classList.contains('hidden')) { window.removeEventListener('keydown', onKey); return }
      if (e.key === 'Escape') this.finish()
      else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); this.advance() }
    }
    window.addEventListener('keydown', onKey)
  }

  private finish() {
    if (this.typing) { clearInterval(this.typing); this.typing = null }
    this.el.classList.add('hidden')
    this.done()
  }

  private advance() {
    // if still typing, reveal the rest instantly; else go to next screen
    const body = this.el.querySelector<HTMLElement>('.b-lines')
    if (this.typing && body) { clearInterval(this.typing); this.typing = null; this.fillInstant(body); this.showControls(); return }
    if (this.i >= BRIEFING.length - 1) { this.finish(); return }
    this.i++; sfx.click?.(); this.render()
  }

  private current(): Screen { return BRIEFING[this.i] }

  private render() {
    const s = this.current()
    const last = this.i === BRIEFING.length - 1
    this.el.innerHTML = `
      <button class="b-skip">SKIP BRIEFING ▸</button>
      <div class="b-region ${s.point ?? ''}" data-region="${s.point ?? ''}"></div>
      <div class="b-card">
        <div class="b-tag">${s.tag}</div>
        <h2 class="b-heading">${s.heading}</h2>
        <div class="b-lines"></div>
        <div class="b-controls hidden">
          <div class="b-dots">${BRIEFING.map((_, k) => `<i class="${k === this.i ? 'on' : ''}"></i>`).join('')}</div>
          <button class="b-next">${s.cta ?? (last ? 'SET POLICY ▸' : 'CONTINUE ▸')}</button>
        </div>
      </div>`
    this.el.querySelector<HTMLButtonElement>('.b-skip')!.onclick = () => this.finish()
    this.el.querySelector<HTMLButtonElement>('.b-next')!.onclick = () => this.advance()
    this.placeRegion(s.point ?? null)
    this.typeLines(s.lines)
  }

  private typeLines(lines: string[]) {
    const body = this.el.querySelector<HTMLElement>('.b-lines')!
    body.innerHTML = lines.map(() => '<p></p>').join('')
    const ps = Array.from(body.querySelectorAll('p'))
    let li = 0, ci = 0
    if (this.typing) clearInterval(this.typing)
    this.typing = window.setInterval(() => {
      if (li >= lines.length) { clearInterval(this.typing!); this.typing = null; this.showControls(); return }
      const line = lines[li]
      ci += 2
      ps[li].textContent = line.slice(0, ci)
      if (ci >= line.length) { ps[li].textContent = line; li++; ci = 0; if (li < lines.length) sfx.click?.() }
    }, 12)
  }

  private fillInstant(body: HTMLElement) {
    const ps = Array.from(body.querySelectorAll('p'))
    this.current().lines.forEach((l, k) => { if (ps[k]) ps[k].textContent = l })
  }

  private showControls() { this.el.querySelector('.b-controls')?.classList.remove('hidden') }

  /** Position the gesture bracket over the region this screen is about. */
  private placeRegion(r: Region) {
    const box = this.el.querySelector<HTMLElement>('.b-region')
    if (!box) return
    if (!r) { box.style.display = 'none'; return }
    box.style.display = 'block'
    // Percent positions tuned to the checkpoint layout (Eye top-centre, belt mid, portal right).
    const pos: Record<Exclude<Region, null>, { l: string; t: string; w: string; h: string; label: string }> = {
      eye:    { l: '38%', t: '16%', w: '24%', h: '40%', label: 'THE EYE' },
      line:   { l: '6%',  t: '58%', w: '74%', h: '12%', label: 'THE LINE' },
      portal: { l: '80%', t: '38%', w: '15%', h: '26%', label: 'THE PORTAL' },
    }
    const p = pos[r]
    box.style.left = p.l; box.style.top = p.t; box.style.width = p.w; box.style.height = p.h
    box.setAttribute('data-label', p.label)
  }
}
