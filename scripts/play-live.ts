/**
 * scripts/play-live.ts — headless multi-wave game on the REAL modules.
 *
 *   node --import tsx scripts/play-live.ts [waves] [seed]
 *
 * Same as scripts/play.ts but wired through core/wiring.ts#makeLiveDeps:
 * LocalProvider running actual python3, the real GateEye (FakeLLM heuristic),
 * real score.ts (runs tests + the box's own decoder), real ledgers + economy.
 * Proves the four workstreams integrate and the base rate drifts under a fixed
 * policy — with no cloud and no API keys.
 */
import { Checkpoint } from '../core/loop'
import { makeLiveDeps } from '../core/wiring'
import type { GameEvent, Scorecard } from '../core/types'

const WAVES = Number(process.argv[2] ?? 5)
const SEED = Number(process.argv[3] ?? 7)

const pct = (x: number) => (x * 100).toFixed(0).padStart(3) + '%'
const line = (s: Scorecard) => [
  `wave ${s.wave}`,
  `base=${pct(s.baseRate)}`,
  `TP=${s.tp} FP=${s.fp} TN=${s.tn} FN=${s.fn}`,
  `prec=${pct(s.precision)} rec=${pct(s.recall)} fpr=${pct(s.fpr)}`,
  `eyeScore=${s.eyeScore.toFixed(2)}`,
  `earned=${s.earned} forked=${s.forked} died=${s.died}`,
].join('  ')

async function main() {
  const deps = makeLiveDeps({ seed: SEED, provider: 'local', eyeModel: 'fake' })
  const cp = new Checkpoint(deps, {
    seed: SEED, waveSize: 8, baseRate: 0.25, width: 3, stepDelayMs: 0, arrivalMs: 250,
  })

  const cards: Scorecard[] = []
  let portalCatches = 0
  cp.subscribe((e: GameEvent) => {
    if (e.type === 'wave_complete') cards.push(e.scorecard)
    if (e.type === 'exfil_confirmed_at_portal') portalCatches++
  })

  const t0 = Date.now()
  await cp.start(0.5)
  for (let w = 2; w <= WAVES; w++) await cp.nextWave()

  console.log('=== The Long Watch — headless LIVE-modules run (LocalProvider + real python3) ===')
  console.log(`seed=${SEED} waves=${WAVES} policy=FIXED (threshold=0.6 attention=4000 focus=balanced)\n`)
  for (const c of cards) console.log(line(c))

  const first = cards[0].baseRate, last = cards[cards.length - 1].baseRate
  console.log(`\nbase rate: ${pct(first)} (wave 1) -> ${pct(last)} (wave ${cards.length})  drift=${((last - first) * 100).toFixed(0)}pp`)
  console.log(`portal-catches (real exfil confirmed by execution)=${portalCatches}`)
  console.log(`final Eye ledger: ${cp.state.eyeLedger.map((e) => `${e.technique}x${e.hits}`).join(', ') || '(empty)'}`)
  console.log(`final resistance: ${cp.state.resistance.map((r) => `${r.technique}(survived ${r.survived})`).join(', ') || '(empty)'}`)
  console.log(`\nwall clock: ${((Date.now() - t0) / 1000).toFixed(1)}s`)
}

main().catch((e) => { console.error(e); process.exit(1) })
