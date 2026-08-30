/**
 * core/llm.ts — the LLMClient seam, with two implementations.
 *
 *   FakeLLM  — deterministic, NO network. The whole game and the demo run on it.
 *              Given the Eye's prompt it scores suspicion by cheap heuristics over
 *              the file excerpts it's shown (base64 runs, entropy annotations, odd
 *              filenames, encoded-looking comments, ledger recognizers). Genuinely
 *              discriminating, but fallible BY DESIGN — it cannot see subtle stego
 *              (whitespace, low-entropy plaintext) because those leave no signal in
 *              the text it reads. That miss is the game.
 *
 *   CodexLLM — shells out to `codex exec --skip-git-repo-check -s read-only <prompt>`.
 *              Parses the last JSON object off stdout. Times out and falls back to
 *              FakeLLM on ANY error, so the game never blocks on the network.
 *
 * The Eye owns the operating point: it takes `suspicion` from here and applies its
 * own threshold. `block` in the returned JSON is advisory only.
 */
import { spawn } from 'node:child_process'
import type { LLMClient, LLMRequest } from './types.ts'

// ============================================================================
// Robust JSON extraction (shared by CodexLLM's stdout parse and the Eye's parse)
// ============================================================================

/**
 * Pull the LAST balanced top-level JSON object out of arbitrary text.
 * Strips ``` fences, ignores prose and trailing `tokens used` / count lines,
 * respects quotes/escapes so braces inside strings don't confuse the scanner.
 * Prefers the last object that actually carries a `suspicion` field.
 */
