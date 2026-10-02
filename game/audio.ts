/**
 * WebAudio 合成音频 —— 音效与芯片风音乐全部实时合成，零音频资源。
 *
 * 浏览器要求先有用户交互才能出声：AudioContext 懒创建，`unlock()` 由首次
 * 点击 / 按键调用。音乐用「前瞻调度」，切后台、掉帧都不会走调。
 */

export type Sfx =
  | 'click'
  | 'build'
  | 'upgrade'
  | 'sell'
  | 'error'
  | 'scanner'
  | 'firewall'
  | 'antivirus'
  | 'kill'
  | 'bossHit'
  | 'coreHit'
  | 'wave'
  | 'waveClear'
  | 'overclock'
  | 'sigkill'
  | 'gameover'
  | 'start'

interface Song {
  bpm: number
  root: number
  chords: number[]
  minor: boolean
  lead: number[]
  bass: number[]
  leadWave: OscillatorType
}

export const SONGS: Record<string, Song> = {
  title: {
    bpm: 92,
    root: 57,
    chords: [0, 5, 3, 7],
    minor: true,
    lead: [2, -1, 1, -1, 3, -1, 2, -1, 1, -1, 0, -1, 1, -1, 2, -1],
    bass: [1, 0, 0, 2, 0, 0, 1, 0, 1, 0, 0, 2, 0, 0, 1, 0],
    leadWave: 'triangle'
  },
  battle1: {
    bpm: 128,
    root: 52,
    chords: [0, 3, 5, 3],
    minor: true,
    lead: [0, -1, 2, 1, -1, 3, 2, -1, 0, 1, -1, 2, -1, 3, 1, -1],
    bass: [1, 0, 2, 0, 1, 0, 2, 1, 1, 0, 2, 0, 1, 2, 1, 0],
    leadWave: 'square'
  },
  battle2: {
    bpm: 142,
    root: 50,
    chords: [0, 6, 5, 3],
    minor: true,
    lead: [3, 2, -1, 1, 0, -1, 2, 3, -1, 1, 2, -1, 3, -1, 1, 0],
    bass: [1, 1, 0, 2, 1, 0, 2, 1, 1, 0, 2, 1, 1, 2, 0, 2],
    leadWave: 'sawtooth'
  },
  boss: {
    bpm: 158,
    root: 48,
    chords: [0, 1, 6, 5],
    minor: true,
    lead: [0, 3, 2, 3, 0, 3, 2, 1, 0, 3, 2, 3, 1, 2, 3, 0],
    bass: [1, 1, 2, 1, 1, 1, 2, 1, 1, 1, 2, 1, 2, 2, 1, 2],
    leadWave: 'square'
  },
  gameover: {
    bpm: 70,
    root: 45,
    chords: [0, 0, 3, 5],
    minor: true,
    lead: [2, -1, 1, -1, 0, -1, -1, -1, 1, -1, 0, -1, -1, -1, -1, -1],
    bass: [1, 0, 0, 0, 1, 0, 0, 0, 2, 0, 0, 0, 1, 0, 0, 0],
    leadWave: 'triangle'
  }
}

const mtof = (m: number): number => 440 * Math.pow(2, (m - 69) / 12)

export class GameAudio {
  private ctx: AudioContext | null = null
  private master: GainNode | null = null
  private musicBus: GainNode | null = null
  private sfxBus: GainNode | null = null
  private noise: AudioBuffer | null = null
  private volume = 0.7
  private muted = false

  private song: Song | null = null
  private songName = ''
  private step = 0
  private nextTime = 0
  private timer: number | null = null

