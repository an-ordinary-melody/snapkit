import type { Display } from 'electron'
import type { CaptureEngine, ScreenGrab } from './types'

/**
 * node-screenshots (Rust, xcap): CoreGraphics on macOS, DXGI/GDI on Windows,
 * X11/Wayland on Linux. Fast (~20–100 ms per display) and returns raw RGBA.
 */
type NativeMonitor = {
  x(): number
  y(): number
  captureImage(): Promise<{ width: number; height: number; toRaw(copy?: boolean): Promise<Buffer>; toPng(copy?: boolean): Promise<Buffer> }>
}

let lib: { Monitor: { all(): NativeMonitor[] } } | null | undefined

function load() {
  if (lib !== undefined) return lib
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    lib = require('node-screenshots')
  } catch {
    lib = null
  }
  return lib
}

/**
 * Pair an Electron display with the native monitor at the same position.
 * macOS reports positions in points (same as Electron); Windows reports
 * physical pixels, so also compare against the scaled position.
 */
function matchMonitor(display: Display, monitors: NativeMonitor[]): NativeMonitor | undefined {
  let best: NativeMonitor | undefined
  let bestScore = Infinity
  for (const m of monitors) {
    const s = display.scaleFactor
    const { x, y } = display.bounds
    const score = Math.min(Math.hypot(m.x() - x, m.y() - y), Math.hypot(m.x() - x * s, m.y() - y * s))
    if (score < bestScore) {
      bestScore = score
      best = m
    }
  }
  return best
}

export const nodeScreenshots: CaptureEngine = {
  id: 'node-screenshots',
  label: 'Native (node-screenshots)',
  platforms: ['darwin', 'win32', 'linux'],
  available: () => !!load(),
  warmUp: () => void load(),
  async grab(displays) {
    const native = load()
    if (!native) throw new Error('node-screenshots is not available')
    const monitors = native.Monitor.all()
    return Promise.all(
      displays.map(async (display): Promise<ScreenGrab> => {
        const m = matchMonitor(display, monitors)
        if (!m) throw new Error(`no native monitor for display ${display.id}`)
        const img = await m.captureImage()
        return {
          display,
          width: img.width,
          height: img.height,
          pixels: async () => {
            const raw = await img.toRaw()
            return new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength)
          },
          png: () => img.toPng() // encoded in Rust, off the main thread
        }
      })
    )
  }
}
