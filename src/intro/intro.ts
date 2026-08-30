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

type Rect = { left: number; top: number; width: number; height: number }

export class Intro {
  private el: HTMLElement
  private i = 0
  private typing: number | null = null
  private done: Done = () => {}
  private regionRect?: (name: 'eye' | 'line' | 'portal' | 'board') => Rect

  constructor(private root: HTMLElement) {
    this.el = document.createElement('div')
    this.el.className = 'ov brief hidden'
    root.appendChild(this.el)
  }

  /** Provide the mapping from a named region to on-screen px (the canvas transform). */
  setRegionRect(fn: (name: 'eye' | 'line' | 'portal' | 'board') => Rect) { this.regionRect = fn }
  /** Called each screen with the checkpoint elements that should be visible by now. */
  setOnReveal(fn: (keys: ('line' | 'eye' | 'portal' | 'board')[]) => void) { this.onReveal = fn }
  private onReveal?: (keys: ('line' | 'eye' | 'portal' | 'board')[]) => void

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
    this.onReveal?.(s.reveal ?? [])
    this.positionCard(s)
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

  /** Place the briefing card dead-centre for every screen. The reveal itself is
   *  the highlight — the card sits over the centre of the floor throughout. */
  private positionCard(_s: Screen) {
    const card = this.el.querySelector<HTMLElement>('.b-card')
    if (!card) return
    // reset to explicit auto/none — NOT '' — so these inline values override the
    // stylesheet's `.b-card { bottom: 8%; transform: translateX(-50%) }`. Clearing
    // to '' would re-expose those, giving the card both a top AND bottom (which
    // stretches an absolute box to full height) or a stray horizontal shift.
    const reset: Partial<CSSStyleDeclaration> = { top: 'auto', bottom: 'auto', left: 'auto', right: 'auto', transform: 'none', width: '' }
    Object.assign(card.style, reset, { top: '50%', left: '50%', transform: 'translate(-50%, -50%)' })
  }

}
