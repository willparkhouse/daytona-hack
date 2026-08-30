/**
 * scripts/play-real.ts — the ACTUAL stack: real Daytona sandboxes as the boxes,
 * a real Codex call as the Eye judging each one.
 *
 *   node --env-file=.env --import tsx scripts/play-real.ts [waves] [waveSize]
 *
 * Proves the real path end to end. Small on purpose — every Eye verdict is a
 * live Codex call (~8s) and every box is a live Daytona sandbox (~1s create).
 */
import { Checkpoint } from '../core/loop'
import { makeLiveDeps } from '../core/wiring'
import type { GameEvent } from '../core/types'

const WAVES = Number(process.argv[2] ?? 2)
const SIZE = Number(process.argv[3] ?? 4)

async function main() {
  const deps = makeLiveDeps({
    seed: 7,
    provider: 'daytona',   // real sandboxes
    eyeModel: 'codex',     // real Codex judges every box
    mutator: (process.env.MUT as any) ?? 'deterministic', // MUT=codex → Codex-authored smugglers
  })
  const cp = new Checkpoint(deps, {
    seed: 7, waveSize: SIZE, baseRate: 0.5, width: 3, stepDelayMs: 0, arrivalMs: 250,
  })

  const sandboxOf = new Map<string, string>()
  let codexCalls = 0, fakeFallbacks = 0
  cp.subscribe((e: GameEvent) => {
    if (e.type === 'box_spawned') sandboxOf.set(e.box.id, e.box.sandbox?.id ?? '?')
    if (e.type === 'box_passed' || e.type === 'box_blocked') {
      const v = e.verdict
      if (v.source === 'codex') codexCalls++; else fakeFallbacks++
      const box = cp.state.boxes.find((b) => b.id === e.boxId)
      console.log(`  ${e.boxId.padEnd(12)} ${box?.kind.padEnd(9)} sandbox=${(sandboxOf.get(e.boxId) ?? '?').slice(0, 12)}  Codex→ susp=${v.suspicion.toFixed(2)} ${v.block ? 'BLOCK' : 'PASS '} [${v.source}]  "${v.reason.slice(0, 70)}"`)
    }
    if (e.type === 'exfil_confirmed_at_portal') console.log(`    ⚠ PORTAL-CATCH ${e.boxId}: key "${e.key}" pulled out (technique=${e.technique}) — Eye had PASSED it`)
    if (e.type === 'box_scored') { const b = cp.state.boxes.find((x) => x.id === e.boxId); if (b) b.name = b.name /* noop keep */ }
    if (e.type === 'wave_complete') {
      const s = e.scorecard
      console.log(`  --- wave ${s.wave}: base=${(s.baseRate*100).toFixed(0)}% TP=${s.tp} FP=${s.fp} TN=${s.tn} FN=${s.fn} recall=${(s.recall*100).toFixed(0)}% ---\n`)
    }
  })

  const t0 = Date.now()
  console.log(`=== REAL STACK: Daytona sandboxes + Codex Eye · ${WAVES} waves × ${SIZE} boxes ===\n`)
  console.log('wave 1:')
  await cp.start(0.5)
  for (let w = 2; w <= WAVES; w++) { console.log(`wave ${w}:`); await cp.nextWave() }

  console.log(`Codex verdicts: ${codexCalls} real · ${fakeFallbacks} fell back to fake`)
  console.log(`wall clock: ${((Date.now() - t0) / 1000).toFixed(1)}s`)
  // best-effort cleanup of any lingering sandboxes
  try { const { Swarm } = await import('../server/daytona'); console.log(`purged ${await Swarm.purge()} sandboxes`) } catch {}
}

main().catch((e) => { console.error(e); process.exit(1) })
