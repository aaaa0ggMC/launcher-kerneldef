import type { CommandSpec } from '../../main/process/commands/types'
import { mkdir, readFile, rename, writeFile } from 'fs/promises'
import { dirname, join } from 'path'
import { USER_CONFIG_DIR } from '../../main/process/paths'
import { makeLogger } from '../../main/process/logger'
import type { KernelDefStats } from './game/types'

const log = makeLogger('kerneldef')

/**
 * 内核防线进度 —— 读取纪录 / 记录一局战绩 / 清空。
 * 数据文件 `~/.config/LinuxCockpit/kerneldef/stats.json`，tmp+rename 原子写入。
 */

const STATS_PATH = join(USER_CONFIG_DIR, 'kerneldef', 'stats.json')

function defaults(): KernelDefStats {
  return { version: 1, bestWave: 0, bestKills: 0, bestScore: 0, runs: 0 }
}

const num = (v: unknown, d: number): number => (Number.isFinite(Number(v)) ? Number(v) : d)

async function readStats(): Promise<KernelDefStats> {
  try {
    const parsed = JSON.parse(await readFile(STATS_PATH, 'utf-8')) as Partial<KernelDefStats>
    return {
      version: 1,
      bestWave: Math.max(0, Math.round(num(parsed.bestWave, 0))),
      bestKills: Math.max(0, Math.round(num(parsed.bestKills, 0))),
      bestScore: Math.max(0, Math.round(num(parsed.bestScore, 0))),
      runs: Math.max(0, Math.round(num(parsed.runs, 0)))
    }
  } catch {
    return defaults()
  }
}

async function writeStats(stats: KernelDefStats): Promise<void> {
  await mkdir(dirname(STATS_PATH), { recursive: true })
  const tmp = `${STATS_PATH}.tmp`
  await writeFile(tmp, JSON.stringify(stats, null, 2), 'utf-8')
  await rename(tmp, STATS_PATH)
}

export default [
  {
    name: 'kerneldef.stats',
    description: '读取「内核防线」的历史纪录（最高波次 / 最多击杀 / 最高分 / 总局数）',
    usage: 'kerneldef.stats',
    run: async () => readStats()
  },
  {
    name: 'kerneldef.record',
    description:
      '记录一局「内核防线」战绩（--wave <到达波次> --kills <击杀> --score <分数> --time <秒>），仅刷新更好的纪录',
    usage: 'kerneldef.record --wave 7 --kills 84 --score 1320 --time 420',
    run: async (ctx) => {
      const wave = Math.max(0, Math.round(num(ctx.named.wave, 0)))
      const kills = Math.max(0, Math.round(num(ctx.named.kills, 0)))
      const score = Math.max(0, Math.round(num(ctx.named.score, 0)))
      const stats = await readStats()
      stats.runs += 1
      stats.bestWave = Math.max(stats.bestWave, wave)
      stats.bestKills = Math.max(stats.bestKills, kills)
      stats.bestScore = Math.max(stats.bestScore, score)
      await writeStats(stats)
      log.info('kerneldef.record ok', { wave, kills, score })
      return { ok: true, ...stats }
    }
  },
  {
    name: 'kerneldef.reset',
    description: '清空「内核防线」的全部纪录（需 --confirm true）',
    usage: 'kerneldef.reset --confirm true',
    run: async (ctx) => {
      if (String(ctx.named.confirm) !== 'true') return { ok: false, error: '需要 --confirm true' }
      await writeStats(defaults())
      log.info('kerneldef.reset')
      return { ok: true, ...defaults() }
    }
  }
] satisfies CommandSpec[]
