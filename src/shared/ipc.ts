import type { Settings } from './settings'

/** Sent from main to an overlay window when capture mode starts. */
export interface CaptureStartPayload {
  /** Capture session id; replies must echo it so stale replies are ignored. */
  session: number
  displayId: number
  /** Raw RGBA pixels of the frozen screen. */
  pixels: Uint8Array
  width: number
  height: number
  settings: Settings
}

export const IPC = {
  // main -> overlay
  captureStart: 'capture:start',
  clearSelection: 'overlay:clear-selection',
  reset: 'overlay:reset',
  // overlay -> main
  ready: 'overlay:ready',
  selectionStarted: 'overlay:selection-started',
  copy: 'capture:copy',
  save: 'capture:save',
  cancel: 'capture:cancel'
} as const

/** API exposed to renderers by the preload script (window.snapkit). */
export interface SnapkitApi {
  platform: string
  onCaptureStart(cb: (p: CaptureStartPayload) => void): void
  onClearSelection(cb: () => void): void
  onReset(cb: () => void): void
  ready(session: number): void
  selectionStarted(session: number): void
  copy(session: number, png: ArrayBuffer): void
  save(session: number, png: ArrayBuffer): void
  cancel(session: number): void
}
