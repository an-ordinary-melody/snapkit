import type { Settings } from './settings'

/**
 * Capture mode starts in two steps so the dim appears instantly:
 *  1. `arm`: sent right after the screen is grabbed. The (transparent) overlay
 *     shows the dim over the live screen, which still looks identical.
 *  2. `pixels`: the frozen image, painted underneath once it has been transferred.
 */
/**
 * Everything needed to reopen a capture in the editor: the plain screenshot
 * crop plus the editing state. Main stores it as-is; the overlay owns the
 * shape of `shapes` and `beautify`.
 */
export interface CaptureDoc {
  /** The screenshot crop without drawings, PNG. */
  png: Uint8Array
  /** Size in image px, and image px per screen point. */
  width: number
  height: number
  scale: number
  shapes: unknown[]
  beautify: unknown
}

/** Sent with a copy when a floating preview should stay afterwards. */
export interface CopyExtra {
  doc: CaptureDoc
  /** The selection, in overlay CSS px. */
  rect: { x: number; y: number; w: number; h: number }
}

export interface ArmPayload {
  /** Capture session id; replies must echo it so stale replies are ignored. */
  session: number
  displayId: number
  /** Image size in pixels. */
  width: number
  height: number
  settings: Settings
  /** Open this capture in the editor instead of starting a new one (no pixels step follows). */
  edit?: CaptureDoc
}

export interface PixelsPayload {
  session: number
  /** Raw RGBA pixels of the frozen screen. */
  pixels: Uint8Array
  width: number
  height: number
}

/** Sent to a pin window once it has loaded. */
export interface PinImagePayload {
  png: Uint8Array
  theme: string
  accent: string
}

/** What a pin window shows in its HUD and menus. */
export interface PinState {
  zoom: number
  opacity: number
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
  editDone: 'capture:edit-done',
  readImage: 'beautify:read-image',
  // main -> pin
  pinImage: 'pin:image',
  pinState: 'pin:state',
  // pin -> main
  pinReady: 'pin:ready',
  pinMoveBy: 'pin:move-by',
  pinZoom: 'pin:zoom',
  pinOpacity: 'pin:opacity',
  pinCopy: 'pin:copy',
  pinSave: 'pin:save',
  pinClose: 'pin:close',
  pinDragOut: 'pin:drag-out',
  pinMenu: 'pin:menu',
  thumbEdit: 'thumb:edit',
  thumbPin: 'thumb:pin'
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
  /** Copy the output; with `extra`, a floating preview stays afterwards (or, when editing one, it's updated). */
  copy(session: number, png: ArrayBuffer, extra?: CopyExtra): void
  save(session: number, png: ArrayBuffer): void
  cancel(session: number): void
  /** Leaving the editor while editing a floating preview: keep the edits there. */
  editDone(session: number, png: ArrayBuffer, doc: CaptureDoc): void
  /** Bytes of a local image file (for image backgrounds), or null if it can't be read. */
  readImage(path: string): Promise<Uint8Array | null>

  // Pin windows
  onPinImage(cb: (p: PinImagePayload) => void): void
  onPinState(cb: (s: PinState) => void): void
  pinReady(): void
  /** Move the pin window by (dx, dy) screen px. */
  pinMoveBy(dx: number, dy: number): void
  /** Set the zoom (1 = 100%), keeping the point at (ax, ay) — fractions of the window — still. */
  pinZoom(zoom: number, ax: number, ay: number): void
  pinOpacity(opacity: number): void
  pinCopy(): void
  pinSave(): void
  pinClose(): void
  /** Start dragging the image out as a file (call from a dragstart handler). */
  pinDragOut(): void
  pinMenu(): void
  /** Floating preview: open it in the editor / turn it into a full-size pin. */
  thumbEdit(): void
  thumbPin(): void
}
