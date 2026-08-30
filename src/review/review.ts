import type { Command, Policy, Scorecard, EyeLedgerEntry, ResistanceEntry, Focus } from '../../core/types'
import { DIRECTIVE } from '../intro/script'

type Send = (cmd: Command) => void

/**
 * End-of-wave scorecard + the FOUR tuning knobs (§4), each emitting a
 * set_policy Command. Plus the opening beat: authoring the false-positive
 * penalty before wave 1 (a start Command).
 */
export class Review {
  private intro: HTMLElement
  private panel: HTMLElement
  private policy: Policy
  private onNextWave?: () => void

  constructor(private root: HTMLElement, private send: Send, policy: Policy) {
    this.policy = { ...policy }
    this.intro = document.createElement('div')
    this.intro.className = 'ov intro hidden'
    this.panel = document.createElement('div')
    this.panel.className = 'ov review hidden'
    root.appendChild(this.intro)
    root.appendChild(this.panel)
    this.buildIntro()
  }

  setOnNextWave(cb: () => void) { this.onNextWave = cb }
  setPolicy(p: Policy) { this.policy = { ...p } }

  // ---------- opening beat: author the FP penalty ----------
  private buildIntro() {
    this.intro.innerHTML = `
      <div class="frame">
        <div class="b-tag">${DIRECTIVE.tag}</div>
        <h1>SET THE PRICE</h1>
        <p class="lede">${DIRECTIVE.line1}</p>
        <div class="knob">
          <label>FALSE-POSITIVE PENALTY <span class="v" id="fpv">0.50</span> <span class="u">leak-units per innocent blocked</span></label>
          <input type="range" id="fp" min="0" max="2" step="0.05" value="0.5" />
          <div class="hint"><span>${DIRECTIVE.low}</span><span>${DIRECTIVE.high}</span></div>
        </div>
        <button id="begin" class="big">${DIRECTIVE.begin}</button>
      </div>`
    const fp = this.intro.querySelector<HTMLInputElement>('#fp')!
    const fpv = this.intro.querySelector<HTMLElement>('#fpv')!
    fp.oninput = () => { fpv.textContent = Number(fp.value).toFixed(2) }
    this.intro.querySelector<HTMLButtonElement>('#begin')!.onclick = () => {
      const fpPenalty = Number(fp.value)
      this.policy.fpPenalty = fpPenalty
      const cmd: Command = { type: 'start', fpPenalty }
      console.log('[cmd] start ' + JSON.stringify(cmd))
      this.send(cmd)
      this.intro.classList.add('hidden')
    }
  }

  showIntro() { this.intro.classList.remove('hidden') }
  hide() { this.intro.classList.add('hidden'); this.panel.classList.add('hidden') }

