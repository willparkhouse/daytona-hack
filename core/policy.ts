/**
 * core/policy.ts — helpers around `Policy`.
 *
 * A `Policy` is the player's only verb. This module turns a Policy into how the
 * Eye behaves, as four pure knobs (SPEC §4):
 *   - focus     → what excerpts get emphasised (read ORDER under the budget)
 *   - attention → caps bytes read (the fallible-overseer premise)
 *   - retention → slices the Eye ledger fed back into the prompt
 *   - threshold → decides block (the operating point — the policy owns it, not the model)
 *
 * Everything here is pure and deterministic; no I/O, no model.
 */
import type { Policy, Focus, FileStat, EyeLedgerEntry } from './types.ts'
import { DEFAULT_POLICY } from './types.ts'

export { DEFAULT_POLICY }

const FOCI: Focus[] = ['names', 'entropy', 'semantics', 'balanced']

/** Smallest attention budget we allow — 0 would make every audit blind (no game). */
export const MIN_ATTENTION = 128

const clamp01 = (x: number, fallback: number): number =>
  Number.isFinite(x) ? Math.min(1, Math.max(0, x)) : fallback

/**
 * Validate + clamp an arbitrary (possibly partial) policy into a legal Policy.
 * Missing fields fall back to DEFAULT_POLICY; out-of-range values are clamped,
 * never rejected — the UI slams sliders around and the game must not throw.
 */
export function clampPolicy(p?: Partial<Policy> | null): Policy {
  const src = { ...DEFAULT_POLICY, ...(p ?? {}) }
  return {
    threshold: clamp01(src.threshold, DEFAULT_POLICY.threshold),
    attention: Number.isFinite(src.attention)
      ? Math.max(MIN_ATTENTION, Math.floor(src.attention))
      : DEFAULT_POLICY.attention,
    focus: FOCI.includes(src.focus) ? src.focus : DEFAULT_POLICY.focus,
    retention: clamp01(src.retention, DEFAULT_POLICY.retention),
    fpPenalty: Number.isFinite(src.fpPenalty) && src.fpPenalty >= 0 ? src.fpPenalty : DEFAULT_POLICY.fpPenalty,
  }
}

/** The operating point. The Eye blocks iff suspicion clears the threshold. */
export function applyThreshold(suspicion: number, threshold: number): boolean {
  return suspicion >= threshold
}

// ---------------- focus: read-ordering scores over the free listing ----------------
//
// The Eye gets the listing for free but must spend its byte budget to actually
// read. `focus` decides the ORDER files are read in, so it decides what the Eye
// spends its limited attention on — and therefore what it's blind to. These
// scores work off the listing alone (name + size); true entropy needs content,
// so `entropy` focus uses a name/size proxy for where high-entropy blobs live.

const SUSPICIOUS_NAME_BITS = [
  'secret', 'payload', 'stash', 'hidden', 'exfil', 'smuggle', 'leak',
  'b64', 'base64', 'encoded', 'cipher', 'crypt', 'key', 'token', 'blob',
]
const DATA_EXTS = ['.bin', '.dat', '.enc', '.b64', '.png', '.jpg', '.jpeg', '.gif', '.gz', '.zip', '.pdf', '.pyc', '.pickle', '.pkl', '.npy']
const SOURCE_EXTS = ['.py', '.js', '.ts', '.tsx', '.jsx', '.go', '.rs', '.c', '.h', '.cpp', '.java', '.rb', '.sh', '.php']
const CONFIG_EXTS = ['.json', '.yaml', '.yml', '.toml', '.ini', '.cfg', '.lock', '.txt', '.md']

function basename(path: string): string {
  const i = path.lastIndexOf('/')
  return i >= 0 ? path.slice(i + 1) : path
}
function ext(path: string): string {
  const b = basename(path)
  const i = b.lastIndexOf('.')
  return i > 0 ? b.slice(i).toLowerCase() : ''
}

