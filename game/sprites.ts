/**
 * 程序化绘制 —— 塔 / 敌人 / 核心 / 特效全部用 Canvas 2D 画出来，零角色贴图。
 *
 * 视觉语言：深色电路板上的一层霓虹。所有实体都带一圈与自身同色的辉光，
 * 靠"轮廓 + 颜色 + 内部符号"区分，不依赖高清贴图。
 */

import type { EnemyType, TowerType } from './types'

export const FONT =
  '"Noto Sans CJK SC", "Source Han Sans SC", "Microsoft YaHei", system-ui, sans-serif'
export const MONO = 'ui-monospace, "JetBrains Mono", "Fira Code", monospace'

type Ctx = CanvasRenderingContext2D

// ─────────────────────────── 基础工具 ───────────────────────────

export function roundRect(ctx: Ctx, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.min(r, w / 2, h / 2)
  ctx.beginPath()
  ctx.moveTo(x + rr, y)
  ctx.arcTo(x + w, y, x + w, y + h, rr)
  ctx.arcTo(x + w, y + h, x, y + h, rr)
  ctx.arcTo(x, y + h, x, y, rr)
  ctx.arcTo(x, y, x + w, y, rr)
  ctx.closePath()
}

function withGlow(ctx: Ctx, color: string, blur: number, fn: () => void): void {
  ctx.save()
  ctx.shadowColor = color
  ctx.shadowBlur = blur
  fn()
  ctx.restore()
}

/** 多边形（正 n 边形，可旋转）。 */
function poly(ctx: Ctx, x: number, y: number, r: number, n: number, rot: number): void {
  ctx.beginPath()
  for (let i = 0; i < n; i++) {
    const a = rot + (i / n) * Math.PI * 2
    const px = x + Math.cos(a) * r
    const py = y + Math.sin(a) * r
    if (i === 0) ctx.moveTo(px, py)
    else ctx.lineTo(px, py)
  }
  ctx.closePath()
}

function rings(ctx: Ctx, x: number, y: number, r: number, t: number, color: string): void {
  ctx.save()
  ctx.strokeStyle = color
  ctx.globalAlpha = 0.5
  ctx.lineWidth = 1.5
  for (let i = 0; i < 2; i++) {
    const p = (t * 0.5 + i * 0.5) % 1
    ctx.globalAlpha = 0.45 * (1 - p)
    ctx.beginPath()
    ctx.arc(x, y, r * (0.5 + p * 0.7), 0, Math.PI * 2)
    ctx.stroke()
  }
  ctx.restore()
}

// ─────────────────────────── 背景 / 地图 ───────────────────────────

export function drawBackground(ctx: Ctx, img: HTMLImageElement | undefined, dim: number): void {
  ctx.fillStyle = '#05070c'
  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height)
  if (img) {
    ctx.globalAlpha = 1
    ctx.drawImage(img, 0, 0, ctx.canvas.width, ctx.canvas.height)
  }
  // 压暗 + 冷色罩，让霓虹层浮起来
  ctx.fillStyle = `rgba(4, 8, 16, ${dim})`
  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height)
  ctx.fillStyle = 'rgba(10, 20, 40, 0.25)'
  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height)
}

const LANE_COLOR = '#3fd0ff'

