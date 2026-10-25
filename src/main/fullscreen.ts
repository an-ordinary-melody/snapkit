import { clipboard, nativeImage, screen } from 'electron'
import type { CaptureDoc } from '@shared/ipc'
import { grabScreens } from './capture'
import { addToHistory } from './history'
import { log } from './log'
import { decorateCapture, isCapturing } from './overlay'
import { createThumb, linkThumbToHistory } from './pin'
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
  if (isCapturing()) return
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
  void grabScreens([display])
    .then(async ([grab]) => {
      const png = await grab.png()
      // "Background on by default" applies here too, as it does when copying an area. The plain
      // screenshot and the background stay in the document, so Edit can still change it.
      const decorated = await decorateCapture(png, display.scaleFactor)
      const final = decorated?.png ?? png
      const img = nativeImage.createFromBuffer(final)
      const doc: CaptureDoc = { png: new Uint8Array(png), width: grab.width, height: grab.height, scale: display.scaleFactor, shapes: [], beautify: decorated?.beautify ?? null }
      if (getSettings().capture.fullscreenCopy) clipboard.writeImage(img)
      const id = nextId--
      createThumb(final, doc, display.bounds, id)
      log(`[fullscreen] ${grab.width}x${grab.height}${decorated ? ' with background' : ''} in ${Date.now() - t0}ms`)
      const size = img.getSize()
      const thumb = img.resize({ width: Math.min(320, size.width), quality: 'good' }).toJPEG(80)
      const historyId = await addToHistory({ session: id, final: new Uint8Array(final), doc, thumb: new Uint8Array(thumb) })
      if (historyId) linkThumbToHistory(id, historyId)
    })
    .catch((err) => log('[fullscreen] capture failed', err))
}
