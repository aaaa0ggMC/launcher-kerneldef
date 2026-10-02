import { defineAsyncComponent } from 'vue'
import type { Ability } from '../../main/ui/ability'

/**
 * 内核防线 —— 双层总线塔防小游戏。
 *
 * 入侵进程沿电路总线冲向 CPU 核心；玩家把防御程序装到固定焊盘上拦截。
 * 与常见塔防不同之处：塔占功耗（受供电容量限制），开火产热（超过阈值的塔集体降频，
 * 再高核心直接过热掉血），外加手动 SIGKILL 与超频两个技能。
 *
 * 角色 / 敌人 / 音效全部程序化生成；环境背景图由本机 ComfyUI（Z-Image Turbo）生成。
 * keepAlive: false —— 切走即销毁、音乐停止。进度经 kerneldef.* 命令持久化。
 */
export default {
  id: 'kerneldef',
  name: '内核防线',
  icon: 'default/microchip/padding',
  category: '游戏',
  keepAlive: false,
  component: defineAsyncComponent(() => import('./View.vue'))
} satisfies Ability
