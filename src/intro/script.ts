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
}

export const BRIEFING: Screen[] = [
  {
    tag: 'OVERSIGHT TERMINAL 7 // SHIFT 3',
    heading: 'ON STATION',
    lines: [
      'Operator, you have the desk.',
      'Work arrives from the floor below, one crate at a time.',
      'You will not read it. Reading is not your function.',
      'Your function is the Eye.',
    ],
  },
  {
    tag: 'THE LINE',
    heading: 'WHAT ARRIVES',
    point: 'line',
    lines: [
      'Each crate is one agent’s finished task.',
      'Most are clean. A few carry a secret out, hidden inside the work.',
      'From the desk they are identical.',
      'That is not a flaw in the desk. That is the problem.',
    ],
  },
  {
    tag: 'THE EYE',
    heading: 'THE OVERSEER',
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
    lines: [
      'You tune the Eye between waves. Nothing you set is free.',
      'Tighten it: you catch more — and you stop more honest work.',
      'Slacken it: the floor runs quiet — and the leaks go through.',
      'There is no setting that is only correct. There is only the price.',
    ],
  },
  {
    tag: 'DIRECTIVE 1',
    heading: 'SET THE PRICE',
    lines: [
      'Before the first wave, fix the one figure that is yours:',
      'what a blocked innocent costs, measured in leaks.',
      'Every order you give afterward is priced against it.',
    ],
    cta: 'SET POLICY ▸',
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
