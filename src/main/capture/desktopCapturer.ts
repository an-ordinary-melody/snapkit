import { desktopCapturer } from 'electron'
import type { CaptureEngine } from './types'

/** Electron's desktopCapturer: always there, but slower (hundreds of ms) and BGRA, so it's the fallback. */
export const electronCapturer: CaptureEngine = {
  id: 'desktop-capturer',
  label: 'Electron (desktopCapturer)',
  platforms: ['darwin', 'win32', 'linux'],
  available: () => true,
  async grab(displays) {
    const maxW = Math.max(...displays.map((d) => Math.round(d.bounds.width * d.scaleFactor)))
    const maxH = Math.max(...displays.map((d) => Math.round(d.bounds.height * d.scaleFactor)))
    const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: maxW, height: maxH } })
    return displays.map((display, i) => {
      const src = sources.find((s) => s.display_id === String(display.id)) ?? sources[i]
      if (!src) throw new Error(`no capture source for display ${display.id}`)
      const img = src.thumbnail
      const { width, height } = img.getSize()
      return {
        display,
        width,
        height,
        pixels: async () => {
          // nativeImage bitmaps are BGRA; the overlay expects RGBA.
          const bgra = img.toBitmap()
          const rgba = new Uint8Array(bgra.length)
          for (let p = 0; p < bgra.length; p += 4) {
            rgba[p] = bgra[p + 2]
            rgba[p + 1] = bgra[p + 1]
            rgba[p + 2] = bgra[p]
            rgba[p + 3] = 255
          }
          return rgba
        },
        png: async () => img.toPNG()
      }
    })
  }
}
