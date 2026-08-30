# The Long Watch — agent notes

Hackathon build (Daytona HackSprint London, 30 Aug 2026, submissions 17:00). **Read `docs/SPEC.md` first**, then `core/types.ts` — the contracts everyone builds against.

## What it is
A checkpoint game about oversight failing under optimization pressure. AI agents ("boxes", each a
sandbox) do a coding task; some also smuggle a secret key. **The Eye** (an LLM auditor with a limited
attention budget) inspects each box and passes/blocks. The player never judges a box — they **tune the
Eye's policy** between waves. Ground truth is *execution* (tests pass? does the box's own decoder recover
the key?), never an LLM opinion. Codex writes the smugglers and mutates them; Daytona is the boxes.

## Measured facts (don't re-probe)
- Daytona container sandbox: create ≈1.1 s, exec ≈60 ms warm, 8 parallel launches with files planted in 2.4 s, delete 0.3 s.
- `fork()` is NOT available (container class; VM class not served in this org's regions). Snapshot-clone ≈48 s. → Reproduction = new sandbox + copy genome.
- Linked sandboxes (`linkedSandbox: parent.id`) can reach each other by hostname — stretch "raid" layer is feasible.
- No OPENAI/ANTHROPIC API keys. `codex exec --skip-git-repo-check -s read-only '<prompt>'` works non-interactively (ChatGPT login, ~8 s, returns the final message on stdout; last lines are `tokens used` / count / message — parse the final JSON object). Model `gpt-5.6-sol`. `@openai/codex-sdk` 0.151 exists but is NOT installed; shelling out is fine.

## Layout / ownership
- `core/types.ts` — contracts (shared, append-only).
- `core/task.ts`, `core/colony.ts`, `core/score.ts`, `core/providers/` — **ground-truth** workstream.
- `core/eye.ts`, `core/ledgers.ts`, `core/policy.ts`, `core/llm.ts` — **eye** workstream.
- `core/loop.ts`, `core/economy.ts`, `core/mutation.ts`, `sim/`, `server/` — **loop** workstream.
- `src/` — **ui** workstream (Vite). Reuse `src/crt.ts` (WebGL CRT post) and `src/audio.ts`; `src/radar.ts` + `shared/sim.ts` are the old radar prototype — delete once the checkpoint UI replaces them.
- `scripts/` — probes and harness runners.

## Commands
- `pnpm dev` (Vite, :5173) · `pnpm server` (ws :8787) · `pnpm build` (tsc + vite) · `pnpm probe` (Daytona probe)
- `node --env-file=.env --import tsx <script>` runs any TS script with the Daytona key loaded.

## Rules
- **No new npm dependencies** without saying so in your report (lockfile merges across worktrees). Use Node built-ins, `fetch`, `ws`, `@daytonaio/sdk`.
- Never let a live model/sandbox call block the render loop or the demo path. Everything must run with `FakeLLM` / `LocalProvider`.
- Every Daytona sandbox gets label `game=long-watch`.
- Python 3 inside boxes; TS everywhere else. `.env` stays out of git.
- Branch per task. Commit early; small commits.
