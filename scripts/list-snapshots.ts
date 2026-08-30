import { Daytona } from '@daytonaio/sdk'
const d = new Daytona()
const page = await d.snapshot.list()
console.log(`snapshots (${page.items?.length ?? 0}):`)
for (const s of page.items ?? []) console.log(` - ${s.name}  class=${(s as any).sandboxClass ?? '?'} state=${s.state} region=${(s as any).regionId ?? '?'} cpu=${s.cpu} mem=${s.mem}`)
for (const name of ['daytona-vm-small', 'daytona-vm-medium', 'daytona-small', 'daytona-medium', 'daytona-large']) {
  try { const s = await d.snapshot.get(name); console.log(`get ${name}: state=${s.state} class=${(s as any).sandboxClass ?? '?'} region=${(s as any).regionId ?? '?'}`) }
  catch (e) { console.log(`get ${name}: ${(e as Error).message.slice(0, 100)}`) }
}
