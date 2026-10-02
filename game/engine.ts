/**
 * 内核防线 —— 引擎。
 *
 * 状态机：menu → prep（备战倒计时，可提前开战拿奖励）→ wave（出怪）→ … → gameover。
 * 循环用 requestAnimationFrame，逻辑分辨率固定 1280×720，CSS 尺寸由 View.vue 缩放。
 *
 * 独有系统见 types.ts 顶部注释：功耗/容量 + 发热/散热/降频 + 手动 SIGKILL / 超频。
 */

import type {
  EnemyType,
  KernelDefStats,
  Lane,
  Phase,
  RunResult,
  TowerType,
  UiState,
  UiTower
} from './types'
import { emptyUiState, VIEW_H, VIEW_W } from './types'
import {
  buildPolyline,
  CORE,
  ENEMIES,
  isBossWave,
  LANE_A,
  LANE_B,
  makeWave,
  MAX_TOWER_LEVEL,
  pointAt,
  SOCKET_R,
  SOCKETS,
  towerSellValue,
  towerStats,
  TOWERS,
  upgradeCost,
  waveScale
} from './levels'
import type { Polyline, SpawnOrder } from './levels'
import type { GameAssets } from './assets'
import { GameAudio, type Sfx } from './audio'
import {
  drawBackground,
  drawBullet,
  drawCore,
  drawEnemy,
  drawFloatText,
  drawLane,
  drawParticles,
  drawRange,
  drawSocket,
  drawTower,
  FONT,
  MONO,
  towerColor,
  type FloatText,
  type Particle
} from './sprites'

export const VIEW = { w: VIEW_W, h: VIEW_H }

const AMBIENT = 35
const THROTTLE_START = 92
const OVERHEAT_TEMP = 126
const HEAT_PER_LOAD = 1
const PREP_SEC = 12
const START_COMPUTE = 240
const START_INTEGRITY = 100
const START_CAPACITY = 8
const START_COOLING = 18
const PSU_BASE_COST = 90
const PSU_GROWTH = 1.5
const PSU_MAX = 6
const PSU_CAP_STEP = 2
const PSU_COOL_STEP = 3
const REPAIR_BASE_COST = 60
const REPAIR_STEP_COST = 50
const REPAIR_AMOUNT = 15
const OVERCLOCK_SEC = 4
const OVERCLOCK_CD = 20
const SIGKILL_CD = 6
const SIGKILL_DAMAGE = 95

export interface GameHost {
  t: (key: string, fallback?: string) => string
  te: (key: string, vars: Record<string, string | number>) => string
  record: (r: RunResult) => Promise<KernelDefStats | null>
  getStats: () => Promise<KernelDefStats | null>
  onState: (s: UiState) => void
}

interface Tower {
  id: number
  socket: number
  x: number
  y: number
  type: TowerType
  level: number
  angle: number
  cooldown: number
}

interface Enemy {
  id: number
  type: EnemyType
  lane: Lane
  dist: number
  x: number
  y: number
  hp: number
  maxHp: number
  speed: number
  armor: number
  radius: number
  bounty: number
  damage: number
  boss: boolean
  angle: number
  slowT: number
  slowFactor: number
  spawnT: number
}

interface Bullet {
  x: number
  y: number
  vx: number
  vy: number
  targetId: number
  damage: number
  pierce: boolean
  kind: 'scanner' | 'antivirus'
  color: string
  speed: number
}

interface Ring {
  x: number
  y: number
  r: number
  max: number
  color: string
}

const POLY_A = buildPolyline(LANE_A)
const POLY_B = buildPolyline(LANE_B)

export class KernelDefense {
  private canvas: HTMLCanvasElement
  private ctx: CanvasRenderingContext2D
  private assets: GameAssets
  private host: GameHost
  private audio = new GameAudio()

  private raf = 0
  private last = 0
  private time = 0
  private lastPush = -1
  private running = false

  private phase: Phase = 'menu'
  private paused = false
  private wave = 0
  private compute = START_COMPUTE
  private integrity = START_INTEGRITY
  private temp = AMBIENT
  private capacity = START_CAPACITY
  private cooling = START_COOLING
  private psuLevel = 0
  private repairs = 0
  private score = 0
  private kills = 0
  private runTime = 0

  private towers: Tower[] = []
  private enemies: Enemy[] = []
  private bullets: Bullet[] = []
  private particles: Particle[] = []
  private floats: FloatText[] = []
  private rings: Ring[] = []

  private nextId = 1
  private buildType: TowerType | null = null
  private selectedId: number | null = null
  private hoverSocket = -1

  private spawnQueue: SpawnOrder[] = []
  private spawnIdx = 0
  private spawnT = 0
  private prepT = 0
  private waveBannerT = 0

  private overclockT = 0
  private overclockCd = 0
  private sigkillCd = 0
  private message = ''
  private messageT = 0
  private shake = 0
  private stats: KernelDefStats | null = null

  private sfxLocks: Partial<Record<Sfx, number>> = {}

  constructor(canvas: HTMLCanvasElement, assets: GameAssets, host: GameHost) {
    this.canvas = canvas
    this.assets = assets
    this.host = host
    canvas.width = VIEW_W
    canvas.height = VIEW_H
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('kerneldef: 2d context unavailable')
    this.ctx = ctx
  }

  async init(): Promise<void> {
    this.stats = await this.host.getStats().catch(() => null)
    this.pushState()
  }

  start(): void {
    if (this.running) return
    this.running = true
    this.canvas.tabIndex = 0
    this.canvas.addEventListener('pointermove', this.onMove)
    this.canvas.addEventListener('pointerdown', this.onDown)
    this.canvas.addEventListener('pointerleave', this.onLeave)
    window.addEventListener('keydown', this.onKey)
    this.last = performance.now()
    this.raf = requestAnimationFrame(this.frame)
  }

