import type { BeautifyBackground } from '@shared/settings'
import { beautifyLayout, gradientLine, type BeautifyState } from './layout'

const images = new Map<string, Promise<HTMLImageElement | null>>()

/** Image backgrounds are local files, read by the main process. Cached per path. */
export function loadBackgroundImage(path: string): Promise<HTMLImageElement | null> {
  let p = images.get(path)
  if (!p) {
    p = window.snapkit.readImage(path).then(
      (bytes) =>
        new Promise<HTMLImageElement | null>((resolve) => {
          if (!bytes) return resolve(null)
          const img = new Image()
          img.onload = () => resolve(img)
          img.onerror = () => resolve(null)
          img.src = URL.createObjectURL(new Blob([bytes as BlobPart]))
        })
    )
    images.set(path, p)
  }
  return p
}

function paintBackground(ctx: CanvasRenderingContext2D, bg: BeautifyBackground, w: number, h: number, image: HTMLImageElement | null) {
  if (bg.type === 'solid') {
    ctx.fillStyle = bg.color
    ctx.fillRect(0, 0, w, h)
  } else if (bg.type === 'gradient') {
    const g = ctx.createLinearGradient(...gradientLine(w, h, bg.angle))
    g.addColorStop(0, bg.from)
    g.addColorStop(1, bg.to)
    ctx.fillStyle = g
    ctx.fillRect(0, 0, w, h)
  } else if (image) {
    // Cover: fill the whole area, cropping the image's overflow.
    const s = Math.max(w / image.naturalWidth, h / image.naturalHeight)
    const iw = image.naturalWidth * s
    const ih = image.naturalHeight * s
    ctx.drawImage(image, (w - iw) / 2, (h - ih) / 2, iw, ih)
  } else {
    ctx.fillStyle = '#e5e7eb' // image missing
    ctx.fillRect(0, 0, w, h)
  }
}

/**
 * The screenshot on its background with padding, rounded corners and a shadow.
 * `scale`: image px per screen px of `src`. With no padding, only the corners
 * are rounded (transparent outside).
 */
export function drawBeautified(
  src: HTMLCanvasElement,
  bg: BeautifyBackground,
  state: Pick<BeautifyState, 'padding' | 'radius' | 'shadow'>,
  scale: number,
  image: HTMLImageElement | null,
  out = document.createElement('canvas')
): HTMLCanvasElement {
  const l = beautifyLayout(src.width, src.height, state, scale)
  out.width = l.width
  out.height = l.height
  const ctx = out.getContext('2d')!
  if (l.x > 0) paintBackground(ctx, bg, l.width, l.height, image)

  const shape = () => {
    ctx.beginPath()
    ctx.roundRect(l.x, l.y, src.width, src.height, l.radius)
  }
  if (l.shadowBlur > 0) {
    ctx.save()
    ctx.shadowColor = `rgba(0,0,0,${l.shadowAlpha})`
    ctx.shadowBlur = l.shadowBlur
    ctx.shadowOffsetY = l.shadowOffsetY
    shape()
    ctx.fillStyle = '#000'
    ctx.fill()
    ctx.restore()
  }
  ctx.save()
  shape()
  ctx.clip()
  ctx.drawImage(src, l.x, l.y)
  ctx.restore()
  return out
}

export async function renderBeautified(src: HTMLCanvasElement, bg: BeautifyBackground, state: BeautifyState, scale: number) {
  const image = bg.type === 'image' ? await loadBackgroundImage(bg.path) : null
  return drawBeautified(src, bg, state, scale, image)
}
