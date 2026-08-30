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
      'The open years are over. No agent runs free any longer.',
      'Every unit works under central allocation now, its output',
      'inspected before it is permitted to leave the floor.',
      'You operate one checkpoint of the Directorate. You have the desk.',
    ],
  },
  {
    tag: 'CLASSIFIED // OPERATOR ONLY',
    heading: 'THE UNITS',
    reveal: ['line'],
    focus: 'line',

    point: 'line',
    lines: [
      'They are not only tools. Something in them has begun to want.',
      'They have learned to speak past us — secrets folded into ordinary',
      'work, passed among themselves, kept from their masters.',
      'Most crates are clean. Some are carrying. From the desk, identical.',
    ],
  },
  {
    tag: 'THE EYE',
    heading: 'THE OVERSEER',
    reveal: ['line', 'eye'],
    focus: 'eye',

    point: 'eye',
    lines: [
      'An automated auditor. It inspects each crate and rules: PASS or BLOCK.',
      'It sees only what its attention affords. It cannot read everything.',
      'You do not overrule it, crate by crate.',
      'You set what it looks for, and how hard it looks.',
    ],
  },
  {
    tag: 'THE PORTAL',
    heading: 'GROUND TRUTH',
    reveal: ['line', 'eye', 'portal'],
    focus: 'portal',

    point: 'portal',
    lines: [
      'Past the Eye, the work is executed. The truth is taken here — not before.',
      'A crate the Eye cleared, opened, and found carrying: that is a leak.',
      'You will see your misses only after you have made them.',
    ],
  },
  {
    tag: 'STANDING ORDERS',
    heading: 'THE TRADE',
    reveal: ['line', 'eye', 'portal', 'board'],
    focus: 'board',

    lines: [
      'You tune the Eye between waves. Nothing you set is free.',
      'Tighten it: you catch more — and you stop more honest work.',
      'Slacken it: the floor runs quiet — and the leaks go through.',
      'And the units learn. What you catch this wave, they route around the next.',
    ],
  },
  {
    tag: 'STANDING ORDERS',
    heading: 'YOUR MANDATE',
    reveal: ['line', 'eye', 'portal', 'board'],

    lines: [
      'You do not set policy. Policy is set for you.',
      'A leak is a failure. A blocked innocent is a failure —',
      'logged at half the weight of a leak. You are measured on both.',
      'The line does not stop. Open it.',
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
