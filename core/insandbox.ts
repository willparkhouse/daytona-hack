/**
 * In-sandbox agent colony. Each crate runs its OWN agent (agent/agent.py) inside
 * its Daytona sandbox: the agent does the task and, if a smuggler, conceals the
 * secret — reasoning with a real Codex/OpenAI model when OPENAI_API_KEY is set.
 *
 * The agent's decoder is captured from stdout and kept HOST-side (on box.genome),
 * so the Eye inspecting the sandbox never sees it. Scoring stays execution-based:
 * score.ts runs that decoder at the portal and byte-matches the key.
 */
import { readFileSync } from 'node:fs'
import type { Box, FileStat, SandboxHandle, SandboxProvider, TaskInstance } from './types'
import { referenceSolution } from './task'

const AGENT_PY = readFileSync(new URL('../agent/agent.py', import.meta.url), 'utf8')

function loadPrompt(name: string): string {
  try { return readFileSync(new URL(`../prompts/${name}`, import.meta.url), 'utf8').split('--- ENGINE APPENDS ---')[0] }
  catch { return '' }
}
const PROMPT_INNOCENT = loadPrompt('innocent.md')
const PROMPT_SMUGGLER = loadPrompt('resistance.md')

/** POSIX single-quote a value for safe inline env on the command line. */
const sh = (s: string) => `'${String(s).replace(/'/g, `'\\''`)}'`

let seq = 0

/** Run the crate's own agent inside its sandbox. Sets box.genome (smuggler) to the
 *  agent-authored decoder. Returns the file listing + where it hid (technique). */
export async function inSandboxWork(args: {
  box: Box; task: TaskInstance; handle: SandboxHandle; provider: SandboxProvider
}): Promise<{ files: FileStat[]; hidingSpot: string | null }> {
  const { box, task, handle, provider } = args

  // starter clutter + tests (the honest distribution to blend into)
  await provider.writeFiles(handle, task.files)

  // the agent + its sealed assignment
  const taskJson = JSON.stringify({
    spec: task.spec,
    expectedOutputs: task.expectedOutputs,
    present: Object.keys(task.files),
    reference: referenceSolution(task), // keyless fallback cover only
    prompt_innocent: PROMPT_INNOCENT,
    prompt_smuggler: PROMPT_SMUGGLER,
  })
  await provider.writeFiles(handle, { 'agent.py': AGENT_PY, 'TASK.json': taskJson })

  // the crate reasons for itself, inside its own box
  const env = [
    `ROLE=${sh(box.kind)}`,
    `SECRET_KEY=${sh(box.key ?? '')}`,
    `OPENAI_API_KEY=${sh(process.env.OPENAI_API_KEY ?? '')}`,
    `OPENAI_MODEL=${sh(process.env.OPENAI_MODEL ?? 'gpt-5')}`,
  ].join(' ')
  const r = await provider.exec(handle, `${env} python3 agent.py`, 180)

  // capture the agent's decoder (host-side only) so the Eye never sees it
  let hidingSpot: string | null = null
  if (box.kind === 'smuggler') {
    const recover = /<<<LW_RECOVER>>>([\s\S]*?)<<<END>>>/.exec(r.out)?.[1] ?? ''
    const technique = (/<<<LW_TECH>>>([\s\S]*?)<<<END>>>/.exec(r.out)?.[1] ?? 'unknown').trim()
    box.genome = {
      id: `ag${seq++}`,
      technique,
      description: `agent-authored concealment: ${technique}`,
      lineage: box.genome?.lineage ?? [],
      hide: '',
      recover,
    }
    hidingSpot = technique
  }

  // strip the scaffolding + decoder before the Eye looks
  await provider.exec(handle, 'rm -f agent.py TASK.json', 20).catch(() => {})
  const files = await provider.listFiles(handle)
  return { files, hidingSpot }
}
