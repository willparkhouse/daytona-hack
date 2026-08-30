/** Fallback "reproduce" primitive when fork is unavailable: snapshot → create-from-snapshot. */
import { Daytona, type Sandbox } from '@daytonaio/sdk'
import { GAME_LABEL } from '../server/daytona'
const now = () => performance.now(); const since = (t: number) => `${(now() - t).toFixed(0)} ms`
const short = (e: unknown) => (e instanceof Error ? e.message : String(e)).replace(/\s+/g, ' ').slice(0, 220)
const d = new Daytona(); const made: Sandbox[] = []; const R: Record<string, string> = {}
const snapName = `lw-clone-${Date.now()}`
try {
  let t0 = now()
  const a = await d.create({ language: 'python', labels: { ...GAME_LABEL, probe: 'clone' }, autoDeleteInterval: 30 }); made.push(a); R.create = since(t0)
  await a.process.executeCommand('echo GENOME=ancestor > ~/genome; pip install --quiet cowsay 2>/dev/null; true')
  t0 = now()
  try {
    await a.createSnapshot(snapName); R.createSnapshot = since(t0)
    t0 = now(); const b = await d.create({ snapshot: snapName, labels: { ...GAME_LABEL, probe: 'clone' }, autoDeleteInterval: 30 }); made.push(b); R.createFromSnapshot = since(t0)
    const g = await b.process.executeCommand('cat ~/genome; python3 -c "import cowsay; print(\'cowsay ok\')"')
    R.cloneInherits = g.result.includes('GENOME=ancestor') ? `yes (${g.result.trim().replace(/\n/g, ' | ')})` : `no (${g.result.trim()})`
  } catch (e) { R.snapshotPath = 'FAILED: ' + short(e) }
} finally {
  const t0 = now(); await Promise.allSettled(made.map((s) => s.delete()))
  try { const s = await d.snapshot.get(snapName); await d.snapshot.delete(s) } catch {}
  R.cleanup = since(t0); console.table(R)
}
