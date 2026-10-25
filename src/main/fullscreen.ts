import { nativeImage, screen, type Display, type Rectangle } from 'electron'
import type { CaptureDoc } from '@shared/ipc'
import { grabScreens } from './capture'
import { addToHistory } from './history'
import { rememberArea } from './lastArea'
import { log } from './log'
import { decorateCapture, isCapturing } from './overlay'
import { createThumb, linkThumbToHistory } from './pin'
import { copyPng } from './output'
import { getSettings } from './settings'

/** Full-screen captures don't have an overlay session; they get their own ids (negative, so they never clash). */
let nextId = -1

/**
 * Capture the whole screen under the pointer, no overlay: it goes straight to
 * the floating preview (copy / edit / pin from there) and into history, and
 * optionally to the clipboard.
 *
 * Starts synchronously (see capture() in index.ts): called from the hotkey.
 */
export function captureFullScreen(t0 = Date.now()) {
  captureRect(screen.getDisplayNearestPoint(screen.getCursorScreenPoint()), null, t0)
}

/**
 * Capture `rect` (screen points on `display`) or, with null, the whole display,
 * without capture mode. An area ("Capture last area", copied right away) goes to
 * the clipboard, and to the floating preview when that's on; the whole screen
 * always gets the preview and is copied only with "Copy full-screen captures".
 */
export function captureRect(display: Display, rect: Rectangle | null, t0 = Date.now()) {
  if (isCapturing()) return
  const kind = rect ? 'last area' : 'fullscreen'
  void grabScreens([display])
    .then(async ([grab]) => {
      let png = await grab.png()
      let { width, height } = grab
      if (rect) {
        const k = grab.width / display.bounds.width // image px per screen point
        const crop = { x: Math.round(rect.x * k), y: Math.round(rect.y * k), width: Math.round(rect.width * k), height: Math.round(rect.height * k) }
        const img = nativeImage.createFromBuffer(png).crop(crop)
        png = img.toPNG()
        ;({ width, height } = img.getSize())
      }
      rememberArea(display, rect ?? { x: 0, y: 0, width: display.bounds.width, height: display.bounds.height })
      // "Background on by default" applies here too, as it does when copying an area. The plain
      // screenshot and the background stay in the document, so Edit can still change it.
      const decorated = await decorateCapture(png, display.scaleFactor)
      const final = decorated?.png ?? png
      const img = nativeImage.createFromBuffer(final)
      const doc: CaptureDoc = { png: new Uint8Array(png), width, height, scale: display.scaleFactor, shapes: [], beautify: decorated?.beautify ?? null }
      const settings = getSettings()
      if (rect || settings.capture.fullscreenCopy) void copyPng(final, { scale: display.scaleFactor })
      const id = nextId--
      const where = rect ? { x: display.bounds.x + rect.x, y: display.bounds.y + rect.y, width: rect.width, height: rect.height } : display.bounds
      if (!rect || settings.pin.afterCopy) createThumb(final, doc, where, id)
      log(`[${kind}] ${width}x${height}${decorated ? ' with background' : ''} in ${Date.now() - t0}ms`)
      const size = img.getSize()
      const thumb = img.resize({ width: Math.min(320, size.width), quality: 'good' }).toJPEG(80)
      const historyId = await addToHistory({ session: id, final: new Uint8Array(final), doc, thumb: new Uint8Array(thumb) })
      if (historyId) linkThumbToHistory(id, historyId)
    })
    .catch((err) => log(`[${kind}] capture failed`, err))
}