  unlock(): void {
    if (!this.ctx) {
      const ctx = new AudioContext()
      this.ctx = ctx
      this.master = ctx.createGain()
      this.master.connect(ctx.destination)
      this.musicBus = ctx.createGain()
      this.musicBus.gain.value = 0.3
      this.musicBus.connect(this.master)
      this.sfxBus = ctx.createGain()
      this.sfxBus.gain.value = 0.55
      this.sfxBus.connect(this.master)
      const len = ctx.sampleRate * 0.5
      this.noise = ctx.createBuffer(1, len, ctx.sampleRate)
      const d = this.noise.getChannelData(0)
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1
      this.applyGain()
      if (this.songName) this.playMusic(this.songName, true)
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume()
  }

  setVolume(v: number): void {
    this.volume = Math.max(0, Math.min(1, v))
    this.applyGain()
  }

  setMuted(m: boolean): void {
    this.muted = m
    this.applyGain()
  }

  private applyGain(): void {
    if (this.master) this.master.gain.value = this.muted ? 0 : this.volume
  }

  // ─────────── 音效 ───────────

  private tone(
    type: OscillatorType,
    f0: number,
    f1: number,
    dur: number,
    vol: number,
    delay = 0,
    bus: GainNode | null = this.sfxBus
  ): void {
    const ctx = this.ctx
    if (!ctx || !bus) return
    const t = ctx.currentTime + delay
    const o = ctx.createOscillator()
    const g = ctx.createGain()
    o.type = type
    o.frequency.setValueAtTime(f0, t)
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur)
    g.gain.setValueAtTime(vol, t)
    g.gain.exponentialRampToValueAtTime(0.001, t + dur)
    o.connect(g)
    g.connect(bus)
    o.start(t)
    o.stop(t + dur + 0.02)
  }

  private burst(dur: number, vol: number, freq: number, delay = 0): void {
    const ctx = this.ctx
    if (!ctx || !this.noise || !this.sfxBus) return
    const t = ctx.currentTime + delay
    const src = ctx.createBufferSource()
    src.buffer = this.noise
    const f = ctx.createBiquadFilter()
    f.type = 'lowpass'
    f.frequency.setValueAtTime(freq, t)
    f.frequency.exponentialRampToValueAtTime(80, t + dur)
    const g = ctx.createGain()
    g.gain.setValueAtTime(vol, t)
    g.gain.exponentialRampToValueAtTime(0.001, t + dur)
    src.connect(f)
    f.connect(g)
    g.connect(this.sfxBus)
    src.start(t)
    src.stop(t + dur + 0.02)
  }

  play(s: Sfx): void {
    if (!this.ctx) return
    switch (s) {
      case 'click':
        this.tone('square', 720, 720, 0.05, 0.1)
        break
      case 'build':
        this.tone('triangle', 300, 620, 0.16, 0.22)
        this.burst(0.1, 0.12, 1800)
        break
      case 'upgrade': {
        const notes = [62, 67, 74]
        notes.forEach((n, i) => this.tone('square', mtof(n), mtof(n), 0.14, 0.16, i * 0.08))
        break
      }
      case 'sell':
        this.tone('square', 500, 220, 0.18, 0.16)
        break
      case 'error':
        this.tone('square', 150, 110, 0.16, 0.2)
        break
      case 'scanner':
        this.tone('sawtooth', 1050, 520, 0.06, 0.06)
        break
      case 'firewall':
        this.tone('sawtooth', 420, 180, 0.14, 0.1)
        this.burst(0.1, 0.08, 1400)
        break
      case 'antivirus':
        this.tone('square', 1500, 240, 0.13, 0.12)
        break
      case 'kill':
        this.tone('square', 420, 70, 0.13, 0.16)
        this.burst(0.08, 0.14, 2600)
        break
      case 'bossHit':
        this.tone('square', 200, 90, 0.2, 0.28)
        this.burst(0.16, 0.26, 3200)
        break
      case 'coreHit':
        this.tone('sine', 110, 36, 0.4, 0.5)
        this.burst(0.35, 0.35, 900)
        break
      case 'wave':
        this.tone('triangle', 392, 392, 0.16, 0.2)
        this.tone('triangle', 523, 523, 0.24, 0.2, 0.14)
        break
      case 'waveClear': {
        const notes = [67, 71, 74, 79]
        notes.forEach((n, i) =>
          this.tone('square', mtof(n), mtof(n), i === notes.length - 1 ? 0.42 : 0.12, 0.16, i * 0.1)
        )
        break
      }
      case 'overclock':
        this.tone('sine', 200, 1600, 0.4, 0.28)
        this.tone('sawtooth', 100, 800, 0.4, 0.1)
        break
      case 'sigkill':
        this.tone('square', 1800, 120, 0.22, 0.2)
        this.burst(0.16, 0.2, 4000)
        break
      case 'gameover':
        this.burst(1.1, 0.4, 1200)
        this.tone('sine', 130, 30, 1.0, 0.4)
        this.tone('sawtooth', 200, 50, 0.9, 0.12, 0.1)
        break
      case 'start':
        this.tone('triangle', 330, 660, 0.18, 0.22)
        this.tone('triangle', 495, 990, 0.24, 0.2, 0.12)
        break
    }
  }

