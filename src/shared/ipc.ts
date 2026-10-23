import type { Settings } from './settings'

/**
 * Capture mode starts in two steps so the dim appears instantly:
 *  1. `arm`: sent right after the screen is grabbed. The (transparent) overlay
 *     shows the dim over the live screen, which still looks identical.
 *  2. `pixels`: the frozen image, painted underneath once it has been transferred.
 */
export interface ArmPayload {
  /** Capture session id; replies must echo it so stale replies are ignored. */
  session: number
  displayId: number
  /** Image size in pixels. */
  width: number
  height: number
  settings: Settings
}

export interface PixelsPayload {
  session: number
  /** Raw RGBA pixels of the frozen screen. */
  pixels: Uint8Array
  width: number
  height: number
}

export const IPC = {
  // main -> overlay
  arm: 'capture:arm',
  pixels: 'capture:pixels',
  clearSelection: 'overlay:clear-selection',
  reset: 'overlay:reset',
  // overlay -> main
  armed: 'overlay:armed',
  painted: 'overlay:painted',
  cleared: 'overlay:cleared',
  selectionStarted: 'overlay:selection-started',
  copy: 'capture:copy',
  save: 'capture:save',
  cancel: 'capture:cancel',
  readImage: 'beautify:read-image'
} as const

/** API exposed to renderers by the preload script (window.snapkit). */
export interface SnapkitApi {
  platform: string
  onArm(cb: (p: ArmPayload) => void): void
  onPixels(cb: (p: PixelsPayload) => void): void
  onClearSelection(cb: () => void): void
  onReset(cb: () => void): void
  armed(session: number): void
  painted(session: number): void
  cleared(): void
  selectionStarted(session: number): void
  copy(session: number, png: ArrayBuffer): void
  save(session: number, png: ArrayBuffer): void
  cancel(session: number): void
  /** Bytes of a local image file (for image backgrounds), or null if it can't be read. */
  readImage(path: string): Promise<Uint8Array | null>
}
