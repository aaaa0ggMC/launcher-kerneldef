/**
 * 内核防线 —— 地图 / 塔与敌人数据 / 波次生成。
 *
 * 地图是"双总线汇入核心"：上总线 y=180、下总线 y=540 各从左侧端口入场，
 * 在 x=880 折向中间，沿 y=360 合流冲到核心。塔位（socket）是固定焊盘，
 * 玩家把防御程序装在焊盘上，而不是自由摆放——固定点位让数值可控、画面干净。
 */

import type { EnemyType, Lane, TowerType, Vec } from './types'
import { VIEW_H, VIEW_W } from './types'

export const CORE = { x: VIEW_W - 65, y: VIEW_H / 2, r: 44 }

/** 总线上的路径点（敌人沿折线推进）。两条总线间距 280，
 *  中央一排塔位（y=360）到两条 lane 各 140 —— 正好在一级扫描器射程（158）内，
 *  所以中排是"一塔看两路"的黄金位。 */
export const LANE_A: Vec[] = [
  { x: -20, y: 220 },
  { x: 880, y: 220 },
  { x: 880, y: VIEW_H / 2 },
  { x: CORE.x - CORE.r + 2, y: VIEW_H / 2 }
]

export const LANE_B: Vec[] = [
  { x: -20, y: 500 },
  { x: 880, y: 500 },
  { x: 880, y: VIEW_H / 2 },
  { x: CORE.x - CORE.r + 2, y: VIEW_H / 2 }
]

/** 固定塔位（焊盘中心）。分四排紧贴两条总线上下两侧（各偏 100），
 *  外加两处汇流口塔位；每座塔因此能覆盖一段约 ±120px 的车道。 */
export const SOCKETS: Vec[] = [
  { x: 170, y: 120 },
  { x: 450, y: 120 },
  { x: 730, y: 120 },
  { x: 170, y: 320 },
  { x: 450, y: 320 },
  { x: 730, y: 320 },
  { x: 170, y: 400 },
  { x: 450, y: 400 },
  { x: 730, y: 400 },
  { x: 170, y: 600 },
  { x: 450, y: 600 },
  { x: 730, y: 600 },
  { x: 1020, y: 250 },
  { x: 1020, y: 470 }
]

export const SOCKET_R = 26

// ─────────────────────────── 塔 ───────────────────────────

export interface TowerDef {
  type: TowerType
  /** 翻译键后缀：kerneldef.tower.<key>.name / .desc */
  key: string
  cost: number
  load: number
  range: number
  /** 每秒射击次数 */
  rate: number
  damage: number
  /** 每次攻击增加的热量 */
  heat: number
  /** 溅射半径（0 = 单体） */
  splash: number
  /** 减速比例 / 持续时间 */
  slow: number
  slowTime: number
  /** 无视护甲 */
  pierce: boolean
  /** 蜜罐：每秒产出算力 */
  income: number
  projectileSpeed: number
  color: string
}

export const TOWERS: Record<TowerType, TowerDef> = {
  scanner: {
    type: 'scanner',
    key: 'scanner',
    cost: 50,
    load: 1,
    range: 158,
    rate: 2.9,
    damage: 10,
    heat: 0.5,
    splash: 0,
    slow: 0,
    slowTime: 0,
    pierce: false,
    income: 0,
    projectileSpeed: 780,
    color: '#5ad1ff'
  },
  firewall: {
    type: 'firewall',
    key: 'firewall',
    cost: 95,
    load: 2,
    range: 138,
    rate: 1,
    damage: 16,
    heat: 2.4,
    splash: 64,
    slow: 0.45,
    slowTime: 1.4,
    pierce: false,
    income: 0,
    projectileSpeed: 0,
    color: '#ff9d4d'
  },
  antivirus: {
    type: 'antivirus',
    key: 'antivirus',
    cost: 155,
    load: 2,
    range: 252,
    rate: 0.5,
    damage: 72,
    heat: 4,
    splash: 0,
    slow: 0,
    slowTime: 0,
    pierce: true,
    income: 0,
    projectileSpeed: 1150,
    color: '#7dff9b'
  },
  honeypot: {
    type: 'honeypot',
    key: 'honeypot',
    cost: 75,
    load: 1,
    range: 0,
    rate: 0,
    damage: 0,
    heat: 0,
    splash: 0,
    slow: 0,
    slowTime: 0,
    pierce: false,
    income: 7,
    projectileSpeed: 0,
    color: '#d59bff'
  }
}