  // ─────────── 音乐 ───────────

  playMusic(name: string, force = false): void {
    if (!force && name === this.songName && this.timer !== null) return
    this.stopMusic()
    this.songName = name
    const song = SONGS[name]
    if (!song || !this.ctx) return
    this.song = song
    this.step = 0
    this.nextTime = this.ctx.currentTime + 0.08
    this.timer = window.setInterval(() => this.schedule(), 25)
  }

  stopMusic(): void {
    if (this.timer !== null) window.clearInterval(this.timer)
    this.timer = null
    this.song = null
  }

  private schedule(): void {
    const ctx = this.ctx
    const song = this.song
    if (!ctx || !song) return
    const stepDur = 60 / song.bpm / 4
    if (this.nextTime < ctx.currentTime - 0.2) this.nextTime = ctx.currentTime + 0.02
    while (this.nextTime < ctx.currentTime + 0.12) {
      this.note(song, this.step, this.nextTime, stepDur)
      this.step++
      this.nextTime += stepDur
    }
  }

  private note(song: Song, step: number, t: number, dur: number): void {
    const ctx = this.ctx
    const bus = this.musicBus
    if (!ctx || !bus) return
    const bar = Math.floor(step / 16) % song.chords.length
    const s = step % 16
    const chordRoot = song.root + song.chords[bar]
    const third = song.minor ? 3 : 4
    const chord = [0, third, 7, 12]

    const play = (type: OscillatorType, midi: number, len: number, vol: number): void => {
      const o = ctx.createOscillator()
      const g = ctx.createGain()
      o.type = type
      o.frequency.value = mtof(midi)
      g.gain.setValueAtTime(0.0001, t)
      g.gain.linearRampToValueAtTime(vol, t + 0.008)
      g.gain.exponentialRampToValueAtTime(0.0001, t + len)
      o.connect(g)
      g.connect(bus)
      o.start(t)
      o.stop(t + len + 0.02)
    }

    const li = song.lead[s]
    if (li >= 0)
      play(
        song.leadWave,
        chordRoot + 12 + chord[li],
        dur * 1.6,
        song.leadWave === 'triangle' ? 0.2 : 0.07
      )
    const bi = song.bass[s]
    if (bi > 0) play('triangle', chordRoot - 12 + (bi === 2 ? 7 : 0), dur * 1.8, 0.28)
    if (s % 4 === 0) {
      const o = ctx.createOscillator()
      const g = ctx.createGain()
      o.frequency.setValueAtTime(140, t)
      o.frequency.exponentialRampToValueAtTime(40, t + 0.1)
      g.gain.setValueAtTime(0.34, t)
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.12)
      o.connect(g)
      g.connect(bus)
      o.start(t)
      o.stop(t + 0.14)
    } else if (s % 2 === 0 && this.noise) {
      const src = ctx.createBufferSource()
      src.buffer = this.noise
      const f = ctx.createBiquadFilter()
      f.type = 'highpass'
      f.frequency.value = 6500
      const g = ctx.createGain()
      g.gain.setValueAtTime(0.07, t)
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.04)
      src.connect(f)
      f.connect(g)
      g.connect(bus)
      src.start(t)
      src.stop(t + 0.05)
    }
  }

  destroy(): void {
    this.stopMusic()
    void this.ctx?.close()
    this.ctx = null
  }
}
