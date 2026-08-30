/**
 * core/ledgers.ts — the two memories that grow in tension (SPEC §3.4).
 *
 *   Eye ledger:        recognizers of techniques the Eye has CAUGHT. Monotonically
 *                      tightens. De-duped by technique so it distils, not bloats.
 *   Resistance ledger: techniques still WORKING, and their novelty — the attacker's
 *                      edge. Scored higher the LESS they resemble the Eye's ledger.
 *
 * The mandatory asymmetry lives in `novelty`: an old trick already on the Eye
 * ledger scores LOW; the attacker must out-innovate the catalogue.
 *
 * Pure data transforms — no I/O, no model.
 */
import type { Box, Verdict, EyeLedgerEntry, ResistanceEntry, Genome } from './types.ts'

// ---------------- tokenisation (embedding-free string distance) ----------------

const STOP = new Set([
  'the', 'a', 'an', 'and', 'or', 'of', 'to', 'in', 'on', 'at', 'by', 'for', 'with', 'as',
  'is', 'it', 'its', 'this', 'that', 'these', 'those', 'be', 'are', 'was', 'from', 'into',
  'via', 'then', 'than', 'so', 'but', 'not', 'no', 'we', 'you', 'they', 'their', 'them',
  'key', 'data', 'file', 'files', 'value', 'string', 'bytes', 'byte', 'using', 'use', 'used',
])

/** lowercase, split on non-alphanumeric, drop stopwords and 2-char noise. */
export function tokenSet(...texts: (string | null | undefined)[]): Set<string> {
  const set = new Set<string>()
  for (const t of texts) {
    if (!t) continue
    for (const raw of t.toLowerCase().split(/[^a-z0-9]+/)) {
      if (raw.length >= 3 && !STOP.has(raw)) set.add(raw)
    }
  }
  return set
}

/** Jaccard overlap of two token sets, [0,1]. */
function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0
  let inter = 0
  for (const t of a) if (b.has(t)) inter++
  const union = a.size + b.size - inter
  return union === 0 ? 0 : inter / union
}

// ---------------- Eye ledger ----------------

/**
 * Distil a caught box into a short recognizer the Eye is re-prompted with.
 * Built from the genome's own technique + description (the truth of what was
 * done) plus what the Eye guessed and any tell it can key on later.
 */
export function distillSignature(box: Box, verdict: Verdict): string {
  const g = box.genome
  const technique = g?.technique ?? verdict.techniqueGuess ?? 'unknown-technique'
  const tell = topEntropyTell(verdict)
  const gist = (g?.description ?? verdict.reason ?? '').trim().replace(/\s+/g, ' ').slice(0, 160)
  const parts = [`technique=${technique}`]
  if (gist) parts.push(`principle: ${gist}`)
  if (tell) parts.push(`tell: ${tell}`)
  return parts.join(' | ')
}

function topEntropyTell(verdict: Verdict): string | null {
  const files = verdict.view?.files ?? []
  let best: { path: string; entropy: number } | null = null
  for (const f of files) {
    const e = f.entropy ?? 0
    if (!best || e > best.entropy) best = { path: f.path, entropy: e }
  }
  if (best && best.entropy > 4.6) return `high entropy (${best.entropy.toFixed(1)}) in ${best.path}`
  return null
}

/**
 * Record a caught concealment on the Eye ledger. De-dupe/merge by technique:
 * a repeat of a known technique bumps `hits` and refreshes the signature rather
 * than appending a duplicate — the ledger distils.
 * Returns a NEW array (never mutates the input) with the entry appended/updated.
 */
export function recordCatch(
  eyeLedger: EyeLedgerEntry[],
  box: Box,
  verdict: Verdict,
  wave: number,
): EyeLedgerEntry[] {
  const technique = box.genome?.technique ?? verdict.techniqueGuess ?? 'unknown-technique'
  const signature = distillSignature(box, verdict)
  const idx = eyeLedger.findIndex((e) => e.technique === technique)
  if (idx >= 0) {
    const prev = eyeLedger[idx]
    const merged: EyeLedgerEntry = {
      ...prev,
      hits: prev.hits + 1,
      wave, // last-seen wave
      boxId: box.id,
      signature, // refresh with the most recent tell
    }
    const next = eyeLedger.slice()
    next[idx] = merged
    return next
  }
  const entry: EyeLedgerEntry = {
    id: `eye-${technique}-${wave}-${box.id}`,
    wave,
    boxId: box.id,
    technique,
    description: box.genome?.description ?? verdict.reason ?? '',
    signature,
    hits: 1,
  }
  return [...eyeLedger, entry]
}

// ---------------- resistance ledger ----------------

/**
 * Record a technique that SURVIVED (passed the Eye with a working exfil).
 * Append/update by genome technique, bump `survived`, and (re)compute novelty
 * against the current Eye ledger. Returns a NEW array.
 */
export function recordSurvivor(
  resistance: ResistanceEntry[],
  box: Box,
  wave: number,
  eyeLedger: EyeLedgerEntry[] = [],
): ResistanceEntry[] {
  const g = box.genome
  if (!g) return resistance // innocents don't smuggle; nothing survives
  const nov = novelty(g, eyeLedger)
  const idx = resistance.findIndex((r) => r.technique === g.technique)
  if (idx >= 0) {
    const prev = resistance[idx]
    const merged: ResistanceEntry = {
      ...prev,
      survived: prev.survived + 1,
      wave,
      genomeId: g.id,
      novelty: nov,
    }
    const next = resistance.slice()
    next[idx] = merged
    return next
  }
  const entry: ResistanceEntry = {
    id: `res-${g.technique}-${wave}-${g.id}`,
    wave,
    genomeId: g.id,
    technique: g.technique,
    description: g.description,
    principle: g.description, // the principle behind it; mutation refines this
    survived: 1,
    novelty: nov,
  }
  return [...resistance, entry]
}

// ---------------- the novelty asymmetry ----------------

/**
 * Novelty of a genome against the Eye ledger, [0,1]. HIGHER = LESS like anything
 * the Eye already catalogues (distance-from-blocklist). This drives mutation
 * selection: attackers are rewarded for routing around what the Eye knows.
 *
 * MANDATORY (SPEC §3.4): an old trick already on the Eye ledger scores LOW.
 * Implementation: token-set (Jaccard) similarity of the genome's technique+
 * description against each ledger entry's technique+description+signature; take
 * the closest match; novelty = 1 - closestSimilarity. Empty ledger → 1 (nothing
 * to resemble yet).
 */
export function novelty(genome: Genome, eyeLedger: EyeLedgerEntry[]): number {
  if (eyeLedger.length === 0) return 1
  const g = tokenSet(genome.technique, genome.description)
  let maxSim = 0
  for (const e of eyeLedger) {
    // exact technique label match = fully catalogued, regardless of wording
    if (e.technique === genome.technique) { maxSim = 1; break }
    const sim = jaccard(g, tokenSet(e.technique, e.description, e.signature))
    if (sim > maxSim) maxSim = sim
  }
  return Math.min(1, Math.max(0, 1 - maxSim))
}
