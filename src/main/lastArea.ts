import { app, screen, type Display, type Rectangle } from 'electron'
import { readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { log } from './log'

/** The last area copied or saved (a full-screen capture counts as the whole display), for "Capture last area". */
export interface LastArea {
  displayId: number
  /** That display's bounds then: finds it again when its id changes (e.g. after a restart on Windows). */
  displayBounds: Rectangle
  /** The area, in screen points from the display's top-left corner. */
  rect: Rectangle
}

const file = () => join(app.getPath('userData'), 'last-area.json')
let last: LastArea | null | undefined

function load(): LastArea | null {
  if (last !== undefined) return last
  try {
    const v = JSON.parse(readFileSync(file(), 'utf8'))
    last = v && typeof v.displayId === 'number' && v.rect && v.displayBounds ? v : null
  } catch {
    last = null
  }
  return last ?? null
}

export function rememberArea(display: Display, rect: Rectangle) {
  const r = { x: rect.x, y: rect.y, width: rect.width, height: rect.height } // not rounded: 125% / 150% screens have fractional points
  if (r.width < 1 || r.height < 1) return
  last = { displayId: display.id, displayBounds: display.bounds, rect: r }
  try {
    writeFileSync(file(), JSON.stringify(last))
  } catch (err) {
    log('[last area] couldn\'t save it:', String(err))
  }
}

const same = (a: Rectangle, b: Rectangle) => a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height

/** The last area and its display, if that display is still connected; null: capture as usual. */
export function lastArea(): { display: Display; rect: Rectangle } | null {
  const a = load()
  if (!a) return null
  const displays = screen.getAllDisplays()
  const display = displays.find((d) => d.id === a.displayId) ?? displays.find((d) => same(d.bounds, a.displayBounds))
  if (!display) return null
  // Keep its corner on the display (its resolution may have changed since). Capture mode trims the
  // size to its window: the display's size here is rounded and can be a point short.
  const x = Math.min(Math.max(0, a.rect.x), display.bounds.width - 1)
  const y = Math.min(Math.max(0, a.rect.y), display.bounds.height - 1)
  return { display, rect: { ...a.rect, x, y } }
}