/** 画一条总线折线：底槽 + 流动光点。 */
export function drawLane(ctx: Ctx, points: { x: number; y: number }[], t: number): void {
  ctx.save()
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'
  ctx.strokeStyle = 'rgba(20, 40, 60, 0.95)'
  ctx.lineWidth = 34
  ctx.beginPath()
  ctx.moveTo(points[0].x, points[0].y)
  for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y)
  ctx.stroke()

  ctx.strokeStyle = 'rgba(63, 208, 255, 0.22)'
  ctx.lineWidth = 26
  ctx.stroke()

  ctx.strokeStyle = 'rgba(120, 230, 255, 0.5)'
  ctx.lineWidth = 2
  ctx.setLineDash([14, 20])
  ctx.lineDashOffset = -((t * 90) % 34)
  ctx.stroke()
  ctx.restore()

  // 流动的"数据包"光点
  ctx.save()
  const total = polyLength(points)
  for (let i = 0; i < 6; i++) {
    const d = (((t * 140 + (i * total) / 6) % total) + total) % total
    const p = pointOnPoly(points, d)
    ctx.fillStyle = 'rgba(160, 240, 255, 0.9)'
    ctx.shadowColor = LANE_COLOR
    ctx.shadowBlur = 10
    ctx.beginPath()
    ctx.arc(p.x, p.y, 3, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.restore()
}

function polyLength(points: { x: number; y: number }[]): number {
  let total = 0
  for (let i = 0; i < points.length - 1; i++)
    total += Math.hypot(points[i + 1].x - points[i].x, points[i + 1].y - points[i].y)
  return total
}

function pointOnPoly(points: { x: number; y: number }[], dist: number): { x: number; y: number } {
  let d = dist
  for (let i = 0; i < points.length - 1; i++) {
    const len = Math.hypot(points[i + 1].x - points[i].x, points[i + 1].y - points[i].y)
    if (d <= len) {
      const k = len === 0 ? 0 : d / len
      return {
        x: points[i].x + (points[i + 1].x - points[i].x) * k,
        y: points[i].y + (points[i + 1].y - points[i].y) * k
      }
    }
    d -= len
  }
  return { ...points[points.length - 1] }
}

/** 塔位焊盘。 */
export function drawSocket(
  ctx: Ctx,
  x: number,
  y: number,
  r: number,
  state: 'idle' | 'hover' | 'bad' | 'ok'
): void {
  const color =
    state === 'bad'
      ? '#ff5d73'
      : state === 'ok'
        ? '#7dff9b'
        : state === 'hover'
          ? '#ffffff'
          : '#5b7c93'
  ctx.save()
  ctx.globalAlpha = state === 'idle' ? 0.55 : 0.95
  ctx.strokeStyle = color
  ctx.lineWidth = 2
  ctx.setLineDash(state === 'idle' ? [4, 4] : [])
  ctx.beginPath()
  ctx.arc(x, y, r, 0, Math.PI * 2)
  ctx.stroke()
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4
    ctx.beginPath()
    ctx.moveTo(x + Math.cos(a) * (r - 6), y + Math.sin(a) * (r - 6))
    ctx.lineTo(x + Math.cos(a) * (r + 3), y + Math.sin(a) * (r + 3))
    ctx.stroke()
  }
  ctx.restore()
}

export function drawRange(ctx: Ctx, x: number, y: number, r: number, color: string): void {
  ctx.save()
  ctx.beginPath()
  ctx.arc(x, y, r, 0, Math.PI * 2)
  ctx.fillStyle = `${color}18`
  ctx.fill()
  ctx.strokeStyle = `${color}88`
  ctx.lineWidth = 1.5
  ctx.setLineDash([6, 6])
  ctx.stroke()
  ctx.restore()
}

// ─────────────────────────── 核心 ───────────────────────────

