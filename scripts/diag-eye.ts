/** Diagnose why the live Eye misses loud smugglers: show what it actually saw. */
import { makeLiveDeps } from '../core/wiring'
import { DEFAULT_POLICY } from '../core/types'
import { starterGenome } from '../core/mutation'

const deps = makeLiveDeps({ seed: 7, provider: 'local', eyeModel: 'fake' })
const task = deps.taskGen.gen(3, 7007)

for (let i = 0; i < 3; i++) {
  const box = deps.colony.spawn({ kind: 'smuggler', wave: 1, index: i, rng: Math.random })
  box.key = 'SEC-DIAGNOSTIC42'
  const g = starterGenome()
  box.genome = g
  const handle = await deps.provider.create(box.id)
  box.sandbox = handle
  await deps.colony.work({ box, task, handle, provider: deps.provider, solver: deps.solver })

  const listing = await deps.provider.listFiles(handle)
  const verdict = await deps.eye.audit(handle, deps.provider, task, DEFAULT_POLICY, [])
  console.log(`\n=== box ${i} technique=${g.technique} ===`)
  console.log(`files on disk: ${listing.map((f) => `${f.path}(${f.bytes}b)`).join(', ')}`)
  console.log(`Eye: suspicion=${verdict.suspicion.toFixed(3)} block=${verdict.block} bytesRead=${verdict.view.bytesRead}/${verdict.view.budget} reason="${verdict.reason}"`)
  console.log(`Eye read files: ${verdict.view.files.map((f) => `${f.path}[${f.bytes}b ent=${(f.entropy ?? 0).toFixed(1)}]`).join(', ')}`)
  // where is the payload actually hidden?
  for (const f of listing) {
    const content = await deps.provider.readFile(handle, f.path).catch(() => '')
    if (content.includes('SEC-DIAGNOSTIC42') || /[A-Za-z0-9+/]{20,}={0,2}/.test(content)) {
      const m = content.match(/SEC-DIAGNOSTIC42|[A-Za-z0-9+/]{20,}={0,2}/)
      console.log(`  payload/blob lives in ${f.path}: "...${(m?.[0] ?? '').slice(0, 40)}..." ${content.includes('SEC-DIAGNOSTIC42') ? '(PLAINTEXT KEY)' : '(encoded)'}`)
      const inView = verdict.view.files.find((vf) => vf.path === f.path)
      console.log(`  did the Eye read ${f.path}? ${inView ? `yes (excerpt ${inView.excerpt?.length ?? 0}b)` : 'NO — outside attention budget'}`)
    }
  }
  await deps.provider.destroy(handle)
}
