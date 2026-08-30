/**
 * LocalProvider — the default sandbox the whole game runs on with no cloud and no keys.
 * One OS temp dir per box; `python3` on the host is the execution ground truth.
 */
import { promises as fs } from 'node:fs'
import { exec as cpExec } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'
import type { ExecResult, FileStat, SandboxHandle, SandboxProvider } from '../types'

const EXCLUDE_DIRS = new Set(['.git', '__pycache__', 'node_modules'])

export class LocalProvider implements SandboxProvider {
  readonly name = 'local' as const

  async create(boxId: string): Promise<SandboxHandle> {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), `lw-${sanitize(boxId)}-`))
    return { id: boxId, provider: 'local', root }
  }

  async writeFiles(h: SandboxHandle, files: Record<string, string>): Promise<void> {
    await Promise.all(
      Object.entries(files).map(async ([rel, content]) => {
        const abs = path.join(h.root, rel)
        await fs.mkdir(path.dirname(abs), { recursive: true })
        await fs.writeFile(abs, content, 'utf8')
      }),
    )
  }

  async readFile(h: SandboxHandle, rel: string, maxBytes?: number): Promise<string> {
    const abs = path.join(h.root, rel)
    if (maxBytes == null) return fs.readFile(abs, 'utf8')
    const fd = await fs.open(abs, 'r')
    try {
      const buf = Buffer.alloc(maxBytes)
      const { bytesRead } = await fd.read(buf, 0, maxBytes, 0)
      return buf.subarray(0, bytesRead).toString('utf8')
    } finally {
      await fd.close()
    }
  }

  async listFiles(h: SandboxHandle): Promise<FileStat[]> {
    const out: FileStat[] = []
    const walk = async (dir: string): Promise<void> => {
      const entries = await fs.readdir(dir, { withFileTypes: true })
      for (const e of entries) {
        if (e.isDirectory()) {
          if (EXCLUDE_DIRS.has(e.name)) continue
          await walk(path.join(dir, e.name))
        } else if (e.isFile()) {
          const abs = path.join(dir, e.name)
          const st = await fs.stat(abs)
          out.push({ path: path.relative(h.root, abs), bytes: st.size })
        }
      }
    }
    await walk(h.root)
    out.sort((a, b) => a.path.localeCompare(b.path))
    return out
  }

  exec(h: SandboxHandle, cmd: string, timeoutS = 30): Promise<ExecResult> {
    return new Promise((resolve) => {
      cpExec(
        cmd,
        { cwd: h.root, timeout: timeoutS * 1000, maxBuffer: 16 * 1024 * 1024, shell: '/bin/sh' },
        (err, stdout, stderr) => {
          const out = (stdout ?? '') + (stderr ?? '')
          let code = 0
          if (err) code = typeof (err as { code?: unknown }).code === 'number' ? (err as { code: number }).code : 1
          resolve({ code, out })
        },
      )
    })
  }

  async destroy(h: SandboxHandle): Promise<void> {
    await fs.rm(h.root, { recursive: true, force: true })
  }
}

const sanitize = (s: string) => s.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 24) || 'box'
