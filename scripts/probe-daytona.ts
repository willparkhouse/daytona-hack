/**
 * Daytona feasibility probe. Answers the questions that decide the architecture:
 *   1. how fast is create?            2. how fast is exec?
 *   3. does fork work on the default class, and is filesystem state inherited?
 *   4. can a LINKED child reach its parent over the network (raid layer)?
 *   5. can the outside world hit a preview URL?
 *
 *   pnpm probe            # run the probe, cleans up after itself
 *   pnpm probe --purge    # delete every sandbox labelled game=long-watch
 */
import { Daytona, type Sandbox } from '@daytonaio/sdk'
import { Swarm, GAME_LABEL } from '../server/daytona'

const now = () => performance.now()
const since = (t0: number) => `${(now() - t0).toFixed(0)} ms`
const LABELS = { ...GAME_LABEL, probe: '1' }
const short = (e: unknown) => (e instanceof Error ? e.message : String(e)).replace(/\s+/g, ' ').slice(0, 220)

async function main() {
  if (process.argv.includes('--purge')) { console.log(`purged ${await Swarm.purge()} sandboxes`); return }
  const d = new Daytona()
  const made: Sandbox[] = []
  const R: Record<string, string> = {}
  try {
    // 1. create
    let t0 = now()
    const a = await d.create({ language: 'python', labels: LABELS, autoDeleteInterval: 30 })
    made.push(a); R.create = since(t0)
    console.log(`[1] sandbox ${a.id} name=${a.name} class=${a.sandboxClass ?? '?'} state=${a.state} target=${a.target}`)

    // 2. exec
    t0 = now()
    const r = await a.process.executeCommand('echo ok; uname -sr; nproc; free -m | sed -n 2p')
    R.exec = since(t0); console.log(`[2] exec (${r.exitCode}):\n${r.result.trim().split('\n').map((l) => '    ' + l).join('\n')}`)

    // 3. fork (filesystem inheritance check)
    await a.process.executeCommand('echo GENOME=ancestor > /tmp/genome')
    t0 = now()
    try {
      const f = await a.fork({ name: `lw-fork-${Date.now()}` })
      made.push(f); R.fork = since(t0)
      const g = await f.process.executeCommand('cat /tmp/genome')
      R.forkInherits = g.result.trim() === 'GENOME=ancestor' ? 'yes' : `no (${g.result.trim()})`
      console.log(`[3] fork ${f.id} class=${f.sandboxClass ?? '?'} inherits=${R.forkInherits}`)
    } catch (e) { R.fork = 'FAILED: ' + short(e); console.log('[3] fork failed:', short(e)) }

    // 4. linked child → parent reachability
    t0 = now()
    let child: Sandbox | null = null
    try {
      try { child = await d.create({ language: 'python', labels: LABELS, linkedSandbox: a.id, ephemeral: true }) }
      catch (e) { console.log('[4] linked create (ephemeral) failed, retrying autoDeleteInterval=0:', short(e)); child = await d.create({ language: 'python', labels: LABELS, linkedSandbox: a.id, autoDeleteInterval: 0 }) }
      made.push(child); R.linkedCreate = since(t0)
      await a.process.createSession('srv')
      await a.process.executeSessionCommand('srv', { command: 'python3 -m http.server 8000 --bind 0.0.0.0', runAsync: true })
      await new Promise((res) => setTimeout(res, 1500))
      const host = await a.process.executeCommand('hostname; hostname -I 2>/dev/null || ip -4 -o addr | awk \'{print $4}\'')
      const lines = host.result.trim().split('\n').map((s) => s.trim()).filter(Boolean)
      console.log(`[4] parent hostname/ip: ${lines.join(' | ')}`)
      const candidates = Array.from(new Set([a.id, a.name, lines[0], ...(lines[1] ?? '').split(/[\s/]+/).filter((s) => /^\d+\.\d+/.test(s))]))
      const reach: string[] = []
      for (const h of candidates) {
        if (!h) continue
        const c = await child.process.executeCommand(`curl -s -m 3 -o /dev/null -w '%{http_code}' http://${h}:8000/ || echo fail`, undefined, undefined, 10)
        const code = c.result.trim(); console.log(`    child → http://${h}:8000 → ${code}`)
        if (code === '200') reach.push(h)
      }
      R.linkedReach = reach.length ? `yes via ${reach.join(', ')}` : 'NO'
    } catch (e) { R.linked = 'FAILED: ' + short(e); console.log('[4] linked failed:', short(e)) }

    // 5. preview URL from outside
    try {
      const p = await a.getPreviewLink(8000)
      const res = await fetch(p.url, { headers: { 'x-daytona-preview-token': p.token } })
      R.preview = `${res.status} ${p.url}`; console.log(`[5] preview ${res.status} ${p.url}`)
    } catch (e) { R.preview = 'FAILED: ' + short(e); console.log('[5] preview failed:', short(e)) }
  } finally {
    const t0 = now()
    await Promise.allSettled(made.map((s) => s.delete()))
    R.deleteAll = since(t0)
    console.log('\n=== RESULTS ==='); console.table(R)
  }
}
main().catch((e) => { console.error(e); process.exit(1) })