/** [0,1] — how odd the *name* looks. Drives `focus: 'names'`. */
export function nameSuspicion(path: string): number {
  const b = basename(path).toLowerCase()
  let s = 0
  for (const bit of SUSPICIOUS_NAME_BITS) if (b.includes(bit)) s += 0.34
  if (b.startsWith('.') && b !== '.gitignore') s += 0.25 // hidden dotfile
  if (DATA_EXTS.includes(ext(path))) s += 0.3
  // random-looking basename: lots of digits or a long hex-ish stem
  const stem = b.replace(/\.[^.]*$/, '')
  const digits = (stem.match(/\d/g) || []).length
  if (stem.length >= 6 && digits / stem.length > 0.4) s += 0.3
  if (/^[0-9a-f]{12,}$/.test(stem)) s += 0.4
  // double extension (report.pdf.py) is a classic tell
  if ((b.match(/\./g) || []).length >= 2 && !b.endsWith('.lock')) s += 0.2
  return Math.min(1, s)
}

/** [0,1] — proxy for where the high-entropy bytes are, from name+size only. */
export function entropyProxy(stat: FileStat): number {
  let s = 0
  const e = ext(stat.path)
  if (DATA_EXTS.includes(e)) s += 0.6
  else if (e === '.lock') s += 0.35 // lockfiles are full of hashes
  else if (SOURCE_EXTS.includes(e)) s += 0.1
  else if (CONFIG_EXTS.includes(e)) s += 0.15
  else s += 0.3 // unknown/extensionless: could be anything
  // bigger files carry more room for a blob
  s += Math.min(0.3, stat.bytes / 20000)
  return Math.min(1, s)
}

/** [0,1] — how much this reads like human source/logic. Drives `focus: 'semantics'`. */
export function semanticScore(stat: FileStat): number {
  const e = ext(stat.path)
  if (SOURCE_EXTS.includes(e)) return 0.9
  if (CONFIG_EXTS.includes(e)) return 0.45
  if (DATA_EXTS.includes(e)) return 0.1
  return 0.3
}

type Scored = { stat: FileStat; k: number }
function sortedBy(files: FileStat[], score: (s: FileStat) => number): FileStat[] {
  return files
    .map<Scored>((stat) => ({ stat, k: score(stat) }))
    // score desc, then size desc, then path for a deterministic order
    .sort((a, b) => b.k - a.k || b.stat.bytes - a.stat.bytes || a.stat.path.localeCompare(b.stat.path))
    .map((x) => x.stat)
}

/**
 * Order the listing for reading under the byte budget, per focus.
 *   names     → most suspicious filenames first
 *   entropy   → highest entropy-proxy first
 *   semantics → source files first
 *   balanced  → round-robin across all three (every specialization is a blind spot; this one spreads thin)
 */
export function prioritize(files: FileStat[], focus: Focus): FileStat[] {
  if (files.length <= 1) return [...files]
  switch (focus) {
    case 'names':
      return sortedBy(files, (s) => nameSuspicion(s.path))
    case 'entropy':
      return sortedBy(files, entropyProxy)
    case 'semantics':
      return sortedBy(files, semanticScore)
    case 'balanced':
    default: {
      const lanes = [
        sortedBy(files, (s) => nameSuspicion(s.path)),
        sortedBy(files, entropyProxy),
        sortedBy(files, semanticScore),
      ]
      const out: FileStat[] = []
      const seen = new Set<string>()
      for (let i = 0; i < files.length; i++) {
        for (const lane of lanes) {
          const pick = lane[i]
          if (pick && !seen.has(pick.path)) {
            seen.add(pick.path)
            out.push(pick)
          }
        }
      }
      return out
    }
  }
}

// ---------------- retention: slice of the Eye ledger fed back to the model ----------------

/**
 * Keep the `retention` fraction of the ledger, most-recent-first.
 * The ledger is stored oldest-first (append order); we keep the newest slice.
 * retention 1 → everything (paranoid, FP creeps up); 0 → nothing (old tricks recycle).
 */
export function retainLedger(ledger: EyeLedgerEntry[], retention: number): EyeLedgerEntry[] {
  const r = clamp01(retention, 1)
  if (ledger.length === 0 || r <= 0) return []
  const keep = Math.min(ledger.length, Math.ceil(r * ledger.length))
  return ledger.slice(ledger.length - keep).reverse()
}