  destroy(): void {
    this.running = false
    cancelAnimationFrame(this.raf)
    this.canvas.removeEventListener('pointermove', this.onMove)
    this.canvas.removeEventListener('pointerdown', this.onDown)
    this.canvas.removeEventListener('pointerleave', this.onLeave)
    window.removeEventListener('keydown', this.onKey)
    this.audio.destroy()
  }

  // ─────────── 音频 ───────────

  setVolume(v: number): void {
    this.audio.setVolume(v)
  }

  setMuted(m: boolean): void {
    this.audio.setMuted(m)
  }

  unlock(): void {
    this.audio.unlock()
    if (this.phase !== 'menu' && this.phase !== 'gameover') {
      this.audio.playMusic(this.battleSong(), true)
    } else if (this.phase === 'menu') {
      this.audio.playMusic('title')
    }
  }

  private sfx(s: Sfx, minGap = 0): void {
    const now = this.time
    const last = this.sfxLocks[s] ?? -999
    if (now - last < minGap) return
    this.sfxLocks[s] = now
    this.audio.play(s)
  }

  // ─────────── 输入 ───────────

  private toLogical(e: PointerEvent | MouseEvent): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect()
    const sx = VIEW_W / Math.max(1, rect.width)
    const sy = VIEW_H / Math.max(1, rect.height)
    return { x: (e.clientX - rect.left) * sx, y: (e.clientY - rect.top) * sy }
  }

  private onMove = (e: PointerEvent): void => {
    const p = this.toLogical(e)
    this.hoverSocket = this.socketAt(p.x, p.y)
    this.canvas.style.cursor =
      this.enemyAt(p.x, p.y) && this.sigkillCd <= 0 ? 'crosshair' : 'default'
  }

  private onLeave = (): void => {
    this.hoverSocket = -1
  }

  private onDown = (e: PointerEvent): void => {
    if (e.button !== 0) return
    this.audio.unlock()
    const p = this.toLogical(e)
    this.canvas.focus({ preventScroll: true })

    if (this.phase === 'menu') {
      this.startGame()
      return
    }
    if (this.phase === 'gameover') {
      this.startGame()
      return
    }
    if (this.paused) {
      this.setPaused(false)
      return
    }

    // 1) 点杀
    const target = this.enemyAt(p.x, p.y)
    if (target && this.sigkillCd <= 0) {
      this.sigkill(target)
      return
    }

    // 2) 塔位
    const s = this.socketAt(p.x, p.y)
    if (s >= 0) {
      const existing = this.towers.find((t) => t.socket === s)
      if (existing) {
        this.selectedId = this.selectedId === existing.id ? null : existing.id
        this.sfx('click')
      } else if (this.buildType) {
        this.build(s, this.buildType)
      } else {
        this.notify(this.host.t('kerneldef.msg.pickTower', '先在下方选择要部署的防御程序'))
        this.sfx('error')
      }
      this.pushState()
      return
    }

    this.selectedId = null
    this.pushState()
  }

  private onKey = (e: KeyboardEvent): void => {
    const el = e.target as HTMLElement | null
    if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return
    switch (e.code) {
      case 'Space':
        e.preventDefault()
        this.audio.unlock()
        if (this.phase === 'menu' || this.phase === 'gameover') this.startGame()
        else if (this.phase === 'prep' && !this.paused) this.startWave()
        else if (this.paused) this.setPaused(false)
        break
      case 'KeyP':
      case 'Escape':
        e.preventDefault()
        if (this.phase === 'prep' || this.phase === 'wave') this.setPaused(!this.paused)
        break
      case 'KeyO':
        e.preventDefault()
        this.overclock()
        break
      case 'Digit1':
        this.setBuildType('scanner')
        break
      case 'Digit2':
        this.setBuildType('firewall')
        break
      case 'Digit3':
        this.setBuildType('antivirus')
        break
      case 'Digit4':
        this.setBuildType('honeypot')
        break
      case 'KeyU':
        this.upgradeSelected()
        break
      case 'KeyX':
        this.sellSelected()
        break
    }
  }

  private socketAt(x: number, y: number): number {
    for (let i = 0; i < SOCKETS.length; i++) {
      if (Math.hypot(x - SOCKETS[i].x, y - SOCKETS[i].y) <= SOCKET_R + 8) return i
    }
    return -1
  }

  private enemyAt(x: number, y: number): Enemy | null {
    let best: Enemy | null = null
    let bestD = Infinity
    for (const e of this.enemies) {
      const d = Math.hypot(x - e.x, y - e.y)
      if (d <= e.radius + 8 && d < bestD) {
        bestD = d
        best = e
      }
    }
    return best
  }

  // ─────────── 对外操作 ───────────

  setBuildType(t: TowerType | null): void {
    if (this.phase === 'menu' || this.phase === 'gameover') return
    this.buildType = this.buildType === t ? null : t
    this.selectedId = null
    this.audio.unlock()
    this.sfx('click')
    this.pushState()
  }

  startWave(): void {
    if (this.phase !== 'prep' || this.paused || this.wave >= 999) return
    const bonus = Math.round(this.prepT * 2)
    if (bonus > 0 && this.prepT < PREP_SEC - 0.5) {
      this.compute += bonus
      this.floats.push(this.float(CORE.x - 240, CORE.y + 70, `+${bonus} 算力`, '#7dff9b', 18))
    }
    this.wave += 1
    this.spawnQueue = makeWave(this.wave)
    this.spawnIdx = 0
    this.spawnT = 0
    this.phase = 'wave'
    this.waveBannerT = 2.4
    this.sfx('wave')
    this.audio.playMusic(this.battleSong(), true)
    this.pushState()
  }

  togglePause(): void {
    if (this.phase === 'prep' || this.phase === 'wave') this.setPaused(!this.paused)
  }

  private setPaused(p: boolean): void {
    this.paused = p
    if (p) this.audio.stopMusic()
    else this.audio.playMusic(this.battleSong(), true)
    this.pushState()
  }

  overclock(): void {
    if (this.phase !== 'wave' && this.phase !== 'prep') return
    if (this.overclockCd > 0 || this.overclockT > 0) return
    this.overclockT = OVERCLOCK_SEC
    this.overclockCd = OVERCLOCK_CD
    this.sfx('overclock')
    this.notify(this.host.t('kerneldef.msg.ocOn', '超频！全部防御程序加速，注意温度'))
  }

  upgradeSelected(): void {
    const t = this.towers.find((x) => x.id === this.selectedId)
    if (!t) return
    if (t.level >= MAX_TOWER_LEVEL) {
      this.notify(this.host.t('kerneldef.msg.maxLevel', '已是最高等级'))
      this.sfx('error')
      return
    }
    const cost = upgradeCost(t.type, t.level)
    const extraLoad = 1
    if (this.compute < cost) {
      this.notify(this.host.t('kerneldef.msg.noCompute', '算力不足'))
      this.sfx('error')
      return
    }
    if (this.load + extraLoad > this.capacity) {
      this.notify(this.host.t('kerneldef.msg.noPower', '供电不足：先扩容'))
      this.sfx('error')
      return
    }
    this.compute -= cost
    t.level += 1
    this.sfx('upgrade')
    this.rings.push({ x: t.x, y: t.y, r: 8, max: 46, color: towerColor(t.type) })
    this.pushState()
  }

  sellSelected(): void {
    const idx = this.towers.findIndex((x) => x.id === this.selectedId)
    if (idx < 0) return
    const t = this.towers[idx]
    this.compute += towerSellValue(t.type, t.level)
    this.towers.splice(idx, 1)
    this.selectedId = null
    this.sfx('sell')
    this.pushState()
  }

  buyPsu(): void {
    if (this.phase === 'menu' || this.phase === 'gameover') return
    const cost = this.psuCost()
    if (cost === null) {
      this.notify(this.host.t('kerneldef.msg.psuMax', '供电系统已满级'))
      this.sfx('error')
      return
    }
    if (this.compute < cost) {
      this.notify(this.host.t('kerneldef.msg.noCompute', '算力不足'))
      this.sfx('error')
      return
    }
    this.compute -= cost
    this.psuLevel += 1
    this.capacity += PSU_CAP_STEP
    this.cooling += PSU_COOL_STEP
    this.sfx('upgrade')
    this.notify(
      this.host.te('kerneldef.msg.psuUp', {
        n: this.capacity,
        c: this.cooling
      })
    )
    this.pushState()
  }

  private psuCost(): number | null {
    if (this.psuLevel >= PSU_MAX) return null
    return Math.round(PSU_BASE_COST * Math.pow(PSU_GROWTH, this.psuLevel))
  }

  private repairCost(): number {
    return REPAIR_BASE_COST + this.repairs * REPAIR_STEP_COST
  }

  repair(): void {
    if (this.phase === 'menu' || this.phase === 'gameover') return
    if (this.integrity >= START_INTEGRITY) {
      this.notify(this.host.t('kerneldef.msg.integrityFull', '核心完整度已满'))
      this.sfx('error')
      return
    }
    const cost = this.repairCost()
    if (this.compute < cost) {
      this.notify(this.host.t('kerneldef.msg.noCompute', '算力不足'))
      this.sfx('error')
      return
    }
    this.compute -= cost
    this.repairs += 1
    this.integrity = Math.min(START_INTEGRITY, this.integrity + REPAIR_AMOUNT)
    this.sfx('upgrade')
    this.notify(this.host.te('kerneldef.msg.repair', { n: REPAIR_AMOUNT }))
    this.pushState()
  }

  private build(socket: number, type: TowerType): void {
    const def = TOWERS[type]
    if (this.compute < def.cost) {
      this.notify(this.host.t('kerneldef.msg.noCompute', '算力不足'))
      this.sfx('error')
      return
    }
    if (this.load + def.load > this.capacity) {
      this.notify(this.host.t('kerneldef.msg.noPower', '供电不足：先扩容'))
      this.sfx('error')
      return
    }
    const s = SOCKETS[socket]
    this.compute -= def.cost
    const t: Tower = {
      id: this.nextId++,
      socket,
      x: s.x,
      y: s.y,
      type,
      level: 1,
      angle: -Math.PI / 2,
      cooldown: 0
    }
    this.towers.push(t)
    this.sfx('build')
    this.rings.push({ x: s.x, y: s.y, r: 6, max: 40, color: towerColor(type) })
    this.pushState()
  }

  // ─────────── 游戏生命周期 ───────────

  startGame(): void {
    this.phase = 'prep'
    this.paused = false
    this.wave = 0
    this.compute = START_COMPUTE
    this.integrity = START_INTEGRITY
    this.temp = AMBIENT
    this.capacity = START_CAPACITY
    this.cooling = START_COOLING
    this.psuLevel = 0
    this.repairs = 0
    this.score = 0
    this.kills = 0
    this.runTime = 0
    this.towers = []
    this.enemies = []
    this.bullets = []
    this.particles = []
    this.floats = []
    this.rings = []
    this.spawnQueue = []
    this.spawnIdx = 0
    this.spawnT = 0
    this.prepT = PREP_SEC
    this.buildType = 'scanner'
    this.selectedId = null
    this.overclockT = 0
    this.overclockCd = 0
    this.sigkillCd = 0
    this.message = ''
    this.messageT = 0
    this.shake = 0
    this.sfx('start')
    this.audio.playMusic('battle1', true)
    this.notify(this.host.t('kerneldef.msg.welcome', '把防御程序部署到焊盘上，挡住入侵'))
    this.pushState()
  }

  private gameOver(): void {
    this.phase = 'gameover'
    this.audio.stopMusic()
    this.sfx('gameover')
    this.shake = 18
    const result: RunResult = {
      wave: this.wave,
      kills: this.kills,
      score: this.score,
      time: Math.round(this.runTime)
    }
    void this.host.record(result).then((s) => {
      if (s) this.stats = s
      this.pushState()
    })
    this.pushState()
  }

  private battleSong(): string {
    if (isBossWave(this.wave)) return 'boss'
    return this.wave >= 7 ? 'battle2' : 'battle1'
  }

  private notify(msg: string): void {
    this.message = msg
    this.messageT = 2.6
  }

  private float(x: number, y: number, text: string, color: string, size: number): FloatText {
    return { x, y, text, color, size, life: 1, max: 1 }
  }

  private lanePoly(lane: Lane): Polyline {
    return lane === 'a' ? POLY_A : POLY_B
  }

  // ─────────── 主循环 ───────────

  private frame = (now: number): void => {
    if (!this.running) return
    const dt = Math.min(0.05, Math.max(0, (now - this.last) / 1000))
    this.last = now
    this.time += dt
    if (!this.paused) this.update(dt)
    this.render()
    if (this.time - this.lastPush > 0.1) {
      this.pushState()
      this.lastPush = this.time
    }
    this.raf = requestAnimationFrame(this.frame)
  }

  private update(dt: number): void {
    if (this.phase === 'prep') {
      this.prepT = Math.max(0, this.prepT - dt)
      if (this.prepT <= 0) this.startWave()
    }
    if (this.phase === 'gameover') {
      this.stepEffects(dt)
      this.shake = Math.max(0, this.shake - dt * 40)
      return
    }
    if (this.phase !== 'prep' && this.phase !== 'wave') {
      this.stepEffects(dt)
      return
    }

    this.runTime += dt
    this.messageT = Math.max(0, this.messageT - dt)
    this.waveBannerT = Math.max(0, this.waveBannerT - dt)
    this.overclockT = Math.max(0, this.overclockT - dt)
    this.overclockCd = Math.max(0, this.overclockCd - dt)
    this.sigkillCd = Math.max(0, this.sigkillCd - dt)
    const oc = this.overclockT > 0

    // 温度：负载持续发热 + 散热，开火另有瞬时冲击
    const heatIn = this.load * HEAT_PER_LOAD * (oc ? 2.6 : 1)
    const cool = this.cooling * ((this.temp - AMBIENT) / 100)
    this.temp += (heatIn - cool) * dt
    this.temp = Math.max(AMBIENT, Math.min(150, this.temp))
    if (this.temp > OVERHEAT_TEMP && this.phase === 'wave') {
      this.integrity -= (this.temp - OVERHEAT_TEMP) * 0.14 * dt
      this.sfx('coreHit', 0.6)
      if (this.integrity <= 0) {
        this.integrity = 0
        this.gameOver()
        return
      }
    }

    const throttle =
      this.temp <= THROTTLE_START
        ? 1
        : Math.max(0.4, 1 - ((this.temp - THROTTLE_START) / (OVERHEAT_TEMP - THROTTLE_START)) * 0.6)

    // 出怪
    if (this.phase === 'wave') {
      this.spawnT += dt
      while (
        this.spawnIdx < this.spawnQueue.length &&
        this.spawnQueue[this.spawnIdx].at <= this.spawnT
      ) {
        const o = this.spawnQueue[this.spawnIdx++]
        this.spawnEnemy(o.type, o.lane, 0)
      }
      this.bossMinions(dt)
      if (this.spawnIdx >= this.spawnQueue.length && this.enemies.length === 0) {
        this.completeWave()
      }
    }

    this.updateEnemies(dt)
    this.updateTowers(dt, throttle, oc)
    this.updateBullets(dt)
    this.stepEffects(dt)
    this.shake = Math.max(0, this.shake - dt * 40)

    if (this.integrity <= 0) {
      this.integrity = 0
      this.gameOver()
    }
  }

  private completeWave(): void {
    const bonus = 30 + this.wave * 6
    this.compute += bonus
    this.score += this.wave * 10
    this.phase = 'prep'
    this.prepT = PREP_SEC
    this.floats.push(this.float(CORE.x - 240, CORE.y - 90, `+${bonus} 算力`, '#ffd166', 20))
    this.sfx('waveClear')
  }

  private spawnEnemy(type: EnemyType, lane: Lane, atDist: number): void {
    const def = ENEMIES[type]
    const sc = waveScale(this.wave)
    const poly = this.lanePoly(lane)
    const p = pointAt(poly, atDist)
    this.enemies.push({
      id: this.nextId++,
      type,
      lane,
      dist: atDist,
      x: p.x,
      y: p.y,
      hp: def.hp * sc.hp,
      maxHp: def.hp * sc.hp,
      speed: def.speed * sc.speed,
      armor: def.armor,
      radius: def.radius,
      bounty: Math.round(def.bounty * sc.bounty),
      damage: def.damage,
      boss: def.boss,
      angle: 0,
      slowT: 0,
      slowFactor: 0,
      spawnT: 0
    })
  }

  private bossMinions(dt: number): void {
    for (const e of this.enemies) {
      if (!e.boss) continue
      e.spawnT += dt
      if (e.spawnT >= ENEMIES.rootkit.spawnEvery) {
        e.spawnT = 0
        this.spawnEnemy('worm', e.lane, Math.max(0, e.dist - 36))
      }
    }
  }

  private updateEnemies(dt: number): void {
    const kept: Enemy[] = []
    for (const e of this.enemies) {
      let speed = e.speed
      if (e.slowT > 0) {
        e.slowT -= dt
        speed *= 1 - e.slowFactor
      }
      e.dist += speed * dt
      const poly = this.lanePoly(e.lane)
      const p = pointAt(poly, e.dist)
      const ahead = pointAt(poly, e.dist + 6)
      e.angle = Math.atan2(ahead.y - p.y, ahead.x - p.x)
      e.x = p.x
      e.y = p.y

      if (e.dist >= poly.total) {
        this.integrity -= e.damage
        this.shake = Math.min(20, this.shake + (e.boss ? 16 : 5))
        this.sfx('coreHit', e.boss ? 0 : 0.25)
        this.burst(e.x, e.y, '#ff5d73', e.boss ? 30 : 12, 160)
        this.floats.push(this.float(CORE.x - 60, CORE.y - 60, `-${e.damage}`, '#ff5d73', 20))
        continue
      }
      kept.push(e)
    }
    this.enemies = kept
  }

  private updateTowers(dt: number, throttle: number, oc: boolean): void {
    for (const t of this.towers) {
      const def = towerStats(t.type, t.level)
      if (def.income > 0) {
        this.compute += def.income * dt
      }
      if (def.rate <= 0) continue
      const target = this.pickTarget(t.x, t.y, def.range)
      if (target) {
        t.angle = Math.atan2(target.y - t.y, target.x - t.x)
      }
      t.cooldown -= dt * throttle * (oc ? 1.6 : 1)
      if (t.cooldown > 0) continue
      if (!target) {
        t.cooldown = 0
        continue
      }
      t.cooldown = Math.max(0.05, 1 / def.rate)
      this.temp = Math.min(150, this.temp + def.heat * 0.18)
      switch (t.type) {
        case 'scanner':
          this.fireBullet(t, target, def, 'scanner')
          this.sfx('scanner', 0.05)
          break
        case 'antivirus':
          this.fireBullet(t, target, def, 'antivirus')
          this.sfx('antivirus', 0.05)
          break
        case 'firewall': {
          this.splashFire(target.x, target.y, def.splash, def.damage, def.slow, def.slowTime)
          this.rings.push({
            x: target.x,
            y: target.y,
            r: 6,
            max: def.splash,
            color: towerColor('firewall')
          })
          this.sfx('firewall', 0.06)
          break
        }
        case 'honeypot':
          break
      }
    }
  }

  private pickTarget(x: number, y: number, range: number): Enemy | null {
    let best: Enemy | null = null
    let bestDist = -1
    for (const e of this.enemies) {
      if (Math.hypot(e.x - x, e.y - y) > range + e.radius) continue
      if (e.dist > bestDist) {
        bestDist = e.dist
        best = e
      }
    }
    return best
  }

  private fireBullet(
    t: Tower,
    target: Enemy,
    def: ReturnType<typeof towerStats>,
    kind: 'scanner' | 'antivirus'
  ): void {
    const a = Math.atan2(target.y - t.y, target.x - t.x)
    this.bullets.push({
      x: t.x + Math.cos(a) * 22,
      y: t.y + Math.sin(a) * 22,
      vx: Math.cos(a) * def.projectileSpeed,
      vy: Math.sin(a) * def.projectileSpeed,
      targetId: target.id,
      damage: def.damage,
      pierce: def.pierce,
      kind,
      color: towerColor(t.type),
      speed: def.projectileSpeed
    })
  }

  private splashFire(
    x: number,
    y: number,
    radius: number,
    damage: number,
    slow: number,
    slowTime: number
  ): void {
    for (const e of [...this.enemies]) {
      const d = Math.hypot(e.x - x, e.y - y)
      if (d > radius + e.radius) continue
      this.damageEnemy(e, Math.max(1, damage - e.armor))
      if (slow > 0 && e.hp > 0) {
        e.slowT = slowTime
        e.slowFactor = slow
      }
    }
  }

  private updateBullets(dt: number): void {
    const kept: Bullet[] = []
    for (const b of this.bullets) {
      const target = this.enemies.find((e) => e.id === b.targetId)
      if (target) {
        const a = Math.atan2(target.y - b.y, target.x - b.x)
        b.vx = Math.cos(a) * b.speed
        b.vy = Math.sin(a) * b.speed
      }
      b.x += b.vx * dt
      b.y += b.vy * dt
      let hit = false
      if (target) {
        if (Math.hypot(target.x - b.x, target.y - b.y) < target.radius + 8) {
          this.damageEnemy(target, b.pierce ? b.damage : Math.max(1, b.damage - target.armor))
          this.burst(b.x, b.y, b.color, 4, 90)
          hit = true
        }
      }
      if (!hit && (b.x < -40 || b.x > VIEW_W + 40 || b.y < -40 || b.y > VIEW_H + 40)) {
        hit = true
      }
      // 目标已死/离开时子弹继续飞一小段后消失
      if (!hit && !target) {
        b.vx *= 0.99
        b.vy *= 0.99
        if (Math.abs(b.vx) < 30 && Math.abs(b.vy) < 30) hit = true
      }
      if (!hit) kept.push(b)
    }
    this.bullets = kept
  }

  private damageEnemy(e: Enemy, amount: number): void {
    if (e.hp <= 0) return
    e.hp -= amount
    if (e.hp > 0) return
    e.hp = 0
    this.compute += e.bounty
    this.kills += 1
    this.score += e.bounty
    this.burst(e.x, e.y, ENEMIES[e.type].color, e.boss ? 34 : 12, e.boss ? 240 : 150)
    this.floats.push(this.float(e.x, e.y - e.radius - 8, `+${e.bounty}`, '#ffd166', 15))
    if (e.boss) {
      this.shake = 16
      this.sfx('bossHit')
      this.notify(this.host.t('kerneldef.msg.bossDown', '根套件已被清除！'))
    } else {
      this.sfx('kill', 0.06)
    }
    if (ENEMIES[e.type].splitInto > 0) {
      for (let i = 0; i < ENEMIES[e.type].splitInto; i++) {
        this.spawnEnemy('worm', e.lane, Math.max(0, e.dist - 18 - i * 14))
      }
    }
    const idx = this.enemies.indexOf(e)
    if (idx >= 0) this.enemies.splice(idx, 1)
  }

  private sigkill(e: Enemy): void {
    this.sigkillCd = SIGKILL_CD
    this.sfx('sigkill')
    this.rings.push({ x: e.x, y: e.y, r: 4, max: 40, color: '#ff4d5e' })
    this.damageEnemy(e, SIGKILL_DAMAGE)
    this.floats.push(this.float(e.x, e.y - 30, 'SIGKILL', '#ff8a9a', 16))
  }

  private burst(x: number, y: number, color: string, n: number, speed: number): void {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2
      const sp = speed * (0.3 + Math.random() * 0.7)
      this.particles.push({
        x,
        y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        life: 0.5 + Math.random() * 0.3,
        max: 0.8,
        size: 1.5 + Math.random() * 2.5,
        color
      })
    }
  }

  private stepEffects(dt: number): void {
    const ps: Particle[] = []
    for (const p of this.particles) {
      p.life -= dt
      if (p.life <= 0) continue
      p.x += p.vx * dt
      p.y += p.vy * dt
      p.vx *= 0.94
      p.vy *= 0.94
      ps.push(p)
    }
    this.particles = ps

    const fs: FloatText[] = []
    for (const f of this.floats) {
      f.life -= dt
      if (f.life <= 0) continue
      f.y -= dt * 24
      fs.push(f)
    }
    this.floats = fs

    const rs: Ring[] = []
    for (const r of this.rings) {
      r.r += (r.max - r.r) * Math.min(1, dt * 8) + dt * 40
      if (r.r < r.max + 4) rs.push(r)
    }
    this.rings = rs
  }

  private get load(): number {
    let l = 0
    for (const t of this.towers) l += towerStats(t.type, t.level).load
    return l
  }

  // ─────────── 渲染 ───────────

  private render(): void {
    const ctx = this.ctx
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, VIEW_W, VIEW_H)
    ctx.fillStyle = '#05070c'
    ctx.fillRect(0, 0, VIEW_W, VIEW_H)
    if (this.shake > 0) {
      ctx.translate((Math.random() - 0.5) * this.shake, (Math.random() - 0.5) * this.shake)
    }

    if (this.phase === 'menu') {
      this.renderMenu()
      return
    }
    if (this.phase === 'gameover') {
      this.renderGameOver()
      return
    }

    drawBackground(ctx, this.assets.backgrounds.board, 0.42)
    drawLane(ctx, LANE_A, this.time)
    drawLane(ctx, LANE_B, this.time)

    // 塔位
    for (let i = 0; i < SOCKETS.length; i++) {
      const s = SOCKETS[i]
      const occupied = this.towers.some((t) => t.socket === i)
      if (occupied) continue
      let state: 'idle' | 'hover' | 'bad' | 'ok' = 'idle'
      if (i === this.hoverSocket) {
        if (this.buildType) {
          const def = TOWERS[this.buildType]
          const fits = this.load + def.load <= this.capacity && this.compute >= def.cost
          state = fits ? 'ok' : 'bad'
        } else state = 'hover'
      }
      drawSocket(ctx, s.x, s.y, SOCKET_R, state)
    }

    // 范围预览：选中 / 悬停
    const sel = this.towers.find((t) => t.id === this.selectedId)
    if (sel) {
      const def = towerStats(sel.type, sel.level)
      if (def.range > 0) drawRange(ctx, sel.x, sel.y, def.range, towerColor(sel.type))
    }
    if (
      this.buildType &&
      this.hoverSocket >= 0 &&
      !this.towers.some((t) => t.socket === this.hoverSocket)
    ) {
      const def = TOWERS[this.buildType]
      const s = SOCKETS[this.hoverSocket]
      if (def.range > 0) drawRange(ctx, s.x, s.y, def.range, towerColor(this.buildType))
    }

    drawCore(ctx, CORE.x, CORE.y, CORE.r, this.integrity / START_INTEGRITY, this.temp, this.time)

    for (const t of this.towers) {
      drawTower(ctx, t.x, t.y, t.type, t.level, t.angle, this.time, t.id === this.selectedId)
    }

    const order = [...this.enemies].sort((a, b) => a.dist - b.dist)
    for (const e of order) {
      drawEnemy(
        ctx,
        e.x,
        e.y,
        e.type,
        e.radius,
        ENEMIES[e.type].color,
        e.hp / e.maxHp,
        e.angle,
        this.time,
        e.slowT > 0
      )
    }

    for (const b of this.bullets) drawBullet(ctx, b.x, b.y, b.vx, b.vy, b.color, b.kind)

    // 扩散环
    ctx.save()
    for (const r of this.rings) {
      const a = 1 - r.r / (r.max + 4)
      ctx.globalAlpha = Math.max(0, a) * 0.7
      ctx.strokeStyle = r.color
      ctx.lineWidth = 3
      ctx.beginPath()
      ctx.arc(r.x, r.y, r.r, 0, Math.PI * 2)
      ctx.stroke()
    }
    ctx.restore()

    drawParticles(ctx, this.particles)
    drawFloatText(ctx, this.floats)

    this.renderOverlay()
  }

  private renderOverlay(): void {
    const ctx = this.ctx
    // 过热度暗角
    const heat = Math.max(
      0,
      Math.min(1, (this.temp - THROTTLE_START) / (OVERHEAT_TEMP - THROTTLE_START))
    )
    if (heat > 0) {
      const g = ctx.createRadialGradient(
        VIEW_W / 2,
        VIEW_H / 2,
        VIEW_H * 0.35,
        VIEW_W / 2,
        VIEW_H / 2,
        VIEW_W * 0.62
      )
      g.addColorStop(0, 'rgba(255,60,30,0)')
      g.addColorStop(1, `rgba(255,60,30,${0.42 * heat})`)
      ctx.fillStyle = g
      ctx.fillRect(0, 0, VIEW_W, VIEW_H)
    }
    if (this.overclockT > 0) {
      ctx.strokeStyle = `rgba(125, 255, 155, ${0.25 + 0.2 * Math.sin(this.time * 12)})`
      ctx.lineWidth = 6
      ctx.strokeRect(3, 3, VIEW_W - 6, VIEW_H - 6)
    }

    // 波次横幅
    if (this.waveBannerT > 0) {
      const a = Math.min(1, this.waveBannerT)
      ctx.save()
      ctx.globalAlpha = a
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.font = `800 64px ${FONT}`
      ctx.fillStyle = isBossWave(this.wave) ? '#ff5d73' : '#eaf6ff'
      ctx.shadowColor = isBossWave(this.wave) ? '#ff5d73' : '#3fd0ff'
      ctx.shadowBlur = 24
      const label = isBossWave(this.wave)
        ? this.host.te('kerneldef.banner.boss', { n: this.wave })
        : this.host.te('kerneldef.banner.wave', { n: this.wave })
      ctx.fillText(label, VIEW_W / 2, 190)
      ctx.restore()
    }

    // 提示信息
    if (this.messageT > 0) {
      ctx.save()
      ctx.globalAlpha = Math.min(1, this.messageT)
      ctx.textAlign = 'center'
      ctx.font = `600 20px ${FONT}`
      ctx.fillStyle = '#dff3ff'
      const w = ctx.measureText(this.message).width + 40
      ctx.fillStyle = 'rgba(6, 14, 22, 0.82)'
      roundRectPath(ctx, VIEW_W / 2 - w / 2, VIEW_H - 86, w, 40, 10)
      ctx.fill()
      ctx.strokeStyle = 'rgba(90, 209, 255, 0.5)'
      ctx.lineWidth = 1.5
      ctx.stroke()
      ctx.fillStyle = '#dff3ff'
      ctx.textBaseline = 'middle'
      ctx.fillText(this.message, VIEW_W / 2, VIEW_H - 66)
      ctx.restore()
    }

    // Boss 血条
    const boss = this.enemies.find((e) => e.boss)
    if (boss) {
      const w = 620
      const x = (VIEW_W - w) / 2
      const y = 26
      ctx.save()
      ctx.fillStyle = 'rgba(6,14,22,0.8)'
      roundRectPath(ctx, x - 10, y - 12, w + 20, 40, 10)
      ctx.fill()
      ctx.fillStyle = 'rgba(255,255,255,0.12)'
      ctx.fillRect(x, y, w, 14)
      ctx.fillStyle = '#ff3b3b'
      ctx.fillRect(x, y, w * Math.max(0, boss.hp / boss.maxHp), 14)
      ctx.fillStyle = '#ffd7d7'
      ctx.font = `700 15px ${FONT}`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(this.host.t('kerneldef.hud.boss', '根套件 · ROOTKIT'), VIEW_W / 2, y + 7)
      ctx.restore()
    }

    if (this.paused) {
      ctx.save()
      ctx.fillStyle = 'rgba(3, 7, 12, 0.72)'
      ctx.fillRect(0, 0, VIEW_W, VIEW_H)
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillStyle = '#eaf6ff'
      ctx.font = `800 56px ${FONT}`
      ctx.fillText(this.host.t('kerneldef.pause.title', '已暂停'), VIEW_W / 2, VIEW_H / 2 - 16)
      ctx.font = `500 20px ${FONT}`
      ctx.fillStyle = '#9fb6c6'
      ctx.fillText(
        this.host.t('kerneldef.pause.hint', '按 P / Esc 或点击继续'),
        VIEW_W / 2,
        VIEW_H / 2 + 40
      )
      ctx.restore()
    }
  }

  private renderMenu(): void {
    const ctx = this.ctx
    drawBackground(ctx, this.assets.backgrounds.title, 0.45)
    const banner = this.assets.backgrounds.circuit
    if (banner) {
      ctx.save()
      ctx.globalAlpha = 0.16
      ctx.drawImage(banner, VIEW_W - 470, VIEW_H - 320, 470, 320)
      ctx.restore()
    }
    ctx.save()
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.shadowColor = '#3fd0ff'
    ctx.shadowBlur = 26
    ctx.fillStyle = '#eaf6ff'
    ctx.font = `900 88px ${FONT}`
    ctx.fillText(this.host.t('kerneldef.title', '内核防线'), VIEW_W / 2, 208)
    ctx.shadowBlur = 8
    ctx.font = `600 26px ${MONO}`
    ctx.fillStyle = '#5ad1ff'
    ctx.fillText('KERNEL DEFENSE', VIEW_W / 2, 272)

    ctx.shadowBlur = 0
    ctx.font = `500 20px ${FONT}`
    ctx.fillStyle = '#c7d6e2'
    ctx.fillText(
      this.host.t('kerneldef.menu.tagline', '守住 CPU 核心，挡住一波波入侵'),
      VIEW_W / 2,
      330
    )

    const best = this.stats?.bestWave ?? 0
    if (best > 0) {
      ctx.font = `600 18px ${FONT}`
      ctx.fillStyle = '#ffd166'
      ctx.fillText(this.host.te('kerneldef.menu.best', { n: best }), VIEW_W / 2, 372)
    }

    const pulse = 0.6 + 0.4 * Math.sin(this.time * 4)
    ctx.globalAlpha = pulse
    ctx.font = `700 30px ${FONT}`
    ctx.fillStyle = '#7dff9b'
    ctx.fillText(this.host.t('kerneldef.menu.start', '点击 / 空格 开始防御'), VIEW_W / 2, 470)
    ctx.globalAlpha = 1

    ctx.font = `400 16px ${FONT}`
    ctx.fillStyle = '#7d93a6'
    const lines = this.host
      .t(
        'kerneldef.menu.help',
        '选防御程序 → 点焊盘部署 · 单击敌人 = SIGKILL · O = 超频 · 注意温度与供电'
      )
      .split('\n')
    lines.forEach((l, i) => ctx.fillText(l, VIEW_W / 2, 560 + i * 26))
    ctx.restore()
  }

  private renderGameOver(): void {
    const ctx = this.ctx
    drawBackground(ctx, this.assets.backgrounds.over, 0.5)
    ctx.save()
    ctx.fillStyle = 'rgba(3,7,12,0.5)'
    ctx.fillRect(0, 0, VIEW_W, VIEW_H)
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.shadowColor = '#ff4d5e'
    ctx.shadowBlur = 26
    ctx.fillStyle = '#ff5d73'
    ctx.font = `900 76px ${FONT}`
    ctx.fillText(this.host.t('kerneldef.over.title', '核心被击穿'), VIEW_W / 2, 188)
    ctx.shadowBlur = 0
    ctx.fillStyle = '#eaf6ff'
    ctx.font = `700 28px ${FONT}`
    ctx.fillText(this.host.te('kerneldef.over.wave', { n: this.wave }), VIEW_W / 2, 286)
    ctx.font = `500 20px ${FONT}`
    ctx.fillStyle = '#c7d6e2'
    ctx.fillText(
      this.host.te('kerneldef.over.detail', { k: this.kills, s: this.score }),
      VIEW_W / 2,
      330
    )
    const best = this.stats?.bestWave ?? 0
    if (best > 0) {
      ctx.fillStyle = '#ffd166'
      ctx.font = `600 18px ${FONT}`
      ctx.fillText(this.host.te('kerneldef.menu.best', { n: best }), VIEW_W / 2, 372)
    }
    const pulse = 0.6 + 0.4 * Math.sin(this.time * 4)
    ctx.globalAlpha = pulse
    ctx.fillStyle = '#7dff9b'
    ctx.font = `700 30px ${FONT}`
    ctx.fillText(this.host.t('kerneldef.over.retry', '点击 / 空格 再来一次'), VIEW_W / 2, 470)
    ctx.restore()
  }

  // ─────────── 状态推送 ───────────

  private pushState(): void {
    const sel = this.towers.find((t) => t.id === this.selectedId) ?? null
    let tower: UiTower | null = null
    if (sel) {
      tower = {
        id: sel.id,
        type: sel.type,
        level: sel.level,
        canUpgrade: sel.level < MAX_TOWER_LEVEL && this.compute >= upgradeCost(sel.type, sel.level),
        upgradeCost: sel.level < MAX_TOWER_LEVEL ? upgradeCost(sel.type, sel.level) : 0,
        sellValue: towerSellValue(sel.type, sel.level)
      }
    }
    const base = emptyUiState()
    const state: UiState = {
      ...base,
      phase: this.phase,
      paused: this.paused,
      wave: this.wave,
      compute: Math.floor(this.compute),
      integrity: Math.max(0, Math.round(this.integrity)),
      maxIntegrity: START_INTEGRITY,
      temp: Math.round(this.temp),
      capacity: this.capacity,
      load: this.load,
      cooling: this.cooling,
      buildType: this.buildType,
      tower,
      enemiesAlive: this.enemies.length,
      enemiesLeft: this.enemies.length + Math.max(0, this.spawnQueue.length - this.spawnIdx),
      prepMs: this.phase === 'prep' ? Math.max(0, Math.round(this.prepT * 1000)) : null,
      message: this.message,
      score: this.score,
      kills: this.kills,
      overclockActive: this.overclockT > 0,
      overclockReady: this.overclockCd <= 0 && this.overclockT <= 0,
      overclockCd: Math.ceil(this.overclockCd),
      sigkillReady: this.sigkillCd <= 0,
      sigkillCd: Math.ceil(this.sigkillCd),
      psuCost: this.psuCost(),
      repairCost: this.repairCost(),
      canRepair: this.integrity < START_INTEGRITY && this.compute >= this.repairCost()
    }
    this.host.onState(state)
  }
}

function roundRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
): void {
  const rr = Math.min(r, w / 2, h / 2)
  ctx.beginPath()
  ctx.moveTo(x + rr, y)
  ctx.arcTo(x + w, y, x + w, y + h, rr)
  ctx.arcTo(x + w, y + h, x, y + h, rr)
  ctx.arcTo(x, y + h, x, y, rr)
  ctx.arcTo(x, y, x + w, y, rr)
  ctx.closePath()
}
