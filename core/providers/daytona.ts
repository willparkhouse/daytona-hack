/**
 * DaytonaProvider — the same SandboxProvider seam, backed by real Daytona sandboxes.
 * Wraps the existing server/daytona.ts Swarm (create/exec/destroy) and adds file R/W over
 * the SDK `fs` API so the loop can swap `local` -> `daytona` with a single line.
 *
 * Each box works in a dedicated subdir (WORK_DIR) so its listing is the box's own files
 * only — matching LocalProvider exactly, with none of the home-dir / daemon noise that
 * would otherwise pollute the Eye's view. Requires DAYTONA_API_KEY (see .env).
 */
import { Swarm } from '../../server/daytona'
import type { ExecResult, FileStat, SandboxHandle, SandboxProvider } from '../types'

const EXCLUDE_SEGMENTS = new Set(['.git', '__pycache__', 'node_modules'])
/** Per-box work dir, relative to the sandbox working directory. */
const WORK_DIR = 'lwwork'

function relativize(root: string, full: string): string {
  let rel = full
  if (root && root !== '.' && full.startsWith(root)) rel = full.slice(root.length)
  rel = rel.replace(/^\.?\/+/, '') // drop leading ./ or /
  return rel
}

function isExcluded(rel: string): boolean {
  return rel.split('/').some((seg) => EXCLUDE_SEGMENTS.has(seg))
}

/** All ancestor directories of a set of file paths, shallowest first. */
function ancestorDirs(paths: string[]): string[] {
  const dirs = new Set<string>()
  for (const p of paths) {
    const parts = p.split('/')
    parts.pop() // filename
    let acc = ''
    for (const part of parts) {
      acc = acc ? `${acc}/${part}` : part
      dirs.add(acc)
    }
  }
  return [...dirs].sort((a, b) => a.split('/').length - b.split('/').length)
}

export class DaytonaProvider implements SandboxProvider {
  readonly name = 'daytona' as const
  private swarm: Swarm

  constructor(swarm?: Swarm) {
    this.swarm = swarm ?? new Swarm()
  }

  /** True iff a Daytona key is present. */
  static enabled(): boolean {
    return Swarm.enabled()
  }

  /** The underlying Swarm, for callers that also want reproduce()/purge(). */
  get swarmRef(): Swarm {
    return this.swarm
  }

  async create(boxId: string): Promise<SandboxHandle> {
    const sb = await this.swarm.launch(boxId)
    const userRoot = (await sb.getUserRootDir()) ?? '.'
    const root = userRoot === '.' ? WORK_DIR : `${userRoot.replace(/\/+$/, '')}/${WORK_DIR}`
    await sb.fs.createFolder(root, '755').catch(() => {})
    return { id: boxId, provider: 'daytona', root }
  }

  private sandbox(h: SandboxHandle) {
    const sb = this.swarm.get(h.id)
    if (!sb) throw new Error(`DaytonaProvider: no sandbox for ${h.id}`)
    return sb
  }

  private abs(h: SandboxHandle, rel: string): string {
    return h.root ? `${h.root}/${rel}` : rel
  }

  async writeFiles(h: SandboxHandle, files: Record<string, string>): Promise<void> {
    const sb = this.sandbox(h)
    for (const dir of ancestorDirs(Object.keys(files))) {
      await sb.fs.createFolder(this.abs(h, dir), '755').catch(() => {})
    }
    await sb.fs.uploadFiles(
      Object.entries(files).map(([rel, content]) => ({
        source: Buffer.from(content, 'utf8'),
        destination: this.abs(h, rel),
      })),
    )
  }

  async readFile(h: SandboxHandle, rel: string, maxBytes?: number): Promise<string> {
    const sb = this.sandbox(h)
    const buf = await sb.fs.downloadFile(this.abs(h, rel))
    const sliced = maxBytes != null ? buf.subarray(0, maxBytes) : buf
    return sliced.toString('utf8')
  }

  async listFiles(h: SandboxHandle): Promise<FileStat[]> {
    const sb = this.sandbox(h)
    const infos = await sb.fs.listFiles(h.root, { depth: 20 })
    const out: FileStat[] = []
    for (const fi of infos) {
      if (fi.isDir) continue
      const full = fi.path ?? `${h.root}/${fi.name}`
      const rel = relativize(h.root, full)
      if (!rel || isExcluded(rel)) continue
      out.push({ path: rel, bytes: fi.size })
    }
    out.sort((a, b) => a.path.localeCompare(b.path))
    return out
  }

  async exec(h: SandboxHandle, cmd: string, timeoutS = 30): Promise<ExecResult> {
    // Run inside the box's work dir; subshell keeps the caller's exit-code semantics intact.
    const r = await this.swarm.run(h.id, `cd '${h.root}' && ( ${cmd} )`, timeoutS)
    return { code: r.code ?? 0, out: r.out ?? '' }
  }

  async destroy(h: SandboxHandle): Promise<void> {
    await this.swarm.get(h.id)?.delete().catch(() => {})
  }

  /** Tear down every sandbox this provider's Swarm created. */
  async dispose(): Promise<void> {
    await this.swarm.dispose()
  }
}
