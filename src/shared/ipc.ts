import type { CompressPreset, Settings, SettingsPatch } from './settings'

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
/** How the editor wants this output compressed: its Compress switch and preset, and image px per screen point. */
export interface OutputOptions {
  compress: boolean
  preset: CompressPreset
  scale: number
  /** The selection in overlay CSS px, remembered for "Capture last area" (not sent when editing a stored capture). */
  area?: { x: number; y: number; w: number; h: number }
}

/** One line of recognized text; its box is in fractions of the image (top-left origin). */
export interface OcrLine {
  text: string
  x: number
  y: number
  w: number
  h: number
}

export interface OcrResult {
  lines: OcrLine[]
  /** The engine that read it (e.g. vision, windows). */
  engine: string
  ms: number
}

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
  /** "Capture last area": start with this area selected (CSS px on this display). */
  area?: { x: number; y: number; w: number; h: number }
  /** "Capture text": the area drawn is read right away (no editing step), then shown or copied per ocr.textButton. */
  textOnly?: boolean
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
  /** Main → capture page: draw the default background around a full-screen capture; the page answers with `decorated`. */
  /** Windows: main asks the page to draw a frame now that its window is shown; the page answers with `frameReady`. */
  frame: 'overlay:frame',
  frameReady: 'overlay:frame-ready',
  decorate: 'overlay:decorate',
  decorated: 'overlay:decorated',
  selectionStarted: 'overlay:selection-started',
  activity: 'overlay:activity',
  copy: 'capture:copy',
  save: 'capture:save',
  cancel: 'capture:cancel',
  editDone: 'capture:edit-done',
  readImage: 'beautify:read-image',
  compressedSize: 'capture:compressed-size',
  ocr: 'capture:ocr',
  copyText: 'capture:copy-text',
  // main -> pin
  pinImage: 'pin:image',
  pinState: 'pin:state',
  // pin -> main
  pinReady: 'pin:ready',
  pinMoveBy: 'pin:move-by',
  pinZoom: 'pin:zoom',
  pinOpacity: 'pin:opacity',
  pinCopy: 'pin:copy',
  pinCopyText: 'pin:copy-text',
  historyCopyText: 'history:copy-text',
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
  appearanceChanged: 'appearance:changed',
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
  /** Text recognition engines for this OS. */
  ocrEngines: { id: string; label: string; available: boolean }[]
  /** Windows: whether Vietnamese is read now (the ocr.vietnamese setting, with 'auto' resolved). Null elsewhere. */
  ocrVietnamese: boolean | null
  /** Hotkeys another app holds right now (Snapkit takes them once they're free). */
  hotkeysTaken: ('capture' | 'history' | 'fullscreen' | 'settings' | 'lastArea' | 'ocr')[]
}

/** A full-screen capture to put on the default background (see captureFullScreen). */
export interface DecorateRequest {
  id: number
  png: Uint8Array
  /** Image px per screen px. */
  scale: number
  settings: Settings
}

/** The capture on its background, and the background state (kept in the history entry, so Edit can change it). */
export interface DecorateResult {
  png: Uint8Array
  beautify: unknown
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
  /** Full-screen capture with "Background on by default": draw the background (capture page only). */
  /** Windows: draw a frame, then answer (see startCapture). */
  onFrame(cb: (session: number) => void): void
  frameReady(session: number): void
  onDecorate(cb: (p: DecorateRequest) => void): void
  decorated(id: number, result: DecorateResult | null): void
  selectionStarted(session: number): void
  /** Input happened in capture mode (pushes the idle timeout back). */
  activity(session: number): void
  /** Copy the output; with `extra`, a floating preview stays afterwards (or, when editing one, it's updated). */
  copy(session: number, png: ArrayBuffer, extra: CopyExtra | undefined, out: OutputOptions): void
  save(session: number, png: ArrayBuffer, out: OutputOptions): void
  cancel(session: number): void
  /** Leaving the editor while editing a floating preview: keep the edits there. */
  editDone(session: number, png: ArrayBuffer, doc: CaptureDoc): void
  /** Bytes of a local image file (for image backgrounds), or null if it can't be read. */
  readImage(path: string): Promise<Uint8Array | null>
  /** Byte size of `png` after compressing it with `preset` (for the editor's size estimate). */
  compressedSize(png: ArrayBuffer, scale: number, preset: CompressPreset): Promise<number>
  /** The text in a PNG, or an error message when it can't be read. */
  ocr(png: ArrayBuffer): Promise<OcrResult | { error: string }>
  /** Copy text and close capture mode (after `closeAfterMs`, so a message can show first). */
  copyText(session: number, text: string, closeAfterMs?: number): void

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
  /** Copy the text in the image: lines copied (0 = none found, -1 = couldn't read it). */
  pinCopyText(): Promise<number>
  /** Copy the text in a history entry: lines copied (0 = none found, -1 = couldn't read it). */
  historyCopyText(id: string): Promise<number>
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
  /** Theme changes (light/dark, Liquid Glass, accent), for windows that are already open. */
  onAppearance(cb: (a: Settings['appearance']) => void): void
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
  settingsSetHotkey(accelerator: string, name?: 'capture' | 'history' | 'fullscreen' | 'settings' | 'lastArea' | 'ocr'): Promise<string | null>
  /** Pick a folder; null if cancelled. */
  settingsChooseFolder(): Promise<string | null>
  /** Show the log folder or the settings file in Finder / Explorer. */
  settingsReveal(what: 'logs' | 'settings'): void
}
