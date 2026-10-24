import { screen } from 'electron'
import { log } from '../log'
import { electronCapturer } from './desktopCapturer'
import { nodeScreenshots } from './nodeScreenshots'
import { orderEngines } from './order'
import type { CaptureEngine, ScreenGrab } from './types'

export type { ScreenGrab } from './types'

/** Every engine Snapkit knows. Add new ones here. */
export const ENGINES: CaptureEngine[] = [nodeScreenshots, electronCapturer]

let preferred = 'auto'

/** 'auto' (the OS order) or an engine id from the capture.engine setting. */
export function setPreferredEngine(id: string) {
  preferred = id
}

/** Engines to try, in order, for this OS and setting. */
export function engineOrder(platform: string = process.platform, choice = preferred): CaptureEngine[] {
  return orderEngines(ENGINES, platform, choice)
}

/** For the settings window: every engine for this OS and whether it can run here. */
export function engineInfo() {
  return engineOrder(process.platform, 'auto').map((e) => ({ id: e.id, label: e.label, available: e.available() }))
}

/** Load the first engine ahead of time so the first capture isn't slowed by it. */
export function warmUpCapture() {
  engineOrder().find((e) => e.available())?.warmUp?.()
}

/** Freeze every screen right now, with the first engine that works. */
export function grabAllScreens(): Promise<ScreenGrab[]> {
  return grabScreens(screen.getAllDisplays())
}

/** Freeze these displays, with the first engine that works. */
export async function grabScreens(displays: Electron.Display[]): Promise<ScreenGrab[]> {
  let lastError: unknown
  for (const engine of engineOrder()) {
    if (!engine.available()) continue
    const t0 = Date.now()
    try {
      const grabs = await engine.grab(displays)
      log(`[capture] ${engine.id}: ${grabs.length} display(s) in ${Date.now() - t0}ms`)
      return grabs
    } catch (err) {
      lastError = err
      log(`[capture] ${engine.id} failed, trying the next engine`, err)
    }
  }
  throw lastError ?? new Error('no capture engine available')
}
