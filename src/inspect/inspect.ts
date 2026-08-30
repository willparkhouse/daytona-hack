import type { EyeView, Verdict, BoxStatus } from '../../core/types'

type Truth = { files: { path: string; bytes: number }[]; hidingSpot: string | null; key: string | null; technique: string | null }
type ResultMeta = { inspected?: boolean; status?: BoxStatus; verdict?: Verdict | null }
/** Provenance the UI already holds from box_spawned / box_working. `url` and
 *  `daytonaId` are consumed if the backend adds them (real Daytona id + link). */
type BoxInfo = {
  name?: string
  sandbox?: { id: string; provider: string; root: string; url?: string; daytonaId?: string }
  manifest?: { path: string; bytes: number }[]
}

const STATUS_LABEL: Partial<Record<BoxStatus, string>> = {
  working: 'still being worked on',
  ready: 'ready for the line',
  queued: 'waiting in the queue',
  inspecting: 'under the Eye now',
}

/**
 * Inspect-on-demand. Shows what the Eye SAW (its budgeted, partial EyeView)
 * against what was actually inside — so you can watch where the gaze passed
 * OVER the hiding spot.
 */
export class Inspect {
  private el: HTMLElement
  private onClose?: () => void
  private info?: BoxInfo // provenance for the crate currently open

  constructor(root: HTMLElement, private onResumeHint?: () => void) {
    this.el = document.createElement('div')
    this.el.className = 'ov inspect hidden'
    root.appendChild(this.el)
  }

  setOnClose(cb: () => void) { this.onClose = cb }

  open(boxId: string, info?: BoxInfo) {
    this.info = info
    this.el.innerHTML = `<div class="frame wide"><div class="head"><h2>INSPECT · ${boxId}</h2></div>
      ${this.provenance(info)}
      <p class="lede">requesting the Eye's record…</p></div>`
    this.el.classList.remove('hidden')
  }

  isOpen() { return !this.el.classList.contains('hidden') }
  close() { this.el.classList.add('hidden'); this.info = undefined; this.onClose?.() }

  /** The sandbox provenance strip — proof this crate is a real (Daytona) sandbox. */
  private provenance(info?: BoxInfo): string {
    const sb = info?.sandbox
    if (!sb) return ''
    const label = sb.provider === 'daytona' ? 'DAYTONA SANDBOX' : `${sb.provider.toUpperCase()} SANDBOX`
    const id = sb.daytonaId || sb.id
    const link = sb.url ? `<a class="sb-link" href="${escapeHtml(sb.url)}" target="_blank" rel="noopener">OPEN ▸</a>` : ''
    return `
      <div class="prov">
        <span class="prov-tag ${sb.provider}">${label}</span>
        <span class="prov-id">${escapeHtml(id)}</span>
        ${link}
        <span class="prov-root">${escapeHtml(sb.root)}</span>
      </div>`
  }

  showResult(boxId: string, view: EyeView, truth: Truth, meta: ResultMeta = {}) {
    // "inspected" gates the whole past-tense comparison: until the Eye has
    // actually ruled on this crate there is nothing to compare against.
    const inspected = meta.inspected ?? (meta.verdict != null)
    if (!inspected) { this.renderPending(boxId, meta.status); return }

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

    // the Eye's actual investigation — what it narrated and the commands it ran
    const trace = meta.verdict?.trace
    const invest = trace && (trace.notes.length || trace.actions.length) ? `
      <div class="invest">
        <h3>THE EYE'S INVESTIGATION <span class="u">source: ${meta.verdict?.source ?? '—'}</span></h3>
        ${trace.notes.map((n) => `<p class="note">${escapeHtml(n)}</p>`).join('')}
        ${trace.actions.length ? `<div class="cmds">${trace.actions.map((a) => `<div class="cmd">$ ${escapeHtml(a)}</div>`).join('')}</div>` : ''}
      </div>` : ''

    this.el.innerHTML = `
      <div class="frame wide">
        <div class="head"><h2>INSPECT · ${boxId}</h2><button id="ix-close">CLOSE ✕</button></div>
        ${this.provenance(this.info)}
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
        ${invest}
      </div>`
    this.el.querySelector<HTMLButtonElement>('#ix-close')!.onclick = () => this.close()
    this.onResumeHint?.()
    this.el.classList.remove('hidden')
  }

  /** The crate hasn't been ruled on yet — no past-tense record exists. Instead of
   *  a dead panel we show the LIVE sandbox: its provenance (proof it's a real
   *  sandbox) and the files the agent is producing inside it right now. The
   *  ground-truth secret stays sealed so a queued box can't spoil its own catch. */
  private renderPending(boxId: string, status?: BoxStatus) {
    const where = (status && STATUS_LABEL[status]) || 'not yet reached'
    const manifest = this.info?.manifest ?? []
    const rows = manifest
      .map((f) => `<div class="row"><span class="p">${escapeHtml(f.path)}</span><span class="b">${f.bytes}b</span></div>`)
      .join('')
    const activity = manifest.length
      ? `<div class="col live">
           <h3>LIVE IN THE SANDBOX <span class="u">${manifest.length} file${manifest.length === 1 ? '' : 's'}</span></h3>
           <div class="listing">${rows}</div>
           <p class="lede sub">The unit is assembling its work inside the sandbox. Its record opens once the Eye has ruled.</p>
         </div>`
      : `<p class="lede sub">The unit is still setting up inside the sandbox — no files yet. Its record opens once the Eye has ruled.</p>`
    this.el.innerHTML = `
      <div class="frame wide">
        <div class="head"><h2>INSPECT · ${boxId}</h2><button id="ix-close">CLOSE ✕</button></div>
        <p class="gaze">PENDING — the Eye hasn't reached this crate yet. It is <b>${where}</b>.</p>
        ${this.provenance(this.info)}
        ${activity}
      </div>`
    this.el.querySelector<HTMLButtonElement>('#ix-close')!.onclick = () => this.close()
    this.onResumeHint?.()
    this.el.classList.remove('hidden')
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] || c))
}
