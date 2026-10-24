import type { Settings, SettingsPatch } from './settings'

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
  /** Set when this came from history: outputs update that entry instead of adding one. */
  historyId?: string
}

/** Everything history keeps for one output (sent after the copy/save, so it never delays it). */
export interface HistoryRecord {
  session: number
  /** The output as copied/saved (drawings and background baked in). */
  final: Uint8Array
  doc: CaptureDoc
  /** Small JPEG for the panel. */
  thumb: Uint8Array
}

/** What the history panel lists. */
export interface HistoryItem {
  id: string
  updatedAt: number
  width: number
  height: number
  bytes: number
  starred: boolean
}

export interface LoginItemState {
  enabled: boolean
  /** macOS: turned on, but waiting for approval in System Settings → Login Items. */
  needsApproval: boolean
}

export interface UpdateCheck {
  status: 'available' | 'latest' | 'unavailable' | 'error'
  current: string
  version?: string
  /** The installer for this OS (or the release page). */
  url?: string
  page?: string
  message?: string
}

export interface HistoryUsage {
  count: number
  bytes: number
  folder: string
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
  appearance: Settings['appearance']
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
  activity: 'overlay:activity',
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
  thumbPin: 'thumb:pin',
  // history
  historyAdd: 'history:add',
  historyList: 'history:list',
  historyChanged: 'history:changed',
  historyThumb: 'history:thumb',
  historyAction: 'history:action',
  historyClear: 'history:clear',
  historyUsage: 'history:usage',
  historyReveal: 'history:reveal',
  historyDragOut: 'history:drag-out',
  historyClose: 'history:close',
  // system
  loginItemGet: 'system:login-item-get',
  loginItemSet: 'system:login-item-set',
  updatesCheck: 'system:updates-check',
  updatesLast: 'system:updates-last',
  openUrl: 'system:open-url',
  // settings window
  openSettings: 'settings:open',
  settingsGet: 'settings:get',
  settingsUpdate: 'settings:update',
  settingsReset: 'settings:reset',
  settingsChanged: 'settings:changed',
  settingsSetHotkey: 'settings:set-hotkey',
  settingsChooseFolder: 'settings:choose-folder',
  settingsReveal: 'settings:reveal'
} as const

/** What the settings window gets on load and after every change. */
export interface SettingsSnapshot {
  settings: Settings
  defaults: Settings
  version: string
  /** Where captures are saved when no folder is set. */
  defaultSaveFolder: string
  /** Screen capture engines for this OS, in the order Auto tries them. */
  engines: { id: string; label: string; available: boolean }[]
}

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
  /** Input happened in capture mode (pushes the idle timeout back). */
  activity(session: number): void
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

  // History
  /** After a copy/save/pin: keep this output in history. */
  historyAdd(record: HistoryRecord): void
  historyList(): Promise<HistoryItem[]>
  onHistoryChanged(cb: (items: HistoryItem[]) => void): void
  historyThumb(id: string): Promise<Uint8Array | null>
  historyAction(id: string, action: 'copy' | 'edit' | 'pin' | 'save' | 'delete' | 'star' | 'unstar'): void
  historyClear(keepStarred: boolean): Promise<HistoryUsage>
  historyUsage(): Promise<HistoryUsage>
  historyReveal(): void
  /** Drag an entry into another app as a PNG file. Call from dragstart. */
  historyDragOut(id: string): void
  /** Close the history panel. */
  historyClose(): void

  // System
  loginItemGet(): Promise<LoginItemState>
  loginItemSet(enabled: boolean): Promise<LoginItemState>
  updatesCheck(): Promise<UpdateCheck>
  updatesLast(): Promise<UpdateCheck | null>
  /** Open one of Snapkit's own links: the update download, its release page, or macOS Login Items settings. */
  openUrl(which: 'update' | 'release' | 'login-items'): void

  // Settings window
  openSettings(): void
  settingsGet(): Promise<SettingsSnapshot>
  settingsUpdate(patch: SettingsPatch): Promise<SettingsSnapshot>
  /** Back to the defaults for these sections (all if none). */
  settingsReset(sections?: (keyof Settings)[]): Promise<SettingsSnapshot>
  onSettingsChanged(cb: (s: SettingsSnapshot) => void): void
  /** Change a hotkey; resolves to an error message if it can't be used. '' turns the history hotkey off. */
  settingsSetHotkey(accelerator: string, name?: 'capture' | 'history' | 'fullscreen' | 'settings'): Promise<string | null>
  /** Pick a folder; null if cancelled. */
  settingsChooseFolder(): Promise<string | null>
  /** Show the log folder or the settings file in Finder / Explorer. */
  settingsReveal(what: 'logs' | 'settings'): void
}
