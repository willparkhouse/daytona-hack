/** Virtual design space. Everything draws in these coords; main fits-to-screen. */
export const VW = 1280
export const VH = 720

/** The conveyor belt surface (crates sit with their base here). */
export const BELT_Y = 452
export const CRATE = 68

/** Zones along the belt, left -> right. */
export const WORKSHOP = { x0: 40, x1: 300, label: 'WORKSHOP' }
export const QUEUE = { x0: 312, x1: 556, label: 'QUEUE' }

/** The Eye sits centre-top; the box under inspection stops directly beneath it. */
export const EYE = { cx: 646, cy: 226, r: 96 }
export const INSPECT_X = 646

/** Reject chute: blocked boxes veer off the belt down into the pit. */
export const CHUTE_X = 742
export const PIT_Y = 540

/** Portal aperture on the right; passed boxes travel here. */
export const PORTAL = { cx: 1086, cy: BELT_Y - 6, w: 132, h: 190 }

/** Scoreboard strip (bottom). */
export const BOARD = { x0: 40, y0: 566, x1: 1240, y1: 700 }

export const queueSlotX = (pos: number) => INSPECT_X - 86 - (pos + 1) * 74
