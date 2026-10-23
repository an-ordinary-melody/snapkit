import type { Display } from 'electron'

/** One display's frozen screenshot. */
export interface ScreenGrab {
  display: Display
  /** Image size in pixels. */
  width: number
  height: number
  /** RGBA pixels. Converted lazily so the overlay can appear before this work is done. */
  pixels(): Promise<Uint8Array>
}

/**
 * A way to grab the screens. Engines are swappable: each OS has a preferred
 * order (see ./index.ts), a failing engine falls back to the next, and the
 * capture.engine setting can force one. A new engine (e.g. a ScreenCaptureKit
 * or DXGI addon) only needs to implement this.
 */
export interface CaptureEngine {
  id: string
  label: string
  /** Platforms it can run on (process.platform values). */
  platforms: NodeJS.Platform[]
  /** Loaded and usable on this machine (may load a native module the first time). */
  available(): boolean
  /** Do slow one-time setup early so the first capture is fast. */
  warmUp?(): void
  /** Grab every display, as fast as possible. Throws if it can't. */
  grab(displays: Display[]): Promise<ScreenGrab[]>
}
