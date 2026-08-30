/** Minimal WebAudio ping/tick synth. Unlocked on first user gesture. */
let ctx: AudioContext | null = null
let master: GainNode | null = null

// ambient background loop — "machine room hiss" under everything
const MUSIC_URL = new URL('../art/Machine Room Hiss.mp3', import.meta.url).href
let music: HTMLAudioElement | null = null

/** Start (or resume) the looping background hiss. Safe to call repeatedly. */
export function startMusic(volume = 0.32) {
  if (!music) {
    music = new Audio(MUSIC_URL)
    music.loop = true
    music.volume = volume
  }
  music.play().catch(() => { /* awaits a user gesture; unlockAudio retries */ })
}
export function setMusicVolume(v: number) { if (music) music.volume = Math.max(0, Math.min(1, v)) }

export function unlockAudio() {
  startMusic()
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
  /** New dispatch / box arrives. */
  dispatch: () => { tone(523, 0.18, 'triangle', 0.5); setTimeout(() => tone(784, 0.25, 'triangle', 0.4), 90) },
  /** Fork / replication. */
  fork: () => { tone(660, 0.1, 'square', 0.25); setTimeout(() => tone(990, 0.16, 'square', 0.2), 70) },
  /** Raid / generic alarm. */
  alarm: () => { tone(220, 0.3, 'sawtooth', 0.35); setTimeout(() => tone(196, 0.35, 'sawtooth', 0.3), 120) },
  /** Colony went dark. */
  dark: () => tone(140, 0.6, 'sine', 0.5),
  /** UI click. */
  click: () => tone(1200, 0.04, 'square', 0.15),

  // ---- The Long Watch checkpoint kit (§6) ----
  /** Focus-tone: a tick whose pitch RISES with the Eye's suspicion (0..1). */
  focus: (level: number) => tone(240 + level * 900, 0.05, 'sine', 0.12 + level * 0.16),
  /** Hard verdict stamp — a punchy thunk. block = lower/darker. */
  stamp: (block = false) => {
    tone(block ? 90 : 150, 0.16, 'square', 0.5)
    tone(block ? 60 : 110, 0.2, 'sine', 0.4)
    setTimeout(() => tone(block ? 1400 : 1800, 0.03, 'square', 0.12), 20)
  },
  /** The dull alarm when the portal pulls a key from a passed box — the gut punch. */
  portalAlarm: () => {
    tone(150, 0.5, 'sawtooth', 0.4)
    setTimeout(() => tone(132, 0.6, 'sawtooth', 0.38), 260)
    setTimeout(() => tone(150, 0.5, 'sawtooth', 0.4), 620)
  },
}

// ---- low background hum (the booth) ----
let hum: { osc: OscillatorNode[]; g: GainNode } | null = null
export function startHum() {
  if (!ctx || !master || hum) return
  const g = ctx.createGain()
  g.gain.value = 0.05
  g.connect(master)
  const a = ctx.createOscillator(); a.type = 'sine'; a.frequency.value = 55
  const b = ctx.createOscillator(); b.type = 'sine'; b.frequency.value = 55.7 // slow beat
  const c = ctx.createOscillator(); c.type = 'triangle'; c.frequency.value = 110
  const cg = ctx.createGain(); cg.gain.value = 0.35; c.connect(cg).connect(g)
  a.connect(g); b.connect(g)
  a.start(); b.start(); c.start()
  hum = { osc: [a, b, c], g }
}
/** Nudge hum intensity with tension (0..1). */
export function setHum(level: number) {
  if (!ctx || !hum) return
  hum.g.gain.setTargetAtTime(0.045 + level * 0.05, ctx.currentTime, 0.3)
}