export const TOWER_ORDER: TowerType[] = ['scanner', 'firewall', 'antivirus', 'honeypot']
export const MAX_TOWER_LEVEL = 3

/** 升级到下一级的费用。 */
export function upgradeCost(type: TowerType, level: number): number {
  return Math.round(TOWERS[type].cost * (0.55 + 0.55 * level))
}

/** 塔卖掉的返还（按累计投入的 60%）。 */
export function towerSellValue(type: TowerType, level: number): number {
  let invested = TOWERS[type].cost * 0.85
  for (let l = 1; l < level; l++) invested += upgradeCost(type, l)
  return Math.floor(invested * 0.6)
}

/** 塔升级后的实际数值。 */
export function towerStats(type: TowerType, level: number): TowerDef {
  const d = TOWERS[type]
  const s = level - 1
  return {
    ...d,
    load: d.load + s,
    range: d.range * Math.pow(1.1, s),
    rate: d.rate * Math.pow(1.18, s),
    damage: d.damage * Math.pow(1.72, s),
    heat: d.heat * Math.pow(1.28, s),
    income: d.income * Math.pow(1.8, s)
  }
}

// ─────────────────────────── 敌人 ───────────────────────────

export interface EnemyDef {
  type: EnemyType
  key: string
  hp: number
  speed: number
  armor: number
  damage: number
  bounty: number
  radius: number
  color: string
  boss: boolean
  /** 死亡时分裂出多少只蠕虫 */
  splitInto: number
  /** Boss 每隔多少秒召唤一只蠕虫 */
  spawnEvery: number
}

export const ENEMIES: Record<EnemyType, EnemyDef> = {
  virus: {
    type: 'virus',
    key: 'virus',
    hp: 60,
    speed: 64,
    armor: 0,
    damage: 7,
    bounty: 8,
    radius: 12,
    color: '#ff5d73',
    boss: false,
    splitInto: 0,
    spawnEvery: 0
  },
  worm: {
    type: 'worm',
    key: 'worm',
    hp: 34,
    speed: 112,
    armor: 0,
    damage: 4,
    bounty: 6,
    radius: 10,
    color: '#ffd166',
    boss: false,
    splitInto: 0,
    spawnEvery: 0
  },
  trojan: {
    type: 'trojan',
    key: 'trojan',
    hp: 210,
    speed: 42,
    armor: 5,
    damage: 15,
    bounty: 20,
    radius: 17,
    color: '#b980ff',
    boss: false,
    splitInto: 0,
    spawnEvery: 0
  },
  ransomware: {
    type: 'ransomware',
    key: 'ransomware',
    hp: 140,
    speed: 56,
    armor: 2,
    damage: 10,
    bounty: 16,
    radius: 15,
    color: '#41e0c0',
    boss: false,
    splitInto: 2,
    spawnEvery: 0
  },
  rootkit: {
    type: 'rootkit',
    key: 'rootkit',
    hp: 1500,
    speed: 30,
    armor: 10,
    damage: 45,
    bounty: 160,
    radius: 30,
    color: '#ff3b3b',
    boss: true,
    splitInto: 0,
    spawnEvery: 3.2
  }
}

// ─────────────────────────── 波次 ───────────────────────────

export interface SpawnOrder {
  type: EnemyType
  lane: Lane
  /** 相对于本波开始的秒数 */
  at: number
}

