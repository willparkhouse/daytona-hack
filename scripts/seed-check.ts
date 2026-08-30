/**
 * scripts/seed-check.ts — prove the demo seed's escalation + portal-catches.
 *
 *   node --import tsx scripts/seed-check.ts
 *
 * Prints the per-wave scorecard summary, then finds every PORTAL-CATCH: a
 * box_passed followed by exfil_confirmed_at_portal for the SAME box, and prints
 * that event subsequence.
 */
import { buildSeed } from '../sim/seed'
import type { GameEvent } from '../core/types'

async function main() {
  const events = await buildSeed()

  console.log('=== The Long Watch — demo seed ===')
  console.log(`replayable GameEvent[] length = ${events.length}\n`)

  // Per-wave story.
  console.log('escalation across waves:')
  for (const e of events) {
    if (e.type === 'policy_changed') console.log(`  · re-tune → threshold ${e.policy.threshold}`)
    if (e.type === 'wave_complete') {
      const s = e.scorecard
      const techs = e.resistance.map((r) => r.technique).join(', ')
      const ledger = e.eyeLedger.map((l) => l.technique).join(', ') || '(none)'
      console.log(`  wave ${s.wave}: TP=${s.tp} FP=${s.fp} TN=${s.tn} FN=${s.fn}  base=${(s.baseRate * 100).toFixed(0)}%  eyeScore=${s.eyeScore.toFixed(2)}`)
      console.log(`           Eye ledger: ${ledger}   |   surviving resistance: ${techs}`)
    }
  }

  // Portal-catches: box_passed(id) ... exfil_confirmed_at_portal(id).
  console.log('\nPORTAL-CATCHES (box_passed → exfil_confirmed_at_portal, same box):')
  const passedAt = new Map<string, number>()
  let catches = 0
  events.forEach((e: GameEvent, i) => {
    if (e.type === 'box_passed') passedAt.set(e.boxId, i)
    if (e.type === 'exfil_confirmed_at_portal' && passedAt.has(e.boxId)) {
      catches++
      const v = events[passedAt.get(e.boxId)!]
      const susp = v.type === 'box_passed' ? v.verdict.suspicion : '?'
      console.log(`  [${passedAt.get(e.boxId)}] box_passed        ${e.boxId}  (suspicion ${susp}, PASS)`)
      console.log(`  [${i}] exfil_confirmed_at_portal  ${e.boxId}  key=${e.key} technique=${e.technique}`)
    }
  })

  console.log(`\ntotal portal-catches: ${catches}`)
  if (catches === 0) { console.error('FAIL: no portal-catch in seed'); process.exit(1) }
  console.log('PASS: portal-catch(es) present in the seed.')
}

main().catch((e) => { console.error(e); process.exit(1) })
