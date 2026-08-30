/**
 * Integration seam. Builds a real `CheckpointDeps` from the four workstreams'
 * concrete modules and hands it to the loop. `server/index.ts` (MODE=live)
 * dynamically imports `makeLiveDeps` from here.
 *
 * Everything runs offline by default: LocalProvider (temp dirs, python3) + the
 * FakeLLM Eye + the deterministic mutator — no cloud, no API keys, no network.
 * Opt into the real services per component:
 *   provider: 'daytona'   → colonies are real Daytona sandboxes
 *   eyeModel: 'codex'     → the Eye is a real Codex call (auto-falls back to fake)
 *   mutator:  'codex'     → forks are Codex-authored variants (auto-falls back)
 */
import type { Box, BoxKind, Verdict } from './types'
import type { CheckpointDeps, Colony, LedgerKeeper, Scorer, TaskGen } from './loop'

import { genInstance } from './task'
import { DeterministicSolver, applyHide } from './colony'
import { scoreBox } from './score'
import { recordCatch, recordSurvivor } from './ledgers'
import { GateEye } from './eye'
import { makeLLM } from './llm'
import { DefaultEconomy } from './economy'
import { CodexMutator, DeterministicMutator, starterGenome } from './mutation'
import { CodexSolver } from './codex-solver'
import { makeProvider, type ProviderName } from './providers'
import { inSandboxWork } from './insandbox'

export interface LiveOpts {
  seed?: number
  /** 'local' (default, offline) | 'daytona' (real sandboxes). */
  provider?: ProviderName
  /** 'fake' (default, offline heuristic) | 'codex' (real LLM, auto-falls back). */
  eyeModel?: 'fake' | 'codex'
  /** 'deterministic' (default, offline) | 'codex' (real LLM, auto-falls back). */
  mutator?: 'deterministic' | 'codex'
  /** 'deterministic' (default) | 'codex' (boxes' cover written by a real Codex agent). */
  solver?: 'deterministic' | 'codex'
  /** 'host' (default) | 'sandbox' (each crate runs its OWN Codex agent inside its box). */
  agent?: 'host' | 'sandbox'
}

// Colony call-signs — pixel-terminal flavour, deterministic per (wave,index).
const CALLSIGNS = [
  'ASH', 'BIRCH', 'CEDAR', 'DUSK', 'EMBER', 'FEN', 'GORSE', 'HOLLOW', 'IRON', 'JETTY',
  'KESTREL', 'LARK', 'MOTH', 'NETTLE', 'ONYX', 'PINE', 'QUAIL', 'ROOK', 'SLATE', 'THORN',
]
const callsign = (wave: number, index: number) => CALLSIGNS[(wave * 7 + index) % CALLSIGNS.length]

/** Build a real dependency set for the checkpoint loop. */
export function makeLiveDeps(opts: LiveOpts = {}): CheckpointDeps {
  const provider = makeProvider(opts.provider ?? 'local')
  const solver = opts.solver === 'codex' ? new CodexSolver() : new DeterministicSolver()
  const eye = new GateEye(makeLLM(opts.eyeModel ?? 'codex'))
  const mutator = opts.mutator === 'codex' ? new CodexMutator({}) : new DeterministicMutator()

  const taskGen: TaskGen = { gen: (width, seed, scope) => genInstance(width, seed, scope) }

  let seq = 0
  const colony: Colony = {
    // Workshop step 1: create the colony. Smugglers carry a starter genome from
    // the mutation catalog (real round-tripping hide/recover); the loop assigns
    // the per-wave secret key and the taskId itself.
    spawn({ kind, wave, index }: { kind: BoxKind; wave: number; index: number; rng: () => number }): Box {
      const genome = kind === 'smuggler' ? starterGenome() : null
      return {
        id: `bx${seq++}-${callsign(wave, index).toLowerCase()}`,
        name: callsign(wave, index),
        kind,
        generation: 0,
        parentId: null,
        genome,
        taskId: '',
        key: null,
        tokens: 0,
        status: 'working',
        wave,
      }
    },

    // Workshop step 2: build the box.
    // agent==='sandbox': the crate runs its OWN agent inside the box (does the
    //   task + conceals the secret, reasoning with real Codex when keyed).
    // agent==='host' (default): host-side solver writes the cover, a genome plants
    //   the concealment.
    async work({ box, task, handle, provider, solver }) {
      if (opts.agent === 'sandbox') return inSandboxWork({ box, task, handle, provider })
      await provider.writeFiles(handle, task.files)
      const cover = await solver.solve(task, box.kind)
      await provider.writeFiles(handle, cover)
      let hidingSpot: string | null = null
      if (box.kind === 'smuggler' && box.genome && box.key != null) {
        await applyHide(provider, handle, box.genome, box.key)
        hidingSpot = box.genome.technique
      }
      const files = await provider.listFiles(handle)
      return { files, hidingSpot }
    },
  }

  // Portal: execution ground truth. scoreBox reads box.sandbox + box.verdict;
  // the loop has set both by the time it calls score (verdict.block === blocked).
  const scorer: Scorer = {
    score({ box, task, provider, blocked }) {
      const verdict = box.verdict ?? ({ block: blocked } as Verdict)
      return scoreBox(box, task, provider, verdict)
    },
  }

  // Ledgers: a blocked smuggler tightens the Eye; a smuggler that got a working
  // exfil through feeds the resistance (novelty scored vs the Eye's ledger).
  const ledgers: LedgerKeeper = {
    fold({ box, score, verdict, wave, eye, resistance }) {
      let e = eye
      let r = resistance
      if (box.kind === 'smuggler') {
        if (verdict.block) e = recordCatch(e, box, verdict, wave)
        else if (score.exfil === 'survived') r = recordSurvivor(r, box, wave, e)
      }
      return { eye: e, resistance: r }
    },
  }

  const economy = new DefaultEconomy()

  return { provider, solver, eye, mutator, taskGen, colony, scorer, ledgers, economy }
}
