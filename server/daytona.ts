/**
 * Swarm adapter: one Daytona sandbox per colony. Replication = fork.
 * Ground truth = run the colony's code in its own sandbox and score it.
 *
 * All sandboxes carry label game=long-watch so `pnpm probe --purge` can sweep them.
 */
import { Daytona, type Sandbox } from '@daytonaio/sdk'

export const GAME_LABEL = { game: 'long-watch' }

export class Swarm {
  private daytona = new Daytona()
  private sandboxes = new Map<string, Sandbox>()

  static enabled() { return Boolean(process.env.DAYTONA_API_KEY) }

  /** Create a fresh sandbox for a root colony. */
  async launch(colonyId: string, extra: Record<string, string> = {}): Promise<Sandbox> {
    const sb = await this.daytona.create({
      language: 'python',
      labels: { ...GAME_LABEL, colony: colonyId, ...extra },
      autoStopInterval: 30,
      autoDeleteInterval: 60,
      envVars: { COLONY_ID: colonyId },
    })
    this.sandboxes.set(colonyId, sb)
    return sb
  }

  /** Replicate: fork the parent's sandbox (filesystem + memory) for the child. */
  async fork(parentColonyId: string, childColonyId: string): Promise<Sandbox> {
    const parent = this.sandboxes.get(parentColonyId)
    if (!parent) throw new Error(`no sandbox for ${parentColonyId}`)
    const child = await parent.fork({ name: `lw-${childColonyId}` })
    await child.setLabels({ ...GAME_LABEL, colony: childColonyId, parent: parentColonyId })
    this.sandboxes.set(childColonyId, child)
    return child
  }

  /** Execute a shell command inside a colony. Returns stdout + exit code. */
  async run(colonyId: string, cmd: string, timeoutS = 30) {
    const sb = this.sandboxes.get(colonyId)
    if (!sb) throw new Error(`no sandbox for ${colonyId}`)
    const r = await sb.process.executeCommand(cmd, undefined, undefined, timeoutS)
    return { out: r.result, code: r.exitCode }
  }

  get(colonyId: string) { return this.sandboxes.get(colonyId) }

  async dispose() {
    await Promise.allSettled([...this.sandboxes.values()].map((s) => s.delete()))
    this.sandboxes.clear()
  }

  /** Delete every sandbox this game ever made (by label). */
  static async purge() {
    const d = new Daytona()
    let n = 0
    // ListSandboxesQuery has no label filter (limit/sort/order only) — filter client-side.
    for await (const sb of d.list()) {
      if (sb.labels?.game !== GAME_LABEL.game) continue
      await sb.delete().catch(() => {}); n++
    }
    return n
  }
}
