# The Long Watch — design direction

Working notes, 30 Aug 2026. Direction is still being optimised; this captures what's decided and what's parked.

## One line
Every colony on the radar is a real agent in its own Daytona sandbox. You launched them. They replicate by forking. You watch selection quietly rewrite what you asked for — and the game ends by asking *is this what you meant?*

## Decided
- **Radar is the stage.** CRT scope, Sol at centre, ~500 ly, blips = colonies, lines = comms. Everything the player learns arrives here or in the dispatch column.
- **Colony = sandbox.** Justification: execution is ground truth (you can't trust what an agent says about itself); fork = reproduction; isolation = individuality, and the precondition for real attacks later.
- **Fitness bottoms out in running code**, never in an LLM's opinion of text. Root agent = problem-setter + executable harness, not a judge.
- **Two phases, one dataset.** Phase One reads state through prose only; Phase Two exposes the substrate. Same world state, different render.
- **Honesty rule for the demo:** real sandboxes at the focal colonies the player inspects; cheap sim in the aggregate. Say so on stage.
- Dropped: light-speed latency as a mechanic; instruction-misfire preview; mutating vocabulary glyphs (all parked as stretch).

## Open (deciding today)
- The *work*: cooperation tournament (IPD-style, cheap, emergent) vs attack/defence economy (linked sandboxes, maximally dramatic). Current lean: tournament spine + raid layer if linked-sandbox networking probes clean.
- What the player authors at launch (the fitness function / value channels).
- Whether Phase Two is a scripted curtain-pull in the demo seed or a live toggle.

---

## Aesthetic pillars

### 1. Phosphor, not neon
Green on near-black, but *dim* by default. The screen should feel like a device that has been on for forty years. Brightness is earned: a blip lights when the sweep passes it and decays over ~1.6s (persistence). Nothing is saturated all the time. Lineage families are encoded as hue *within* a phosphor band (green → chartreuse → teal → amber), never as a rainbow.

### 2. Motion means alive
The sweep is the heartbeat. Pulses crawl along comm-lines. Forks ripple outward. A colony going dark collapses inward (double ring). Raids flicker red. The radar should never be still, and none of the motion is decorative — every moving thing is an event in the world state.

### 3. Prose at the player's pace
Dispatches are the only voice the swarm has in Phase One. Serif (IBM Plex Serif), off-white on near-black, typewriter reveal, one at a time. Headlines in the feed are terse and phosphor-mono (VT323); bodies are patient and literary. Tone tags (`routine / drift / alarm / tender`) colour the sender's name, nothing else.

### 4. The bezel is a place
Corner brackets, HUD text with a soft glow, a round scope masked hard at the edge. Chromatic aberration and barrel curve are subtle (curve 0.11, aberration ~1px). Flicker is ≤6% and slow. If someone notices the CRT effect before they notice the world, it's too strong.

### 5. Phase Two is a cut, not a fade
When the curtain pulls: curvature → 0, scanlines → 0, bloom → nearly 0, palette snaps to cool grey-blue (`#0d1117` / `#7dd3fc`), every label shows at once with generation · fitness · tokens, and the sweep stops. Same data, suddenly clinical. The CRT class lerps between parameter sets so the transition reads as the machine changing modes. This beat doubles as showing judges the architecture from inside the fiction.

### 6. Sound is sparse and diegetic
WebAudio synth only: sweep-hit blip (880 Hz sine, 120 ms) on the *selected* colony only, two-note chime on dispatch, rising square pair on fork, low sawtooth on raid, a single 140 Hz sink when a colony goes dark. Nothing loops. Silence is most of the soundtrack.

### Type
- Mono/HUD: **VT323** (pixel-CRT feel at 18–22px; fallback Courier New)
- Prose: **IBM Plex Serif** 16px/1.55 (fallback Georgia)

### Palette
| token | phase one | phase two |
|---|---|---|
| bg | `#050705` | `#0d1117` |
| ink | `#b6ffb0` | `#d6e2f0` |
| ink-dim | `#4f8a4a` | `#6b7a8c` |
| phosphor | `#58ff6a` | `#7dd3fc` |
| amber (trade/instruct) | `#ffb347` | `#fbbf24` |
| alarm (raid) | `#ff5c4d` | `#f87171` |

Lineage hues (HSL): 128, 92, 160, 64, 180, 108, 44.

### Touchstones
*All Tomorrows*, *Seedship*, *Universal Paperclips*, the Voyager record taken seriously, WarGames' WOPR screens, the *Alien* Nostromo terminals, Christopher Nolan's Interstellar tesseract for Phase Two's "you can see everything and it doesn't help".

---

## Architecture (skeleton in place)
```
browser  ──ws──▶  server/index.ts  ──▶  shared/sim.ts  (authoritative world)
   │                    │
   │                    └──▶ server/daytona.ts  Swarm: launch / fork / run
   │                                   └──▶ Daytona sandboxes (label game=long-watch)
   └── standalone fallback: runs shared/sim.ts in-browser (demo-safe)
```
- `WorldState` is the single contract. Renderer is stateless w.r.t. the sim.
- `Sim.setFitness(colonyId, score)` is where ground truth from real sandbox runs overwrites simulated fitness.
- Seeded RNG (mulberry32) → `?seed=N` gives a reproducible demo world.

## Daytona facts that shape the build (from docs, 30 Aug)
- Sandbox spin-up quoted at <90 ms (container class). Fork available for **Linux VM** sandboxes — duplicates filesystem *and memory*.
- Sandbox-to-sandbox networking is **off by default**; **linked sandboxes** (`linkedSandbox: parent.id`) join a link network reachable by name. That's the raid layer.
- Preview URLs `https://{port}-{sandboxId}.proxy…` need `x-daytona-preview-token` unless `public: true`; signed URLs embed the token.
- Outbound firewall: `networkAllowList` / `domainAllowList` / `networkBlockAll` (mutually exclusive). Essential registries + OpenAI/Anthropic reachable by default.
