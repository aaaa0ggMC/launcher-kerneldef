/**
 * 内核防线 —— 共享类型。
 *
 * 设计核心（与常见塔防不同的地方）：
 *   1. 塔不是"想建就建"——每个塔占一份 **功耗（load）**，总功耗受 **供电容量（capacity）** 限制。
 *   2. 塔开火会发热，机箱有 **散热（cooling）**；温度超过阈值后全部塔降频（throttle），
 *      再高核心直接过热掉血。于是"多建塔"本身是有代价的，玩家要扩张供电 / 散热。
 *   3. 两个手动技能：SIGKILL（点杀一只）+ 超频（全塔短时加速、发热翻倍）。
 */

export const VIEW_W = 1280
export const VIEW_H = 720

export type TowerType = 'scanner' | 'firewall' | 'antivirus' | 'honeypot'
export type EnemyType = 'virus' | 'worm' | 'trojan' | 'ransomware' | 'rootkit'
export type Lane = 'a' | 'b'
export type Phase = 'menu' | 'prep' | 'wave' | 'paused' | 'gameover'

export interface Vec {
  x: number
  y: number
}

/** 一次失败（或主动结束）的战绩，用于写入统计。 */
export interface RunResult {
  wave: number
  kills: number
  score: number
  time: number
}

export interface KernelDefStats {
  version: 1
  bestWave: number
  bestKills: number
  bestScore: number
  runs: number
}

/** 选中塔时给 UI 的信息。 */
export interface UiTower {
  id: number
  type: TowerType
  level: number
  canUpgrade: boolean
  upgradeCost: number
  sellValue: number
}

/** 引擎 → 渲染端的状态快照（DOM 工具栏据此渲染）。 */
export interface UiState {
  phase: Phase
  paused: boolean
  wave: number
  compute: number
  integrity: number
  maxIntegrity: number
  temp: number
  capacity: number
  load: number
  cooling: number
  buildType: TowerType | null
  tower: UiTower | null
  enemiesAlive: number
  enemiesLeft: number
  prepMs: number | null
  message: string
  score: number
  kills: number
  overclockActive: boolean
  overclockReady: boolean
  overclockCd: number
  sigkillReady: boolean
  sigkillCd: number
  /** 扩容（供电 + 散热）下一次的价格；已满级为 null */
  psuCost: number | null
  /** 检修核心的当前价格与可用性 */
  repairCost: number
  canRepair: boolean
}

export function emptyUiState(): UiState {
  return {
    phase: 'menu',
    paused: false,
    wave: 0,
    compute: 0,
    integrity: 100,
    maxIntegrity: 100,
    temp: 35,
    capacity: 8,
    load: 0,
    cooling: 18,
    buildType: null,
    tower: null,
    enemiesAlive: 0,
    enemiesLeft: 0,
    prepMs: null,
    message: '',
    score: 0,
    kills: 0,
    overclockActive: false,
    overclockReady: true,
    overclockCd: 0,
    sigkillReady: true,
    sigkillCd: 0,
    psuCost: 90,
    repairCost: 60,
    canRepair: false
  }
}
