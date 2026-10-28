import type { Rect } from '../layout'

/**
 * Pixelated or blurred copy of part of the frozen screenshot, at full image
 * resolution. `scale` converts overlay px to image px; `strength` is the pixel
 * block size / blur radius in overlay px (0: the area as it is, unblurred).
 */
export function obscure(src: HTMLCanvasElement, r: Rect, scale: number, mode: 'pixelate' | 'blur', strength: number): HTMLCanvasElement {
  const sx = Math.round(r.x * scale)
  const sy = Math.round(r.y * scale)
  const sw = Math.max(1, Math.round(r.w * scale))
  const sh = Math.max(1, Math.round(r.h * scale))
  const out = document.createElement('canvas')
  out.width = sw
  out.height = sh
  const ctx = out.getContext('2d')!

  const amount = Math.round(strength * scale)
  if (amount <= 0) {
    ctx.drawImage(src, sx, sy, sw, sh, 0, 0, sw, sh)
  } else if (mode === 'pixelate') {
    // Shrink, then scale back up without smoothing.
    const block = Math.max(2, amount)
    const tw = Math.max(1, Math.ceil(sw / block))
    const th = Math.max(1, Math.ceil(sh / block))
    const tiny = shrink(src, sx, sy, sw, sh, tw, th)
    ctx.imageSmoothingEnabled = false
    ctx.drawImage(tiny, 0, 0, tw, th, 0, 0, tw * block, th * block)
  } else {
    // Draw a margin around the area so the blur doesn't fade to transparent at the edges.
    const radius = Math.max(1, Math.round(strength * 0.8 * scale))
    ctx.filter = `blur(${radius}px)`
    const m = radius * 2
    ctx.drawImage(src, sx - m, sy - m, sw + m * 2, sh + m * 2, -m, -m, sw + m * 2, sh + m * 2)
  }
  return out
}

/**
 * Downscale by halving steps so each output pixel averages its whole block.
 * A single drawImage samples only a few pixels, which loses thin text and
 * makes big blocks look blank.
 */
function shrink(src: CanvasImageSource, sx: number, sy: number, sw: number, sh: number, tw: number, th: number): HTMLCanvasElement {
  let cur: CanvasImageSource = src
  let [cx, cy, cw, ch] = [sx, sy, sw, sh]
  for (;;) {
    const nw = Math.max(tw, Math.ceil(cw / 2))
    const nh = Math.max(th, Math.ceil(ch / 2))
    const c = document.createElement('canvas')
    c.width = nw
    c.height = nh
    const g = c.getContext('2d')!
    g.imageSmoothingQuality = 'high'
    g.drawImage(cur, cx, cy, cw, ch, 0, 0, nw, nh)
    if (nw === tw && nh === th) return c
    cur = c
    ;[cx, cy, cw, ch] = [0, 0, nw, nh]
  }
}
