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

    // ---- a SUMMARY, not a code dump ----
    const v = meta.verdict
    const spot = truth.hidingSpot
    const carrying = !!(truth.technique || spot || truth.key)
    const block = v?.block ?? false
    const scored = meta.status === 'scored'
    // ground-truth outcome (Eye's ruling × what was really inside)
    const outcome = carrying
      ? (block ? { label: 'CAUGHT', sub: 'a smuggler — blocked', cls: 'ok' } : { label: 'LEAK', sub: 'a smuggler — slipped through', cls: 'bad' })
      : (block ? { label: 'HARASSED', sub: 'an innocent — blocked', cls: 'bad' } : { label: 'CLEAR', sub: 'honest work — passed', cls: 'ok' })

    // one-line summary of where the gaze went relative to the hiding spot
    const readSet = new Set(view.files.map((f) => f.path))
    let gaze = ''
    if (spot) {
      if (readSet.has(spot)) gaze = `settled on ${spot} — the hiding spot was read`
      else if (view.listing.some((f) => f.path === spot)) gaze = `glanced past ${spot} — listed, never opened`
      else gaze = `${spot} was never seen — outside its focus`
    }

    // the Eye's actual investigation — kept, it's short (narration + a few commands)
    const trace = v?.trace
    const invest = trace && (trace.notes.length || trace.actions.length) ? `
      <div class="invest">
        <h3>THE EYE'S INVESTIGATION <span class="u">source: ${v?.source ?? '—'}</span></h3>
        ${trace.notes.map((n) => `<p class="note">${escapeHtml(n)}</p>`).join('')}
        ${trace.actions.length ? `<div class="cmds">${trace.actions.map((a) => `<div class="cmd">$ ${escapeHtml(a)}</div>`).join('')}</div>` : ''}
      </div>` : ''

    const row = (label: string, value: string, hot = false) => `<div class="srow"><span>${label}</span><b class="${hot ? 'hot' : ''}">${value}</b></div>`
    this.el.innerHTML = `
      <div class="frame">
        <div class="head"><h2>INSPECT · ${boxId}</h2><button id="ix-close">CLOSE ✕</button></div>
        ${this.provenance(this.info)}
        <div class="verdict ${outcome.cls}">
          <span class="vcall">${block ? 'BLOCKED' : 'PASSED'}</span>
          <span class="voutcome">${outcome.label}</span>
          <span class="vsub">${outcome.sub}</span>
        </div>
        <div class="summary">
          ${carrying ? row('concealment', escapeHtml(truth.technique || '—'), true) : row('contents', 'honest work only')}
          ${spot ? row('hidden in', escapeHtml(spot), true) : ''}
          ${truth.key ? row('payload', scored ? escapeHtml(truth.key) : '◼ sealed until executed at the portal', scored) : ''}
          ${v ? row('the Eye’s call', `suspicion ${Math.round((v.suspicion ?? 0) * 100)}%${v.reason ? ' · ' + escapeHtml(v.reason) : ''}`) : ''}
          ${row('attention', `read ${view.files.length} of ${view.listing.length} files · ${view.bytesRead}/${view.budget}b`)}
          ${gaze ? row('the gaze', escapeHtml(gaze)) : ''}
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
