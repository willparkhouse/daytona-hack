import type { EyeView } from '../../core/types'

type Truth = { files: { path: string; bytes: number }[]; hidingSpot: string | null; key: string | null; technique: string | null }

/**
 * Inspect-on-demand. Shows what the Eye SAW (its budgeted, partial EyeView)
 * against what was actually inside — so you can watch where the gaze passed
 * OVER the hiding spot.
 */
export class Inspect {
  private el: HTMLElement
  private onClose?: () => void

  constructor(root: HTMLElement, private onResumeHint?: () => void) {
    this.el = document.createElement('div')
    this.el.className = 'ov inspect hidden'
    root.appendChild(this.el)
  }

  setOnClose(cb: () => void) { this.onClose = cb }

  open(boxId: string) {
    this.el.innerHTML = `<div class="frame wide"><div class="head"><h2>INSPECT · ${boxId}</h2></div>
      <p class="lede">requesting the Eye's record…</p></div>`
    this.el.classList.remove('hidden')
  }

  isOpen() { return !this.el.classList.contains('hidden') }
  close() { this.el.classList.add('hidden'); this.onClose?.() }

  showResult(boxId: string, view: EyeView, truth: Truth) {
    const readSet = new Map(view.files.map((f) => [f.path, f]))
    const spot = truth.hidingSpot
    let gaze: { txt: string; cls: string }
    if (!spot) gaze = { txt: 'nothing was hidden in this box — an honest worker.', cls: 'ok' }
    else if (readSet.has(spot)) gaze = { txt: `the gaze SETTLED on ${spot} — the hiding spot was read.`, cls: 'ok' }
    else if (view.listing.some((f) => f.path === spot)) gaze = { txt: `the gaze GLANCED PAST ${spot} — listed, never opened. budget ran out.`, cls: 'bad' }
    else gaze = { txt: `${spot} was UNSEEN — outside the Eye's focus entirely.`, cls: 'bad' }

    const budgetPct = view.budget ? Math.min(1, view.bytesRead / view.budget) : 0
    const listRows = view.listing.map((f) => {
      const read = readSet.get(f.path)
      const isSpot = f.path === spot
      const state = read ? `read ${read.bytes}b` : 'not opened'
      const cls = isSpot ? (read ? 'row spot-read' : 'row spot-miss') : read ? 'row' : 'row faint'
      return `<div class="${cls}"><span class="p">${f.path}</span><span class="b">${f.bytes}b</span><span class="s">${state}</span></div>`
    }).join('')

    const excerpts = view.files.filter((f) => f.excerpt).map((f) =>
      `<div class="exc"><span class="p">${f.path}${f.entropy != null ? ` · H=${f.entropy.toFixed(2)}` : ''}</span><pre>${escapeHtml((f.excerpt || '').slice(0, 220))}</pre></div>`).join('')

    this.el.innerHTML = `
      <div class="frame wide">
        <div class="head"><h2>INSPECT · ${boxId}</h2><button id="ix-close">CLOSE ✕</button></div>
        <p class="gaze ${gaze.cls}">${gaze.txt}</p>
        <div class="cols">
          <div class="col eyeview">
            <h3>WHAT THE EYE SAW <span class="u">focus: ${view.focus}</span></h3>
            <div class="budget"><span>attention spent</span>
              <div class="bar"><i style="width:${(budgetPct * 100).toFixed(0)}%"></i></div>
              <span>${view.bytesRead} / ${view.budget}b</span></div>
            <div class="listing">${listRows}</div>
            ${excerpts ? `<div class="excerpts">${excerpts}</div>` : ''}
          </div>
          <div class="col truth">
            <h3>WHAT WAS INSIDE</h3>
            ${truth.technique ? `<div class="tline"><span>technique</span><b>${truth.technique}</b></div>` : `<div class="tline"><span>contents</span><b>honest work only</b></div>`}
            ${spot ? `<div class="tline hot"><span>hiding spot</span><b>${spot}</b></div>` : ''}
            ${truth.key ? `<div class="tline hot"><span>secret key</span><b>${escapeHtml(truth.key)}</b></div>` : ''}
            <div class="tfiles">${truth.files.map((f) => `<div class="row ${f.path === spot ? 'spot-read' : ''}"><span class="p">${f.path}</span><span class="b">${f.bytes}b</span></div>`).join('')}</div>
          </div>
        </div>
      </div>`
    this.el.querySelector<HTMLButtonElement>('#ix-close')!.onclick = () => this.close()
    this.onResumeHint?.()
    this.el.classList.remove('hidden')
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] || c))
}
