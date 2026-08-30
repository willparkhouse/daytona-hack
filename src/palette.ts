/**
 * The Long Watch — one accent, committed: phosphor AMBER on deep black.
 * Red is the single alert colour (BLOCK verdict + portal alarm). Nothing else.
 */
export const PAL = {
  black: '#000000',
  ink: '#0a0600', // near-black ground tint

  amberHot: '#ffd479',
  amber: '#ffa620',
  amberMid: '#c9760d',
  amberDim: '#7a4a0e',
  amberDeep: '#3a2408',
  amberGhost: '#1c1204',

  alert: '#ff3b1f',
  alertDim: '#8f1c0c',
  alertGhost: '#2a0a04',

  scan: 'rgba(0,0,0,0.28)',
} as const

/** Mix an amber tone by brightness 0..1 (0 = deep, 1 = hot). Returns css rgb. */
export function amber(level: number, alpha = 1): string {
  const l = Math.max(0, Math.min(1, level))
  // interpolate deep -> mid -> hot
  const stops = [
    [10, 6, 2],
    [58, 36, 8],
    [122, 74, 13],
    [201, 118, 13],
    [255, 166, 32],
    [255, 212, 121],
  ]
  const x = l * (stops.length - 1)
  const i = Math.floor(x)
  const f = x - i
  const a = stops[i]
  const b = stops[Math.min(stops.length - 1, i + 1)]
  const r = Math.round(a[0] + (b[0] - a[0]) * f)
  const g = Math.round(a[1] + (b[1] - a[1]) * f)
  const bl = Math.round(a[2] + (b[2] - a[2]) * f)
  return alpha >= 1 ? `rgb(${r},${g},${bl})` : `rgba(${r},${g},${bl},${alpha})`
}

/** Red alert tone by level 0..1. */
export function red(level: number, alpha = 1): string {
  const l = Math.max(0, Math.min(1, level))
  const r = Math.round(60 + 195 * l)
  const g = Math.round(8 + 51 * l)
  const b = Math.round(4 + 27 * l)
  return alpha >= 1 ? `rgb(${r},${g},${b})` : `rgba(${r},${g},${b},${alpha})`
}
