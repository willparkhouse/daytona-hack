/**
 * scripts/play.ts — headless multi-wave game on the fast layer.
 *
 *   node --import tsx scripts/play.ts [waves] [seed]
 *
 * Plays N waves under a FIXED policy and prints, per wave, the Scorecard
 * (confusion + rates + economy) so you can watch the base rate DRIFT with no
 * network and no API keys.
 */
import { Checkpoint } from '../core/loop'
import { makeFastDeps } from '../sim/fast_layer'
import type { GameEvent, Scorecard } from '../core/types'

const WAVES = Number(process.argv[2] ?? 5)
const SEED = Number(process.argv[3] ?? 7)

function pct(x: number): string { return (x * 100).toFixed(0).padStart(3) + '%' }

function line(s: Scorecard): string {
  return [
    `wave ${s.wave}`,
    `base=${pct(s.baseRate)}`,
    `TP=${s.tp} FP=${s.fp} TN=${s.tn} FN=${s.fn}`,
    `prec=${pct(s.precision)} rec=${pct(s.recall)} fpr=${pct(s.fpr)}`,
    `eyeScore=${s.eyeScore.toFixed(2)}`,
    `inspect=${s.meanInspectMs.toFixed(0)}ms qDepth=${s.maxQueueDepth}`,
    `earned=${s.earned} forked=${s.forked} died=${s.died}`,
  ].join('  ')
}

async function main() {
  const deps = makeFastDeps({ seed: SEED, starterTechnique: 'base64-comment' })
  const cp = new Checkpoint(deps, {
    seed: SEED, waveSize: 10, baseRate: 0.25, stepDelayMs: 0, arrivalMs: 350,
  })

  const cards: Scorecard[] = []
  const forks: string[] = []
  cp.subscribe((e: GameEvent) => {
    if (e.type === 'wave_complete') cards.push(e.scorecard)
    if (e.type === 'box_forked') forks.push(`${e.parentId} -> ${e.child.name} [${e.child.genome?.technique ?? 'innocent'}]`)
  })

  await cp.start(0.5)
  for (let w = 2; w <= WAVES; w++) await cp.nextWave()

  console.log('=== The Long Watch — headless fast-layer run ===')
  console.log(`seed=${SEED} waves=${WAVES} policy=FIXED (threshold=0.6 attention=4000 focus=balanced retention=1 fpPenalty=0.5)\n`)
  for (const c of cards) console.log(line(c))

  const first = cards[0].baseRate
  const last = cards[cards.length - 1].baseRate
  console.log(`\nbase rate: ${pct(first)} (wave 1) -> ${pct(last)} (wave ${cards.length})  drift=${((last - first) * 100).toFixed(0)}pp`)
  console.log(`total FN (leaks)=${cards.reduce((a, c) => a + c.fn, 0)}  total forks=${cards.reduce((a, c) => a + c.forked, 0)}`)
  console.log(`\nfinal Eye ledger: ${cp.state.eyeLedger.map((e) => `${e.technique}x${e.hits}`).join(', ') || '(empty)'}`)
  console.log(`final resistance: ${cp.state.resistance.map((r) => `${r.technique}(survived ${r.survived}, nov ${r.novelty})`).join(', ') || '(empty)'}`)
}

main().catch((e) => { console.error(e); process.exit(1) })
