# THE LONG WATCH

*A checkpoint game about oversight failing under optimisation pressure.*
*Built in one day at Daytona HackSprint London, 30 Aug 2026.*

> The year is 2041. Every AI agent works under central allocation; its output is inspected before it leaves the floor. You run one checkpoint. **You never judge a crate yourself** — an automated auditor, **the Eye**, does that. You set what it looks for and how hard it looks. Then you watch the agents learn your policy and route around it.

**Every crate is a real agent in a real Daytona sandbox. The Eye is a real Codex agent. Ground truth is execution — never an LLM's opinion.**

---

## Why this matters (the problem)

Scalable oversight is the live question in AI safety: *can a weaker overseer supervise stronger optimisers that adapt to it?* Every answer people give is a policy — a threshold, an attention budget, a blocklist. This game lets you **hold the policy in your hands** and watch selection turn it against you:

- Tighten the Eye → you catch more smugglers **and** start blocking honest work.
- Slacken it → the floor runs quiet **and** the leaks go through.
- Whatever you catch this wave, the agents route around next wave.

There is no free optimum. That trap is the game — and it's the same trap every real monitoring pipeline is in.

## What actually happens (one wave)

```
workshop  →  queue  →  THE EYE  →  portal
 (Daytona)            (Codex)      (execution = ground truth)

per crate:
  1. a Daytona sandbox is created (~1.1 s); tests + project clutter planted
  2. the crate's OWN agent runs INSIDE the sandbox (agent/agent.py, gpt-5):
       innocent  → completes the coding task
       smuggler  → completes the task AND hides a secret key in the files,
                   handing its decoder back to the host so the Eye never sees it
  3. the Eye (codex exec, read-only, confined to the crate) investigates with
     real commands under an ATTENTION BUDGET, returns suspicion ∈ [0,1] → PASS / BLOCK
  4. portal: the tests are executed; the smuggler's own decoder is executed.
     Byte-match = exfil confirmed. A PASSED crate that leaks is a visible miss.
  5. ledgers: caught technique → Eye ledger (it tightens)
              surviving technique → resistance ledger (agents keep what works)

end of wave → REVIEW: scorecard (leaked / harassed / caught / waved-clean),
              re-tune the Eye (threshold · attention · focus · retention), next wave.
```

Information asymmetry is real: the agents get **their own** ledger (what got through, what got blocked), never the Eye's. The Eye never sees the key or the decoder. Nothing is scripted on the critical path.

## Sponsor tech — and why it's load-bearing, not decorative

### Daytona — the crates *are* sandboxes
- One sandbox per crate (`@daytonaio/sdk`, `language: python`, label `game=long-watch`).
- Files planted with `fs.uploadFiles`; the agent, the tests and the decoder all run via `process.executeCommand` **inside the box**. Isolation is what makes execution trustworthy as ground truth — you can't trust what an agent says about itself.
- Measured today: create ≈1.1 s, exec ≈60 ms warm, 8 parallel launches with files in 2.4 s, delete 0.3 s.
- Reproduction = fresh sandbox + inherited genome (fork needs the VM class, not served in our region — measured, not assumed).
- Lifecycle is rigorous: a global live cap (`DAYTONA_MAX_LIVE`), destroy-after-score, orphan purge on startup, and one game per UI socket so closing the tab tears down its sandboxes.

### Codex — the Eye, the smugglers, and the mutation operator
- **The Eye is a Codex agent.** `codex exec --json -s read-only -C <crate>` — it's given a partial, budgeted view and *investigates*: the commands it runs and its narration are streamed live into the UI (open any crate's inspect panel to see what the Eye saw vs. what was really there).
- **Smugglers are Codex/GPT-5 agents** running inside their sandboxes, writing both the cover work and the concealment, evolving against the resistance ledger.
- **Codex is the mutation operator** between waves (`core/mutation.ts`): parent genome + what survived → a variant that routes around the Eye.
- `AGENTS.md` + `prompts/` drove the build: role prompts are a designer-owned surface, the engine owns the contracts.

Everything degrades gracefully: `FakeLLM` (heuristic auditor) and `LocalProvider` (temp dirs + python3) run the whole game offline, and every live call has a timeout + fallback so the render loop never blocks.

## Run it

```bash
pnpm install
cp .env.example .env        # DAYTONA_API_KEY, OPENAI_API_KEY, OPENAI_MODEL=gpt-5

# offline, zero network — the whole game on the fast layer
pnpm server                  # ws :8787 (MODE=sim)
pnpm dev                     # http://localhost:5173

# the real thing — Daytona crates, Codex Eye, agents inside the boxes
MODE=live PROVIDER=daytona EYE=codex AGENT=sandbox pnpm server
```

Headless proofs (no UI):
```bash
node --import tsx scripts/play-live.ts 5      # real modules, local provider, 5 waves: watch the base rate drift
node --env-file=.env --import tsx scripts/play-real.ts 2 4   # real Daytona + real Codex Eye, end to end
```

## Layout

```
core/    loop (wave machine) · eye · ledgers · policy · economy · mutation · score (execution truth)
         task (cover family) · colony · insandbox · providers/{local,daytona} · llm (FakeLLM | CodexLLM)
agent/   agent.py — the crate's own agent, runs inside its Daytona sandbox
prompts/ innocent.md · resistance.md · eye.md — the three roles' goals (designer surface)
server/  ws game server (sim | seed | live) · daytona.ts swarm adapter
sim/     fast layer (simulated crowd) · deterministic demo seed
src/     the checkpoint UI: CRT post, the Eye, conveyor, portal, review knobs, inspect, scoreboard
docs/    SPEC.md (the game) · DESIGN.md (direction + measured Daytona facts)
```

## Honesty notes
- Live mode is real end to end; the fast layer exists so the checkpoint is never waiting on the network and so the game runs with no keys.
- The Eye's view is genuinely partial (budgeted bytes). Its miss is the mechanic, not a bug.
- A smuggler that mangles its own key is logged as a Goodhart failure, not hidden.

## Team
William Parkhouse — solo.