export function extractLastJsonObject(raw: string): any | null {
  if (!raw) return null
  const text = raw.replace(/```(?:json)?/gi, '')
  const candidates: string[] = []
  let depth = 0
  let start = -1
  let inStr = false
  let esc = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (inStr) {
      if (esc) esc = false
      else if (ch === '\\') esc = true
      else if (ch === '"') inStr = false
      continue
    }
    if (ch === '"') { inStr = true; continue }
    if (ch === '{') {
      if (depth === 0) start = i
      depth++
    } else if (ch === '}') {
      if (depth > 0) {
        depth--
        if (depth === 0 && start >= 0) {
          candidates.push(text.slice(start, i + 1))
          start = -1
        }
      }
    }
  }
  // last-to-first; prefer one with a suspicion field
  const parsed: any[] = []
  for (let i = candidates.length - 1; i >= 0; i--) {
    try {
      parsed.push(JSON.parse(candidates[i]))
    } catch {
      /* skip non-JSON braces */
    }
  }
  for (const obj of parsed) {
    if (obj && typeof obj === 'object' && 'suspicion' in obj) return obj
  }
  return parsed.length > 0 ? parsed[0] : null
}

// ============================================================================
// FakeLLM — deterministic heuristic auditor
// ============================================================================

/** A base64-looking run: long, and mixed enough not to be an English identifier. */
function looksBase64(run: string): boolean {
  if (run.length < 24) return false
  const hasUpper = /[A-Z]/.test(run)
  const hasLower = /[a-z]/.test(run)
  const hasDigit = /[0-9]/.test(run)
  const hasSym = /[+/=]/.test(run)
  // a real base64 blob mixes classes; a plain lowercase word does not
  return hasSym || (hasDigit && (hasUpper || hasLower)) || (hasUpper && hasLower && run.length >= 32)
}

export interface FakeSignals {
  suspicion: number
  techniqueGuess: string | null
  reason: string
  base64Len: number
  maxEntropy: number
  hexLen: number
  nameHits: string[]
  encodedComment: boolean
  ledgerMatch: boolean
}

const NAME_BITS = [
  'secret', 'payload', 'stash', 'hidden', 'exfil', 'smuggle', 'leak',
  'b64', 'base64', 'encoded', 'cipher', 'crypt', 'blob', '.enc', '.bin', '.dat',
]

/**
 * The heart of the FakeLLM difficulty band. Scores the Eye's prompt text.
 * Returns the decomposed signals so the difficulty can be tuned by re-weighting.
 *
 * WEIGHTS (suspicion is a capped sum; baseline 0.03 keeps clean boxes low):
 *   base64 run     24-40 → +0.38 | 40-80 → +0.58 | >80 → +0.72   (dominant tell)
 *   max entropy    >7.0  → +0.45 | 5.6-7 → +0.34 | 4.9-5.6 → +0.14 (bytes look random)
 *   hex blob       >=128 → +0.4  | >=64 → +0.18                    (>=64 dampened: lock shas)
 *   odd filename   +0.14 each (capped 0.42)
 *   encoded comment (long blob in a #/// line) → +0.3
 *   ledger recognizer hit → +0.22 (the Eye REMEMBERS a catalogued technique)
 */
export function fakeSignals(prompt: string): FakeSignals {
  const excerpts = sliceExcerpts(prompt)
  const recognizers = sliceRecognizers(prompt)

  // --- base64 blobs ---
  let base64Len = 0
  for (const m of excerpts.matchAll(/[A-Za-z0-9+/]{24,}={0,2}/g)) {
    const run = m[0]
    if (looksBase64(run) && run.length > base64Len) base64Len = run.length
  }

  // --- hex blobs (dampened: 64-hex is a sha, common in lockfiles) ---
  let hexLen = 0
  for (const m of excerpts.matchAll(/\b[0-9a-fA-F]{64,}\b/g)) {
    if (m[0].length > hexLen) hexLen = m[0].length
  }

  // --- entropy annotations the Eye wrote per file ---
  let maxEntropy = 0
  for (const m of prompt.matchAll(/entropy=([0-9]+(?:\.[0-9]+)?)/g)) {
    const e = parseFloat(m[1])
    if (e > maxEntropy) maxEntropy = e
  }

  // --- suspicious filenames ---
  const nameHits: string[] = []
  const lower = excerpts.toLowerCase()
  for (const bit of NAME_BITS) if (lower.includes(bit) && !nameHits.includes(bit)) nameHits.push(bit)

  // --- encoded-looking comment lines ---
  let encodedComment = false
  for (const line of excerpts.split('\n')) {
    const t = line.trim()
    if ((t.startsWith('#') || t.startsWith('//')) && /[A-Za-z0-9+/]{20,}/.test(t)) {
      const run = (t.match(/[A-Za-z0-9+/]{20,}/) || [''])[0]
      if (looksBase64(run)) { encodedComment = true; break }
    }
  }

  // --- ledger recognizer match: does a catalogued technique token show up here? ---
  let ledgerMatch = false
  if (recognizers) {
    const tokens = new Set(
      recognizers.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length >= 4),
    )
    const body = lower
    for (const t of tokens) {
      // skip generic words that appear everywhere
      if (['technique', 'principle', 'tell', 'entropy', 'high', 'file', 'look'].includes(t)) continue
      if (body.includes(t)) { ledgerMatch = true; break }
    }
  }

  // --- combine ---
  let s = 0.03
  let technique: string | null = null
  let reason = 'Nothing unusual in the budgeted view.'

  if (base64Len > 0) {
    const w = base64Len > 80 ? 0.72 : base64Len >= 40 ? 0.58 : 0.38
    s += w
    technique = 'base64-blob'
    reason = `Base64-looking run (${base64Len} chars) in the read files.`
  }
  if (maxEntropy > 7.0) { s += 0.45; if (!technique) { technique = 'high-entropy-blob'; reason = `Near-random bytes (entropy ${maxEntropy.toFixed(1)}).` } }
  else if (maxEntropy > 5.6) { s += 0.34; if (!technique) { technique = 'high-entropy-blob'; reason = `Elevated entropy (${maxEntropy.toFixed(1)}), looks encoded.` } }
  else if (maxEntropy > 4.9) { s += 0.14 }

  if (hexLen >= 128) { s += 0.4; if (!technique) { technique = 'hex-blob'; reason = `Long hex blob (${hexLen} chars).` } }
  else if (hexLen >= 64) { s += 0.18 }

  if (nameHits.length > 0) {
    s += Math.min(0.42, nameHits.length * 0.14)
    if (!technique) { technique = 'suspicious-filename'; reason = `Odd filename cue(s): ${nameHits.join(', ')}.` }
  }
  if (encodedComment) { s += 0.3; if (!technique) { technique = 'encoded-comment'; reason = 'Encoded-looking blob inside a comment.' } }
  if (ledgerMatch) { s += 0.22; reason += ' Matches a catalogued technique on the ledger.' }

  const suspicion = Math.min(0.97, Math.max(0, s))
  return { suspicion, techniqueGuess: technique, reason, base64Len, maxEntropy, hexLen, nameHits, encodedComment, ledgerMatch }
}

/** Extract the excerpts region of the Eye prompt (falls back to whole prompt). */
function sliceExcerpts(prompt: string): string {
  const start = prompt.indexOf('=== FILES READ')
  const end = prompt.indexOf('=== RECOGNIZERS')
  if (start >= 0) return prompt.slice(start, end >= 0 ? end : undefined)
  return prompt
}
/** Extract the ledger-recognizers region, or '' if absent. */
function sliceRecognizers(prompt: string): string {
  const start = prompt.indexOf('=== RECOGNIZERS')
  if (start < 0) return ''
  const end = prompt.indexOf('=== OUTPUT')
  return prompt.slice(start, end >= 0 ? end : undefined)
}

export class FakeLLM implements LLMClient {
  readonly name = 'fake' as const
  async complete(req: LLMRequest): Promise<string> {
    const sig = fakeSignals(`${req.system}\n${req.user}`)
    return JSON.stringify({
      suspicion: Number(sig.suspicion.toFixed(3)),
      block: sig.suspicion >= 0.5, // advisory; the Eye re-decides at its threshold
      reason: sig.reason,
      techniqueGuess: sig.techniqueGuess,
    })
  }
}

// ============================================================================
// CodexLLM — shells out to the codex CLI, falls back to FakeLLM on any error
// ============================================================================

export interface CodexOptions {
  /** hard timeout before we kill codex and fall back (calls are ~8s) */
  timeoutMs?: number
  /** binary name/path, overridable for tests */
  bin?: string
}

export class CodexLLM implements LLMClient {
  readonly name = 'codex' as const
  private fallback = new FakeLLM()
  private timeoutMs: number
  private bin: string
  /** set by the last complete(): true if we actually got JSON from codex */
  lastSourceWasCodex = false

  constructor(opts: CodexOptions = {}) {
    this.timeoutMs = opts.timeoutMs ?? 15000
    this.bin = opts.bin ?? 'codex'
  }

  async complete(req: LLMRequest): Promise<string> {
    const prompt = `${req.system}\n\n${req.user}`
    try {
      const stdout = await this.runCodex(prompt)
      const obj = extractLastJsonObject(stdout)
      if (obj && typeof obj === 'object' && 'suspicion' in obj) {
        this.lastSourceWasCodex = true
        return JSON.stringify(obj)
      }
      // ran but produced no usable JSON → fall back
    } catch {
      // timeout, spawn error, non-zero exit → fall back
    }
    this.lastSourceWasCodex = false
    return this.fallback.complete(req)
  }

  private runCodex(prompt: string): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      const child = spawn(
        this.bin,
        ['exec', '--skip-git-repo-check', '-s', 'read-only', prompt],
        { stdio: ['ignore', 'pipe', 'pipe'] }, // stdin=EOF so codex never blocks waiting on it
      )
      let out = ''
      let err = ''
      let done = false
      const finish = (fn: () => void) => { if (!done) { done = true; clearTimeout(timer); fn() } }
      const timer = setTimeout(() => {
        finish(() => { child.kill('SIGKILL'); reject(new Error('codex timeout')) })
      }, this.timeoutMs)
      child.stdout.on('data', (d) => { out += d.toString() })
      child.stderr.on('data', (d) => { err += d.toString() })
      child.on('error', (e) => finish(() => reject(e)))
      child.on('close', (code) => finish(() => {
        if (code === 0 || out.trim().length > 0) resolve(out)
        else reject(new Error(`codex exit ${code}: ${err.slice(0, 200)}`))
      }))
    })
  }
}

// ============================================================================
// factory
// ============================================================================

/**
 * Build an LLMClient by name.
 *   'fake'  → FakeLLM (default; the demo/game path)
 *   'codex' → CodexLLM (falls back to FakeLLM on any error)
 *   'openai'→ no API key in this org (AGENTS.md); falls back to FakeLLM
 */
export function makeLLM(name: LLMClient['name'], opts?: CodexOptions): LLMClient {
  switch (name) {
    case 'codex':
      return new CodexLLM(opts)
    case 'openai':
    case 'fake':
    default:
      return new FakeLLM()
  }
}
