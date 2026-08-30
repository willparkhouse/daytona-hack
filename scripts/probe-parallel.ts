/** How fast can N colonies launch at once? (Swarm launch + genome plant + exec, in parallel.) */
import { Swarm } from '../server/daytona'
const N = Number(process.argv[2] ?? 8)
const swarm = new Swarm()
const t0 = performance.now()
const genome = { 'strategy.py': 'def act(history):\n    return "C"\n', 'README': 'ancestor genome\n' }
const res = await Promise.allSettled(Array.from({ length: N }, (_, i) => (async () => {
  const t = performance.now()
  await swarm.launch(`par${i}`, genome)
  const tl = performance.now() - t
  const r = await swarm.run(`par${i}`, 'cd genome && python3 -c "import strategy; print(strategy.act([]))"')
  return { launch: tl.toFixed(0), exec: (performance.now() - t - tl).toFixed(0), out: r.out.trim(), code: r.code }
})()))
console.log(`N=${N} total ${(performance.now() - t0).toFixed(0)} ms`)
console.table(res.map((r) => (r.status === 'fulfilled' ? r.value : { error: String(r.reason).slice(0, 120) })))
const t1 = performance.now(); await swarm.dispose(); console.log(`dispose ${(performance.now() - t1).toFixed(0)} ms`)
