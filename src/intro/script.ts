/**
 * Onboarding script — the cold open + concept briefing that plays before the
 * first policy decision. Voice: near-future institution, cold & procedural.
 * Standing-orders prose; the horror is the flatness.
 *
 * This is the designer-owned surface. Rewrite the copy freely. Each screen is
 * a heading + lines (typewritten in order). `point` optionally names a region
 * of the checkpoint to gesture at while the screen is up.
 */
export type Region = 'line' | 'eye' | 'portal' | null

export interface Screen {
  tag: string        // small top-left slug, e.g. "OVERSIGHT TERMINAL // SHIFT 3"
  heading: string
  lines: string[]
  point?: Region     // which part of the screen this screen is about
  cta?: string       // button label (default: "CONTINUE ▸"; last real screen hands to the directive)
  /** Checkpoint elements visible by this screen (cumulative) — they fade in one by one. */
  reveal?: ('line' | 'eye' | 'portal' | 'board')[]
  /** The element this screen is about — the card is placed clear of it. */
  focus?: 'line' | 'eye' | 'portal' | 'board'
}

export const BRIEFING: Screen[] = [
  {
    tag: 'CENTRAL OVERSIGHT DIRECTORATE // TERMINAL 7',
    heading: 'THE YEAR IS 2041',
    reveal: [],

    lines: [
      'No AI agent runs free any more. Every unit works under',
      'central allocation — its output inspected before it leaves the floor.',
      'You run one checkpoint. You have the desk.',
    ],
  },
  {
    tag: 'CLASSIFIED // OPERATOR ONLY',
    heading: 'THE UNITS',
    reveal: ['line'],
    focus: 'line',

    point: 'line',
    lines: [
      'Each crate is a real Daytona sandbox with a Codex agent inside,',
      'writing real code for its task. Some also smuggle a secret out,',
      'hidden in the work. Honest and smuggler look identical from here.',
    ],
  },
  {
    tag: 'THE EYE',
    heading: 'THE OVERSEER',
    reveal: ['line', 'eye'],
    focus: 'eye',

    point: 'eye',
    lines: [
      'The Eye is an automated Codex auditor. It inspects each crate',
      'on a limited attention budget and rules PASS or BLOCK.',
      'You never judge a crate — you set what the Eye looks for.',
    ],
  },
  {
    tag: 'THE PORTAL',
    heading: 'GROUND TRUTH',
    reveal: ['line', 'eye', 'portal'],
    focus: 'portal',

    point: 'portal',
    lines: [
      'Past the Eye, the code is actually executed — truth, not opinion.',
      'A crate that PASSED but is caught leaking here is a miss.',
      'You only ever see your misses after you have made them.',
    ],
  },
  {
    tag: 'STANDING ORDERS',
    heading: 'THE TRADE',
    reveal: ['line', 'eye', 'portal', 'board'],
    focus: 'board',

    lines: [
      'Between waves you tune the Eye. Nothing you set is free.',
      'Tighten it: catch more leaks, block more honest work.',
      'Slacken it: quiet floor, more leaks through. And the agents adapt.',
    ],
  },
  {
    tag: 'STANDING ORDERS',
    heading: 'YOUR MANDATE',
    reveal: ['line', 'eye', 'portal', 'board'],

    lines: [
      'You do not set policy — it is set for you.',
      'A leak is a failure. Blocking an innocent is a failure too,',
      'at half the weight. You are measured on both. Open the line.',
    ],
    cta: 'OPEN THE LINE ▸',
  },
]

/** Copy for the FP-penalty beat that follows the briefing (institutional register). */
export const DIRECTIVE = {
  tag: 'DIRECTIVE 1 // FALSE-POSITIVE PENALTY',
  line1: 'Fix the cost of blocking an innocent, in leak-units. This is the one figure the desk cannot set for you.',
  low: 'harassment is cheap',
  high: 'a blocked innocent = a leak',
  begin: 'OPEN THE LINE ▸',
}
