/**
 * 资源加载 —— 只有 ComfyUI（Z-Image Turbo）生成的环境背景图。
 * 所有塔、敌人、核心、特效都在 sprites.ts 里程序化绘制（AI 生图搞不定一致的角色）。
 */

export interface GameAssets {
  /** title / board / circuit / over */
  backgrounds: Record<string, HTMLImageElement>
}

const urls = import.meta.glob('../assets/*.jpg', {
  eager: true,
  query: '?url',
  import: 'default'
}) as Record<string, string>

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error(`kerneldef image failed: ${url}`))
    img.src = url
  })
}

export async function loadGameAssets(): Promise<GameAssets> {
  const entries = await Promise.all(
    Object.entries(urls).map(async ([path, url]) => {
      const name = path.replace(/^.*\//, '').replace(/\.jpg$/, '')
      return [name, await loadImage(url)] as const
    })
  )
  return { backgrounds: Object.fromEntries(entries) }
}