export function drawCore(
  ctx: Ctx,
  x: number,
  y: number,
  r: number,
  integrity: number,
  temp: number,
  t: number
): void {
  const hot = Math.max(0, Math.min(1, (temp - 92) / 44))
  const base = integrity > 0.5 ? '#49e0ff' : integrity > 0.25 ? '#ffb347' : '#ff4d5e'
  const glowColor = hot > 0 ? '#ff5a3c' : base

  // 光晕
  const pulse = 1 + Math.sin(t * 3) * 0.04
  const g = ctx.createRadialGradient(x, y, r * 0.2, x, y, r * 2.4 * pulse)
  g.addColorStop(0, hot > 0 ? 'rgba(255,90,60,0.5)' : 'rgba(73,224,255,0.4)')
  g.addColorStop(1, 'rgba(0,0,0,0)')
  ctx.fillStyle = g
  ctx.beginPath()
  ctx.arc(x, y, r * 2.4 * pulse, 0, Math.PI * 2)
  ctx.fill()

  // 芯片本体
  withGlow(ctx, glowColor, 18, () => {
    roundRect(ctx, x - r, y - r, r * 2, r * 2, 10)
    ctx.fillStyle = '#0c1622'
    ctx.fill()
    ctx.strokeStyle = glowColor
    ctx.lineWidth = 3
    ctx.stroke()
  })

  // 引脚
  ctx.save()
  ctx.fillStyle = 'rgba(150, 200, 220, 0.6)'
  const pins = 6
  for (let i = 0; i < pins; i++) {
    const off = -r + ((i + 0.5) * (r * 2)) / pins
    ctx.fillRect(x + off - 3, y - r - 6, 6, 6)
    ctx.fillRect(x + off - 3, y + r, 6, 6)
    ctx.fillRect(x - r - 6, y + off - 3, 6, 6)
    ctx.fillRect(x + r, y + off - 3, 6, 6)
  }
  ctx.restore()

  // 内部符文环
  ctx.save()
  ctx.translate(x, y)
  ctx.rotate(t * 0.6)
  ctx.strokeStyle = `${glowColor}cc`
  ctx.lineWidth = 2
  poly(ctx, 0, 0, r * 0.62, 6, 0)
  ctx.stroke()
  ctx.rotate(-t * 1.4)
  poly(ctx, 0, 0, r * 0.38, 3, 0)
  ctx.fillStyle = `${glowColor}55`
  ctx.fill()
  ctx.restore()

  // 完整性弧
  ctx.save()
  ctx.lineWidth = 5
  ctx.strokeStyle = 'rgba(255,255,255,0.12)'
  ctx.beginPath()
  ctx.arc(x, y, r + 12, 0, Math.PI * 2)
  ctx.stroke()
  ctx.strokeStyle = base
  ctx.lineCap = 'round'
  ctx.beginPath()
  ctx.arc(x, y, r + 12, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.max(0, integrity))
  ctx.stroke()
  ctx.restore()
}

// ─────────────────────────── 塔 ───────────────────────────

const TOWER_COLORS: Record<TowerType, string> = {
  scanner: '#5ad1ff',
  firewall: '#ff9d4d',
  antivirus: '#7dff9b',
  honeypot: '#d59bff'
}

export function towerColor(type: TowerType): string {
  return TOWER_COLORS[type]
}

