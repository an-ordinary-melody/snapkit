import type { BrowserWindow } from 'electron'
import { log } from './log'

/** DwmSetWindowAttribute(hwnd, attribute, &value, sizeof value), loaded on first use (Windows only). */
type SetWindowAttribute = (hwnd: bigint, attribute: number, value: number[], size: number) => number
let setWindowAttribute: SetWindowAttribute | null | undefined
let loggedOnce = false

/** Windows' DWMWA_TRANSITIONS_FORCEDISABLED: no open/close animation for that window. */
const TRANSITIONS_FORCEDISABLED = 3

/**
 * Windows animates a window each time it's shown: it fades in while growing
 * from about 95% of its size. For capture mode's full-screen window that
 * leaves the screen's edges uncovered for a moment, which looks like a flash.
 * Windows lets a program turn that off per window; Electron has no API for
 * it, so call Windows directly (through koffi). Does nothing on macOS.
 */
export function disableWindowAnimations(win: BrowserWindow) {
  if (process.platform !== 'win32') return
  try {
    if (setWindowAttribute === undefined) {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const koffi = require('koffi')
      const dwm = koffi.load('dwmapi.dll')
      setWindowAttribute = dwm.func('long __stdcall DwmSetWindowAttribute(intptr_t hwnd, uint32_t attr, _In_ int32_t *value, uint32_t size)')
    }
    if (!setWindowAttribute) return
    const hwnd = win.getNativeWindowHandle().readBigInt64LE(0)
    const result = setWindowAttribute(hwnd, TRANSITIONS_FORCEDISABLED, [1], 4)
    if (result !== 0) log(`[window] couldn't turn off Windows' show animation (DwmSetWindowAttribute returned ${result})`)
    else if (!loggedOnce) {
      loggedOnce = true
      log('[window] Windows show animation off for capture windows')
    }
  } catch (err) {
    setWindowAttribute = null // don't retry for every window
    log('[window] couldn\'t turn off Windows\' show animation:', String(err))
  }
}
