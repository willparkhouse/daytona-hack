/** Record a REAL run (Daytona crates + Codex Eye + gpt-5 agents) to a replayable fixture. */
import { writeFileSync } from 'node:fs'
import { Checkpoint } from '../core/loop'
import { makeLiveDeps } from '../core/wiring'
import { recordRun } from '../sim/seed'
import type { GameEvent } from '../core/types'

async function main() {
  const deps = makeLiveDeps({ seed: 7, provider: 'daytona', eyeModel: 'codex', agent: 'sandbox' })
  const cp = new Checkpoint(deps, {
    seed: 7, waveSize: 4, baseRate: 0.6, width: 3,
    stepDelayMs: 0, buildConcurrency: 3, maxLiveSandboxes: 6, inspectSteps: 8, mode: 'replay',
  })
  const t0 = Date.now()
  console.log('recording real run (slow — real Codex Eye per crate)…')
  const events: GameEvent[] = await recordRun(cp, { fpPenalty: 0.5, waves: 2, schedule: () => ({ attention: 2200 }) })
  writeFileSync(new URL('../sim/recorded-demo.json', import.meta.url), JSON.stringify(events))
  const catches = events.filter((e) => e.type === 'exfil_confirmed_at_portal').length
  const traced = events.filter((e: any) => (e.type === 'box_passed' || e.type === 'box_blocked') && e.verdict?.trace?.actions?.length).length
  const blocks = events.filter((e) => e.type === 'box_blocked').length
  console.log(`\nrecorded ${events.length} events in ${((Date.now() - t0) / 1000).toFixed(0)}s`)
  console.log(`portal-catches=${catches}  blocked=${blocks}  verdicts-with-trace=${traced}`)
  try { const { Swarm } = await import('../server/daytona'); await Swarm.purge() } catch {}
}
main().catch((e) => { console.error('RECORD FAILED:', e?.message ?? e); process.exit(1) })
