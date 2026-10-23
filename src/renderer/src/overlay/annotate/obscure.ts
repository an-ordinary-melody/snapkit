import type { Rect } from '../layout'

/**
 * Pixelated or blurred copy of part of the frozen screenshot, at full image
 * resolution. `scale` converts overlay px to image px.
 */
export function obscure(src: HTMLCanvasElement, r: Rect, scale: number, mode: 'pixelate' | 'blur'): HTMLCanvasElement {
  const sx = Math.round(r.x * scale)
  const sy = Math.round(r.y * scale)
  const sw = Math.max(1, Math.round(r.w * scale))
  const sh = Math.max(1, Math.round(r.h * scale))
  const out = document.createElement('canvas')
  out.width = sw
  out.height = sh
  const ctx = out.getContext('2d')!

  if (mode === 'pixelate') {
    // Shrink, then scale back up without smoothing: blocks of ~12 screen px.
    const block = Math.max(4, Math.round(12 * scale))
    const tw = Math.max(1, Math.ceil(sw / block))
    const th = Math.max(1, Math.ceil(sh / block))
    const tiny = document.createElement('canvas')
    tiny.width = tw
    tiny.height = th
    tiny.getContext('2d')!.drawImage(src, sx, sy, sw, sh, 0, 0, tw, th)
    ctx.imageSmoothingEnabled = false
    ctx.drawImage(tiny, 0, 0, tw, th, 0, 0, tw * block, th * block)
  } else {
    // Draw a margin around the area so the blur doesn't fade to transparent at the edges.
    const radius = Math.round(10 * scale)
    ctx.filter = `blur(${radius}px)`
    const m = radius * 2
    ctx.drawImage(src, sx - m, sy - m, sw + m * 2, sh + m * 2, -m, -m, sw + m * 2, sh + m * 2)
  }
  return out
}
