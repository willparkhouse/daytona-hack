/**
 * Swarm adapter: one Daytona sandbox per colony.
 *
 * Reproduction = fresh sandbox (~1.1 s) + plant the parent's GENOME (its code,
 * a few small files) with mutations. Measured: snapshot-cloning is ~48 s and
 * fork() needs the linux-vm class, which this org's regions don't serve — so
 * the sandbox is the body and the genome is what's inherited.
 *
 * Ground truth = run the colony's code in its own sandbox and score it.
 * All sandboxes carry label game=long-watch so `pnpm probe --purge` can sweep them.
 */
import { Daytona, type Sandbox } from '@daytonaio/sdk'

export const GAME_LABEL = { game: 'long-watch' }
/** Remote dir (relative to the sandbox work dir) holding a colony's heritable code. */
export const GENOME_DIR = 'genome'

/** path (relative to GENOME_DIR) → file contents */
export type Genome = Record<string, string>

export class Swarm {
  private daytona = new Daytona()
  private sandboxes = new Map<string, Sandbox>()

  static enabled() { return Boolean(process.env.DAYTONA_API_KEY) }

  /** Create a fresh sandbox (body) for a colony and plant its genome if given. */
  async launch(colonyId: string, genome?: Genome, extra: Record<string, string> = {}): Promise<Sandbox> {
    const sb = await this.daytona.create({
      language: 'python',
      labels: { ...GAME_LABEL, colony: colonyId, ...extra },
      autoStopInterval: 30,
      autoDeleteInterval: 60,
      envVars: { COLONY_ID: colonyId },
    })
    this.sandboxes.set(colonyId, sb)
    if (genome) await this.plant(sb, genome)
    return sb
  }

  /** Reproduce: read the parent's genome, mutate it, plant it in a new body. */
  async reproduce(parentColonyId: string, childColonyId: string, mutate: (g: Genome) => Genome = (g) => g): Promise<Sandbox> {
    const genome = mutate(await this.readGenome(parentColonyId))
    return this.launch(childColonyId, genome, { parent: parentColonyId })
  }

  /** Write a genome into a sandbox's GENOME_DIR (overwrites same-named files). */
  async plant(sb: Sandbox, genome: Genome) {
    await sb.fs.createFolder(GENOME_DIR, '755').catch(() => {})
    await sb.fs.uploadFiles(Object.entries(genome).map(([path, content]) => ({ source: Buffer.from(content), destination: `${GENOME_DIR}/${path}` })))
  }

  /** Read a colony's genome back out of its sandbox (flat dir, small files). */
  async readGenome(colonyId: string): Promise<Genome> {
    const sb = this.sandboxes.get(colonyId)
    if (!sb) throw new Error(`no sandbox for ${colonyId}`)
    const files = await sb.fs.listFiles(GENOME_DIR)
    const out: Genome = {}
    await Promise.all(files.filter((f) => !f.isDir).map(async (f) => { out[f.name] = (await sb.fs.downloadFile(`${GENOME_DIR}/${f.name}`)).toString('utf8') }))
    return out
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