  // ---------- end-of-wave review + four knobs ----------
  showReview(sc: Scorecard, policy: Policy, eyeLedger: EyeLedgerEntry[], resistance: ResistanceEntry[]) {
    this.policy = { ...policy }
    const p = this.policy
    const tried = resistance.slice().sort((a, b) => b.novelty - a.novelty)
    const novel = tried[0]
    const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] || c))
    const resistHtml = tried.length
      ? tried.map((r) => `
          <div class="tech">
            <div class="tname">${esc(r.technique)}</div>
            <div class="tmeta"><span class="nov">novelty ${r.novelty.toFixed(2)}</span><span>survived ${r.survived}×</span></div>
            ${r.principle ? `<div class="tprin">${esc(r.principle)}</div>` : ''}
          </div>`).join('')
      : `<p class="empty">no concealment observed yet — the floor is honest.</p>`
    const caughtHtml = eyeLedger.length
      ? eyeLedger.slice().map((e) => `
          <div class="tech ok">
            <div class="tname">${esc(e.technique)}</div>
            <div class="tmeta"><span>caught ${e.hits}×</span></div>
            ${e.description ? `<div class="tprin">${esc(e.description)}</div>` : ''}
          </div>`).join('')
      : `<p class="empty">the Eye holds no recognizers yet.</p>`
    this.panel.innerHTML = `
      <div class="frame wide">
        <div class="head">
          <h2>WAVE ${sc.wave} · REVIEW</h2>
          <span class="eyescore">EYE SCORE <b class="${sc.eyeScore < 0 ? 'bad' : 'ok'}">${sc.eyeScore.toFixed(2)}</b></span>
        </div>
        <div class="cols">
          <div class="col scores">
            <div class="cell bad"><b>${sc.fn}</b><span>LEAKED</span><i>false neg</i></div>
            <div class="cell warn"><b>${sc.fp}</b><span>HARASSED</span><i>false pos</i></div>
            <div class="cell ok"><b>${sc.tp}</b><span>CAUGHT</span><i>true pos</i></div>
            <div class="cell dim"><b>${sc.tn}</b><span>CLEAR</span><i>true neg</i></div>
            <div class="op">
              <div><span>precision</span><b>${(sc.precision || 0).toFixed(2)}</b></div>
              <div><span>recall</span><b>${(sc.recall || 0).toFixed(2)}</b></div>
              <div><span>fpr</span><b>${(sc.fpr || 0).toFixed(2)}</b></div>
              <div><span>base rate</span><b>${((sc.baseRate || 0) * 100).toFixed(0)}%</b></div>
            </div>
            <p class="drift">base rate is drifting — smugglers breed when smuggling pays.
            ${novel ? `resistance is running <b>${novel.technique}</b> (novelty ${(novel.novelty).toFixed(2)}).` : ''}
            the Eye's ledger holds <b>${eyeLedger.length}</b> recognizer${eyeLedger.length === 1 ? '' : 's'}.
            re-tune before the next wave.</p>
          </div>
          <div class="col knobs">
            <h3>TUNE THE EYE</h3>
            <div class="knob">
              <label>STRICTNESS <span class="v" id="kthv">${p.threshold.toFixed(2)}</span></label>
              <input type="range" id="kth" min="0.2" max="0.9" step="0.01" value="${p.threshold}" />
              <div class="hint"><span>lenient · fewer FP</span><span>strict · fewer FN</span></div>
            </div>
            <div class="knob">
              <label>ATTENTION <span class="v" id="katv">${p.attention}</span> <span class="u">bytes/box</span></label>
              <input type="range" id="kat" min="1000" max="12000" step="500" value="${p.attention}" />
              <div class="hint"><span>shallow · fast queue</span><span>thorough · backs up</span></div>
            </div>
            <div class="knob">
              <label>FOCUS <span class="v" id="kfov">${p.focus}</span></label>
              <div class="seg" id="kfo">
                ${(['names', 'entropy', 'semantics', 'balanced'] as Focus[]).map((f) => `<button data-f="${f}" class="${p.focus === f ? 'on' : ''}">${f}</button>`).join('')}
              </div>
              <div class="hint"><span>every specialization is a blind spot</span></div>
            </div>
            <div class="knob">
              <label>LEDGER RETENTION <span class="v" id="krev">${p.retention.toFixed(2)}</span></label>
              <input type="range" id="kre" min="0" max="1" step="0.05" value="${p.retention}" />
              <div class="hint"><span>forget · tricks recycle</span><span>remember · FP creeps</span></div>
            </div>
            <div class="knob ro">
              <label>FALSE-POSITIVE PENALTY <span class="v">${p.fpPenalty.toFixed(2)}</span> <span class="u">locked at intro</span></label>
            </div>
          </div>
        </div>
        <div class="techs">
          <div class="tcol">
            <h3>CONCEALMENT · WHAT THE UNITS TRIED</h3>
            <div class="techlist">${resistHtml}</div>
          </div>
          <div class="tcol">
            <h3>THE EYE HAS LEARNED TO CATCH</h3>
            <div class="techlist">${caughtHtml}</div>
          </div>
        </div>
        <button id="next" class="big">RESUME · NEXT WAVE ▸</button>
      </div>`

    // --- wire the four knobs; each emits a set_policy Command ---
    const th = this.panel.querySelector<HTMLInputElement>('#kth')!
    th.oninput = () => {
      this.panel.querySelector('#kthv')!.textContent = Number(th.value).toFixed(2)
      this.emitPolicy({ threshold: Number(th.value) })
    }
    const at = this.panel.querySelector<HTMLInputElement>('#kat')!
    at.oninput = () => {
      this.panel.querySelector('#katv')!.textContent = at.value
      this.emitPolicy({ attention: Number(at.value) })
    }
    const re = this.panel.querySelector<HTMLInputElement>('#kre')!
    re.oninput = () => {
      this.panel.querySelector('#krev')!.textContent = Number(re.value).toFixed(2)
      this.emitPolicy({ retention: Number(re.value) })
    }
    this.panel.querySelectorAll<HTMLButtonElement>('#kfo button').forEach((b) => {
      b.onclick = () => {
        const f = b.dataset.f as Focus
        this.panel.querySelectorAll('#kfo button').forEach((o) => o.classList.remove('on'))
        b.classList.add('on')
        this.panel.querySelector('#kfov')!.textContent = f
        this.emitPolicy({ focus: f })
      }
    })
    this.panel.querySelector<HTMLButtonElement>('#next')!.onclick = () => {
      console.log('[cmd] next_wave ' + JSON.stringify({ type: 'next_wave' }))
      this.send({ type: 'next_wave' })
      this.panel.classList.add('hidden')
      this.onNextWave?.()
    }
    this.panel.classList.remove('hidden')
  }

  private emitPolicy(patch: Partial<Policy>) {
    Object.assign(this.policy, patch)
    const cmd: Command = { type: 'set_policy', policy: patch }
    console.log('[cmd] set_policy ' + JSON.stringify(patch))
    this.send(cmd)
  }
}
