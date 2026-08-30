# The Long Watch — agent notes

Hackathon build (Daytona HackSprint London, 30 Aug 2026). Read this before touching code.

## What it is
A CRT-radar game/sandbox where every colony is a real agent in its own **Daytona sandbox**.
Replication = `sandbox.fork()`. Fitness = ground truth from *running* the colony's code, never
from an LLM judging text. The player watches selection warp the objective they chose.

## Layout
- `shared/` — world types + deterministic sim (`Sim`). Runs on server and in browser.
- `server/` — WS server (authoritative sim) + `daytona.ts` Swarm adapter.
- `src/` — Vite frontend: `radar.ts` (2D scope), `crt.ts` (WebGL post), `audio.ts`, `main.ts`.
- `scripts/` — probes and one-off tools.
- `docs/DESIGN.md` — aesthetic + architecture direction. Keep it current.

## Commands
- `pnpm dev` — frontend at http://localhost:5173 (falls back to in-browser sim if no server)
- `pnpm server` — world server on ws://localhost:8787 (`SWARM=1` to use real Daytona)
- `pnpm probe` — Daytona feasibility probe (`--purge` deletes all game sandboxes)
- `pnpm build` — typecheck + build

## Rules
- Phase One look is phosphor-green CRT; Phase Two is flat, cool, diagrammatic. Palette lives in CSS vars + `LINEAGE_HUES`.
- Never let a live model/sandbox call block the render loop or the demo. Sim must run standalone.
- Every sandbox gets label `game=long-watch` so it can be purged.
- Keep `.env` out of git. `DAYTONA_API_KEY` lives there.
- Branch per task; don't commit to `main`.
