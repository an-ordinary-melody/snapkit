import { desktopCapturer, screen, type Display } from 'electron'

export interface ScreenGrab {
  display: Display
  pixels: Uint8Array // RGBA
  width: number
  height: number
}

type NativeMonitor = {
  x(): number
  y(): number
  scaleFactor(): number
  captureImage(): Promise<{ width: number; height: number; toRaw(copy?: boolean): Promise<Buffer> }>
}

let native: { Monitor: { all(): NativeMonitor[] } } | null | undefined

function loadNative() {
  if (native !== undefined) return native
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    native = require('node-screenshots')
  } catch (err) {
    console.warn('[capture] node-screenshots unavailable, falling back to desktopCapturer', err)
    native = null
  }
  return native
}

/**
 * Pair each Electron display with the native monitor at the same position.
 * macOS reports positions in points (same as Electron); Windows reports
 * physical pixels, so we also compare against the scaled position.
 */
function matchMonitor(display: Display, monitors: NativeMonitor[]): NativeMonitor | undefined {
  let best: NativeMonitor | undefined
  let bestScore = Infinity
  for (const m of monitors) {
    const mx = m.x()
    const my = m.y()
    const s = display.scaleFactor
    const { x, y } = display.bounds
    const score = Math.min(Math.hypot(mx - x, my - y), Math.hypot(mx - x * s, my - y * s))
    if (score < bestScore) {
      bestScore = score
      best = m
    }
  }
  return best
}

async function grabNative(displays: Display[]): Promise<ScreenGrab[] | null> {
  const lib = loadNative()
  if (!lib) return null
  const monitors = lib.Monitor.all()
  const grabs = await Promise.all(
    displays.map(async (display) => {
      const m = matchMonitor(display, monitors)
      if (!m) throw new Error(`no native monitor for display ${display.id}`)
      const img = await m.captureImage()
      const raw = await img.toRaw()
      return { display, pixels: new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength), width: img.width, height: img.height }
    })
  )
  return grabs
}

async function grabElectron(displays: Display[]): Promise<ScreenGrab[]> {
  const maxW = Math.max(...displays.map((d) => Math.round(d.bounds.width * d.scaleFactor)))
  const maxH = Math.max(...displays.map((d) => Math.round(d.bounds.height * d.scaleFactor)))
  const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: maxW, height: maxH } })
  return displays.map((display, i) => {
    const src = sources.find((s) => s.display_id === String(display.id)) ?? sources[i]
    const img = src.thumbnail
    const { width, height } = img.getSize()
    const bgra = img.toBitmap()
    // nativeImage bitmaps are BGRA; the overlay expects RGBA.
    const rgba = new Uint8Array(bgra.length)
    for (let p = 0; p < bgra.length; p += 4) {
      rgba[p] = bgra[p + 2]
      rgba[p + 1] = bgra[p + 1]
      rgba[p + 2] = bgra[p]
      rgba[p + 3] = 255
    }
    return { display, pixels: rgba, width, height }
  })
}

/** Freeze every screen right now. */
export async function grabAllScreens(): Promise<ScreenGrab[]> {
  const displays = screen.getAllDisplays()
  const t0 = Date.now()
  try {
    const grabs = await grabNative(displays)
    if (grabs) {
      console.log(`[capture] native grab of ${grabs.length} display(s) in ${Date.now() - t0}ms`)
      return grabs
    }
  } catch (err) {
    console.warn('[capture] native grab failed, falling back', err)
  }
  const grabs = await grabElectron(displays)
  console.log(`[capture] electron grab of ${grabs.length} display(s) in ${Date.now() - t0}ms`)
  return grabs
}