/** 稳定可复现的 RNG —— 同一波次每次生成一致。 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const POINT_COST: Record<EnemyType, number> = {
  virus: 1,
  worm: 0.7,
  trojan: 3.2,
  ransomware: 2.4,
  rootkit: 0
}

const INTERVAL: Record<EnemyType, number> = {
  virus: 0.68,
  worm: 0.42,
  trojan: 1.15,
  ransomware: 0.95,
  rootkit: 2
}

export function isBossWave(n: number): boolean {
  return n > 0 && n % 5 === 0
}

/** 按波次生成出怪表。HP 与赏金缩放见 engine。 */
export function makeWave(n: number): SpawnOrder[] {
  const rng = mulberry32(0x9e3779b9 ^ (n * 2654435761))
  const pool: EnemyType[] = ['virus']
  if (n >= 2) pool.push('worm')
  if (n >= 3) pool.push('trojan')
  if (n >= 4) pool.push('ransomware')

  const pick = (): EnemyType => {
    // 后期偏向更硬的单位
    const r = rng()
    if (n >= 6 && r < 0.22) return 'trojan'
    if (n >= 4 && r < 0.4) return 'ransomware'
    if (n >= 2 && r < 0.66) return 'worm'
    return pool[Math.floor(rng() * pool.length)] ?? 'virus'
  }

  const orders: SpawnOrder[] = []
  let lane: Lane = rng() < 0.5 ? 'a' : 'b'
  let t = 0

  const push = (type: EnemyType, at: number, localLane: Lane): void => {
    orders.push({ type, lane: localLane, at })
  }

  if (isBossWave(n)) {
    // Boss 关：一只根套件 + 少量护送
    push('rootkit', 1.6, lane)
    const budget = 4 + n * 1.4
    let spent = 0
    let support: Lane = lane === 'a' ? 'b' : 'a'
    let supportCount = 0
    t = 3
    while (spent < budget) {
      const type = n >= 3 ? pick() : 'worm'
      push(type, t, support)
      spent += POINT_COST[type]
      t += INTERVAL[type] * (1 + rng() * 0.5)
      if (++supportCount >= 3) {
        supportCount = 0
        support = support === 'a' ? 'b' : 'a'
      }
    }
    return orders
  }

  const budget = 8 + n * 2.8
  let spent = 0
  // 每 2~4 只换一次车道：保证两条总线轮流吃压力，
  // 否则整波挤在一条 lane 上，另一侧的塔全程看戏。
  let laneCount = 0
  let laneSpan = 2 + Math.floor(rng() * 3)
  while (spent < budget) {
    const type = pick()
    push(type, t, lane)
    spent += POINT_COST[type]
    t += INTERVAL[type] * (0.8 + rng() * 0.7)
    if (++laneCount >= laneSpan) {
      laneCount = 0
      laneSpan = 2 + Math.floor(rng() * 3)
      lane = lane === 'a' ? 'b' : 'a'
    }
  }
  orders.sort((a, b) => a.at - b.at)
  return orders
}

/** 敌人 HP / 赏金随波次增长的系数。 */
export function waveScale(n: number): { hp: number; bounty: number; speed: number } {
  return {
    hp: 1 + (n - 1) * 0.15,
    bounty: 1 + (n - 1) * 0.045,
    speed: Math.min(1.5, 1 + (n - 1) * 0.012)
  }
}

/** 折线累计长度 + 按距离取点，供引擎复用。 */
export interface Polyline {
  points: Vec[]
  lengths: number[]
  total: number
}

export function buildPolyline(points: Vec[]): Polyline {
  const lengths: number[] = []
  let total = 0
  for (let i = 0; i < points.length - 1; i++) {
    const d = Math.hypot(points[i + 1].x - points[i].x, points[i + 1].y - points[i].y)
    lengths.push(d)
    total += d
  }
  return { points, lengths, total }
}

export function pointAt(poly: Polyline, dist: number): Vec {
  let d = Math.max(0, Math.min(poly.total, dist))
  for (let i = 0; i < poly.lengths.length; i++) {
    if (d <= poly.lengths[i]) {
      const a = poly.points[i]
      const b = poly.points[i + 1]
      const k = poly.lengths[i] === 0 ? 0 : d / poly.lengths[i]
      return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k }
    }
    d -= poly.lengths[i]
  }
  return { ...poly.points[poly.points.length - 1] }
}
