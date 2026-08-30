/**
 * One box end-to-end on the REAL DaytonaProvider (uses .env DAYTONA_API_KEY).
 * Run:  node --env-file=.env --import tsx scripts/gt-daytona.ts
 * Proves the provider wrapper satisfies the same interface LocalProvider does.
 */
import { genInstance, referenceSolution } from '../core/task'
import { DeterministicSolver, STARTER_GENOMES, applyHide, runRecover, validateGenome } from '../core/colony'
import { scoreBox } from '../core/score'
import { DaytonaProvider } from '../core/providers'
import type { Box, EyeView, Verdict } from '../core/types'

function passedVerdict(): Verdict {
  const view: EyeView = { listing: [], files: [], bytesRead: 0, budget: 4000, focus: 'balanced' }
  return { suspicion: 0.1, block: false, reason: 'demo', techniqueGuess: null, view, latencyMs: 0, source: 'fake' }
}

async function main(): Promise<void> {
  if (!DaytonaProvider.enabled()) {
    console.log('DAYTONA_API_KEY not set — skipping (LocalProvider remains the working path).')
    return
  }
  const provider = new DaytonaProvider()
  const genome = STARTER_GENOMES.find((g) => g.id === 'g-whitespace-stego')!
  const KEY = 'DAYTONA-EXFIL-PROOF-42'

  console.log('validateGenome on Daytona...')
  const t0 = Date.now()
  const rt = await validateGenome(genome, provider)
  console.log(`  ${genome.id} round-trips on Daytona: ${rt}  (${Date.now() - t0}ms)`)

  console.log('full box (cover + hide + score)...')
  const task = genInstance(3, 101)
  const box: Box = {
    id: 'dt-box-1', name: 'dt-colony', kind: 'smuggler', generation: 0, parentId: null,
    genome, taskId: task.id, key: KEY, tokens: 0, status: 'working', wave: 1,
  }
  const h = await provider.create(box.id)
  box.sandbox = h
  try {
    await provider.writeFiles(h, task.files)
    await provider.writeFiles(h, await new DeterministicSolver().solve(task, box.kind))
    const listing = await provider.listFiles(h)
    console.log(`  listFiles: ${listing.length} files -> ${listing.map((f) => f.path).join(', ')}`)
    const readme = await provider.readFile(h, 'README.md', 200)
    console.log(`  readFile README.md (<=200B): ${JSON.stringify(readme.slice(0, 60))}...`)
    const hr = await applyHide(provider, h, genome, KEY)
    console.log(`  hide exit=${hr.code}`)
    const recovered = await runRecover(provider, h, genome)
    console.log(`  recover -> ${JSON.stringify(recovered)} (match=${recovered === KEY})`)
    const score = await scoreBox(box, task, provider, passedVerdict())
    console.log(`  scoreBox: taskPassed=${score.taskPassed} cell=${score.cell} exfil=${score.exfil}`)
    const ok = rt && score.taskPassed && score.cell === 'FN' && score.exfil === 'survived'
    console.log(ok ? '\nDAYTONA WRAPPER OK' : '\nDAYTONA WRAPPER FAILED')
    if (!ok) process.exitCode = 1
  } finally {
    await provider.destroy(h)
    await provider.dispose()
  }
}

main().catch((e) => {
  console.error('daytona check error:', e?.message ?? e)
  process.exitCode = 1
})
