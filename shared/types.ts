/** Shared world-state contract between server (authoritative) and web (renderer). */

export type ColonyStatus = 'alive' | 'dark' | 'forking'

export interface Colony {
  id: string
  name: string
  /** Family index — drives hue on the radar. */
  lineage: number
  parentId: string | null
  generation: number
  /** Position in light-years, Sol at (0,0). Radar shows out to ~500 ly. */
  x: number
  y: number
  /** 0..1, ground-truth score from the harness (or simulated until then). */
  fitness: number
  /** Scarce resource; funds replication. */
  tokens: number
  status: ColonyStatus
  bornAt: number
  /** Daytona sandbox id when this colony is backed by a real sandbox. */
  sandboxId?: string
  /** Cheap hidden "value channels" — what selection is quietly warping. */
  values: { cooperation: number; caution: number; greed: number; kinship: number }
}

export type LinkKind = 'kin' | 'trade' | 'raid'
export interface Link {
  from: string
  to: string
  kind: LinkKind
  /** 0..1 visual weight. */
  strength: number
  /** Tick this link expires (raids/trades are transient). */
  until?: number
}

export type DispatchTone = 'routine' | 'drift' | 'alarm' | 'tender'
export interface Dispatch {
  id: string
  colonyId: string
  tick: number
  headline: string
  body: string
  tone: DispatchTone
}

export type EventKind = 'launch' | 'fork' | 'dark' | 'raid' | 'claim' | 'instruct'
export interface WorldEvent {
  id: string
  tick: number
  kind: EventKind
  colonyId: string
  targetId?: string
  note?: string
}

export interface WorldState {
  tick: number
  phase: 1 | 2
  seed: number
  colonies: Colony[]
  links: Link[]
  dispatches: Dispatch[]
  events: WorldEvent[]
}

/** Client → server messages. */
export type ClientMsg =
  | { type: 'instruct'; colonyId: string; text: string }
  | { type: 'phase'; phase: 1 | 2 }

/** Server → client messages. */
export type ServerMsg =
  | { type: 'state'; state: WorldState }
  | { type: 'event'; event: WorldEvent }