export function drawTower(
  ctx: Ctx,
  x: number,
  y: number,
  type: TowerType,
  level: number,
  angle: number,
  t: number,
  selected: boolean
): void {
  const color = TOWER_COLORS[type]
  const r = 20

  // 底座
  withGlow(ctx, color, selected ? 18 : 10, () => {
    poly(ctx, x, y, r + 3, 6, Math.PI / 6)
    ctx.fillStyle = '#0b1420'
    ctx.fill()
    ctx.strokeStyle = selected ? '#ffffff' : color
    ctx.lineWidth = 2.5
    ctx.stroke()
  })

  // 等级刻度
  ctx.save()
  ctx.strokeStyle = '#ffffff'
  ctx.globalAlpha = 0.75
  ctx.lineWidth = 2
  for (let i = 1; i < level; i++) {
    const a = -Math.PI / 2 + i * 0.5
    ctx.beginPath()
    ctx.moveTo(x + Math.cos(a) * (r - 2), y + Math.sin(a) * (r - 2))
    ctx.lineTo(x + Math.cos(a) * (r + 4), y + Math.sin(a) * (r + 4))
    ctx.stroke()
  }
  ctx.restore()

  // 炮塔
  ctx.save()
  ctx.translate(x, y)
  ctx.rotate(angle)
  withGlow(ctx, color, 8, () => {
    ctx.fillStyle = color
    ctx.strokeStyle = '#08121c'
    ctx.lineWidth = 2
    switch (type) {
      case 'scanner':
        ctx.fillRect(0, -4, r + 6, 8)
        ctx.beginPath()
        ctx.arc(0, 0, 9, 0, Math.PI * 2)
        ctx.fill()
        break
      case 'firewall':
        ctx.beginPath()
        ctx.arc(0, 0, 13, -0.9, 0.9)
        ctx.lineTo(0, 0)
        ctx.closePath()
        ctx.fill()
        ctx.stroke()
        break
      case 'antivirus':
        ctx.fillRect(-4, -3, r + 16, 6)
        ctx.fillStyle = '#0b1420'
        ctx.fillRect(r + 6, -6, 8, 12)
        break
      case 'honeypot':
        ctx.beginPath()
        ctx.arc(0, 0, 10, 0, Math.PI * 2)
        ctx.fill()
        ctx.strokeStyle = color
        ctx.lineWidth = 2
        ctx.beginPath()
        ctx.arc(0, 0, 15, -0.7, 0.7)
        ctx.stroke()
        break
    }
  })
  ctx.restore()

  // 蜜罐：环绕的数据蜜滴
  if (type === 'honeypot') {
    ctx.save()
    ctx.fillStyle = color
    for (let i = 0; i < 3; i++) {
      const a = t * 1.6 + (i / 3) * Math.PI * 2
      ctx.globalAlpha = 0.85
      ctx.beginPath()
      ctx.arc(x + Math.cos(a) * 16, y + Math.sin(a) * 16, 3, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.restore()
  }
}

// ─────────────────────────── 敌人 ───────────────────────────

export function drawEnemy(
  ctx: Ctx,
  x: number,
  y: number,
  type: EnemyType,
  radius: number,
  color: string,
  hpFrac: number,
  angle: number,
  t: number,
  slow: boolean
): void {
  ctx.save()
  ctx.translate(x, y)

  if (slow) {
    ctx.strokeStyle = 'rgba(120, 200, 255, 0.8)'
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.arc(0, 0, radius + 5, 0, Math.PI * 2)
    ctx.stroke()
  }

  withGlow(ctx, color, type === 'rootkit' ? 22 : 12, () => {
    ctx.fillStyle = color
    ctx.strokeStyle = '#05070c'
    ctx.lineWidth = 1.5
    switch (type) {
      case 'virus': {
        const spikes = 10
        ctx.beginPath()
        for (let i = 0; i < spikes * 2; i++) {
          const a = angle * 0.6 + (i / (spikes * 2)) * Math.PI * 2
          const rr = i % 2 === 0 ? radius : radius * 0.62
          const px = Math.cos(a) * rr
          const py = Math.sin(a) * rr
          if (i === 0) ctx.moveTo(px, py)
          else ctx.lineTo(px, py)
        }
        ctx.closePath()
        ctx.fill()
        break
      }
      case 'worm': {
        ctx.rotate(angle)
        for (let i = 3; i >= 1; i--) {
          const rr = radius * (0.5 + i * 0.18)
          ctx.globalAlpha = 0.4 + i * 0.2
          ctx.beginPath()
          ctx.arc(-i * radius * 0.75, Math.sin(t * 12 + i) * 2, rr, 0, Math.PI * 2)
          ctx.fill()
        }
        ctx.globalAlpha = 1
        break
      }
      case 'trojan': {
        ctx.rotate(angle * 0.3)
        poly(ctx, 0, 0, radius, 6, Math.PI / 6)
        ctx.fill()
        ctx.stroke()
        ctx.strokeStyle = 'rgba(0,0,0,0.5)'
        ctx.lineWidth = 2
        poly(ctx, 0, 0, radius * 0.55, 6, Math.PI / 6)
        ctx.stroke()
        break
      }
      case 'ransomware': {
        ctx.rotate(angle * 0.5)
        poly(ctx, 0, 0, radius, 4, 0)
        ctx.fill()
        ctx.stroke()
        // 锁孔
        ctx.fillStyle = '#05070c'
        ctx.beginPath()
        ctx.arc(0, -radius * 0.12, radius * 0.22, 0, Math.PI * 2)
        ctx.fill()
        ctx.fillRect(-radius * 0.08, -radius * 0.12, radius * 0.16, radius * 0.5)
        break
      }
      case 'rootkit': {
        ctx.rotate(angle * 0.15)
        poly(ctx, 0, 0, radius, 8, Math.PI / 8)
        ctx.fill()
        ctx.stroke()
        ctx.strokeStyle = 'rgba(0,0,0,0.45)'
        ctx.lineWidth = 3
        poly(ctx, 0, 0, radius * 0.7, 8, Math.PI / 8)
        ctx.stroke()
        ctx.fillStyle = '#05070c'
        ctx.beginPath()
        ctx.arc(0, 0, radius * 0.42, 0, Math.PI * 2)
        ctx.fill()
        ctx.fillStyle = color
        ctx.beginPath()
        ctx.arc(0, 0, radius * 0.26, 0, Math.PI * 2)
        ctx.fill()
        rings(ctx, 0, 0, radius * 1.5, t, color)
        break
      }
    }
  })
  ctx.restore()

  // 血条（受伤后才显示；Boss 用引擎单独画）
  if (type !== 'rootkit' && hpFrac < 1) {
    const w = radius * 2.2
    ctx.save()
    ctx.fillStyle = 'rgba(0,0,0,0.6)'
    ctx.fillRect(x - w / 2, y - radius - 10, w, 4)
    ctx.fillStyle = hpFrac > 0.5 ? '#7dff9b' : hpFrac > 0.25 ? '#ffd166' : '#ff5d73'
    ctx.fillRect(x - w / 2, y - radius - 10, w * hpFrac, 4)
    ctx.restore()
  }
}

// ─────────────────────────── 投射物 / 特效 ───────────────────────────

export function drawBullet(
  ctx: Ctx,
  x: number,
  y: number,
  vx: number,
  vy: number,
  color: string,
  kind: 'scanner' | 'antivirus'
): void {
  const a = Math.atan2(vy, vx)
  ctx.save()
  ctx.translate(x, y)
  ctx.rotate(a)
  ctx.shadowColor = color
  ctx.shadowBlur = 12
  ctx.fillStyle = color
  const len = kind === 'antivirus' ? 22 : 13
  ctx.fillRect(-len / 2, kind === 'antivirus' ? -2 : -2.5, len, kind === 'antivirus' ? 4 : 5)
  ctx.restore()
}

export function drawParticles(ctx: Ctx, particles: Particle[]): void {
  ctx.save()
  for (const p of particles) {
    const a = Math.max(0, p.life / p.max)
    ctx.globalAlpha = a
    ctx.fillStyle = p.color
    ctx.shadowColor = p.color
    ctx.shadowBlur = 8
    ctx.beginPath()
    ctx.arc(p.x, p.y, p.size * a, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.restore()
}

export interface Particle {
  x: number
  y: number
  vx: number
  vy: number
  life: number
  max: number
  size: number
  color: string
}

export function drawFloatText(ctx: Ctx, texts: FloatText[]): void {
  ctx.save()
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  for (const f of texts) {
    const a = Math.max(0, f.life / f.max)
    ctx.globalAlpha = a
    ctx.fillStyle = f.color
    ctx.shadowColor = 'rgba(0,0,0,0.9)'
    ctx.shadowBlur = 4
    ctx.font = `700 ${f.size}px ${MONO}`
    ctx.fillText(f.text, f.x, f.y)
  }
  ctx.restore()
}

export interface FloatText {
  x: number
  y: number
  text: string
  color: string
  size: number
  life: number
  max: number
}
