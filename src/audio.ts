/** Minimal WebAudio ping/tick synth. Unlocked on first user gesture. */
let ctx: AudioContext | null = null
let master: GainNode | null = null

export function unlockAudio() {
  if (ctx) return
  ctx = new AudioContext()
  master = ctx.createGain()
  master.gain.value = 0.18
  master.connect(ctx.destination)
}

function tone(freq: number, dur: number, type: OscillatorType = 'sine', gain = 1) {
  if (!ctx || !master) return
  const t = ctx.currentTime
  const o = ctx.createOscillator()
  const g = ctx.createGain()
  o.type = type
  o.frequency.setValueAtTime(freq, t)
  g.gain.setValueAtTime(0, t)
  g.gain.linearRampToValueAtTime(gain, t + 0.005)
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
  o.connect(g).connect(master)
  o.start(t)
  o.stop(t + dur + 0.02)
}

export const sfx = {
  /** Sweep passes a blip. */
  blip: () => tone(880, 0.12, 'sine', 0.6),
  /** New dispatch arrives. */
  dispatch: () => { tone(523, 0.18, 'triangle', 0.5); setTimeout(() => tone(784, 0.25, 'triangle', 0.4), 90) },
  /** Fork / replication. */
  fork: () => { tone(660, 0.1, 'square', 0.25); setTimeout(() => tone(990, 0.16, 'square', 0.2), 70) },
  /** Raid / alarm. */
  alarm: () => { tone(220, 0.3, 'sawtooth', 0.35); setTimeout(() => tone(196, 0.35, 'sawtooth', 0.3), 120) },
  /** Colony went dark. */
  dark: () => tone(140, 0.6, 'sine', 0.5),
  /** UI click. */
  click: () => tone(1200, 0.04, 'square', 0.15),
}
