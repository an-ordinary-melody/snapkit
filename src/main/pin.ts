import { app, BrowserWindow, clipboard, Menu, nativeImage, screen, type Rectangle } from 'electron'
import { mkdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { IPC, type CaptureDoc, type PinState } from '@shared/ipc'
import { log } from './log'
import { ipcOn } from './security'
import { savePng, timestampName } from './output'
import { getSettings } from './settings'
import { startEdit } from './overlay'

const isMac = process.platform === 'darwin'

interface Pin {
  /** `pin`: full-size floating screenshot. `thumb`: small floating preview in a corner after copy. */
  kind: 'pin' | 'thumb'
  win: BrowserWindow
  png: Buffer
  /** Thumbs: what the editor reopens, where it was captured, and which display's corner it sits in. */
  doc?: CaptureDoc
  rect?: Rectangle
  displayId?: number
  /** Thumbs: moved by hand, so it's no longer part of the corner stack. */
  moved?: boolean
  /** Size at 100% zoom, in screen points. */
  base: { w: number; h: number }
  zoom: number
  opacity: number
  /** Temp file used when dragging the image into another app. */
  file: string
}

/** Floating screenshots and previews, keyed by their window's webContents id. */
const pins = new Map<number, Pin>()

export const hasPins = () => pins.size > 0

const ZOOM_MIN = 0.1
const ZOOM_MAX = 5
const OPACITY_MIN = 0.15

function load(win: BrowserWindow, view: 'pin' | 'thumb') {
  if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) return win.loadURL(process.env.ELECTRON_RENDERER_URL + '#' + view)
  return win.loadFile(join(__dirname, '../renderer/index.html'), { hash: view })
}

function floatingWindow(bounds: Rectangle) {
  const win = new BrowserWindow({
    ...bounds,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    hasShadow: true,
    roundedCorners: false,
    enableLargerThanScreen: true,
    acceptFirstMouse: true,
    // A panel floats over full-screen apps on macOS.
    ...(isMac ? { type: 'panel' as const } : {}),
    webPreferences: { preload: join(__dirname, '../preload/index.js'), sandbox: true, contextIsolation: true }
  })
  win.setAlwaysOnTop(true, 'floating')
  if (isMac) win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true })
  win.webContents.on('render-process-gone', (_e, d) => log(`[pin] renderer gone: ${d.reason}`))
  win.webContents.on('console-message', (_e, level, message) => level >= 3 && log(`[pin] ${message}`))
  return win
}

/** Temp file used when dragging the image into another app. */
function tempFile(png: Buffer, tag: number) {
  const dir = join(app.getPath('temp'), 'Snapkit')
  mkdirSync(dir, { recursive: true })
  const file = join(dir, timestampName().replace(/\.png$/, ` ${tag}.png`))
  writeFileSync(file, png)
  return file
}

function track(pin: Pin) {
  const id = pin.win.webContents.id
  pins.set(id, pin)
  pin.win.on('closed', () => {
    pins.delete(id)
    rmSync(pin.file, { force: true })
    if (pin.kind === 'thumb') layoutThumbs(pin.displayId)
  })
}

const sendState = (p: Pin) => p.win.webContents.send(IPC.pinState, { zoom: p.zoom, opacity: p.opacity } satisfies PinState)

/**
 * Pin a screenshot to the screen. `at` is where it was captured, in screen
 * points; the pin opens right there at 100%.
 */
export function createPin(png: Buffer, at: Rectangle) {
  const img = nativeImage.createFromBuffer(png)
  const px = img.getSize()
  const display = screen.getDisplayMatching(at)
  // Background/padding can make the image larger than the selection: keep it centered on it.
  const w = Math.max(16, Math.round(px.width / display.scaleFactor))
  const h = Math.max(16, Math.round(px.height / display.scaleFactor))
  const x = Math.round(at.x + at.width / 2 - w / 2)
  const y = Math.round(at.y + at.height / 2 - h / 2)

  const win = floatingWindow({ x, y, width: w, height: h })
  track({ kind: 'pin', win, png, base: { w, h }, zoom: 1, opacity: 1, file: tempFile(png, win.webContents.id) })
  load(win, 'pin')
  log(`pinned ${px.width}x${px.height} at ${x},${y}`)
}

// ---- floating previews (after copy) ------------------------------------------

const THUMB_MAX = { w: 240, h: 160 }
const THUMB_GAP = 10
const THUMB_MARGIN = 16

function thumbSize(png: Buffer) {
  const { width, height } = nativeImage.createFromBuffer(png).getSize()
  const k = Math.min(THUMB_MAX.w / width, THUMB_MAX.h / height, 1)
  return { w: Math.max(60, Math.round(width * k)), h: Math.max(40, Math.round(height * k)) }
}

/** Stack a display's previews in its bottom-right corner, newest at the bottom. */
function layoutThumbs(displayId?: number) {
  const display = screen.getAllDisplays().find((d) => d.id === displayId) ?? screen.getPrimaryDisplay()
  const area = display.workArea
  let bottom = area.y + area.height - THUMB_MARGIN
  const mine = [...pins.values()].filter((p) => p.kind === 'thumb' && !p.moved && p.displayId === displayId && !p.win.isDestroyed())
  for (const p of mine.reverse()) {
    const { w, h } = p.base
    p.win.setBounds({ x: area.x + area.width - THUMB_MARGIN - w, y: bottom - h, width: w, height: h })
    bottom -= h + THUMB_GAP
  }
}

/** After a copy: keep a small preview in the corner of the display it was captured on. */
export function createThumb(png: Buffer, doc: CaptureDoc, rect: Rectangle) {
  const display = screen.getDisplayMatching(rect)
  const size = thumbSize(png)
  const win = floatingWindow({ x: display.workArea.x, y: display.workArea.y, width: size.w, height: size.h })
  track({ kind: 'thumb', win, png, doc, rect, displayId: display.id, base: size, zoom: 1, opacity: 1, file: tempFile(png, win.webContents.id) })
  layoutThumbs(display.id)
  load(win, 'thumb')
}

/** New result for a preview (after editing it). */
function updateThumb(p: Pin, png: Buffer, doc: CaptureDoc) {
  p.png = png
  p.doc = doc
  rmSync(p.file, { force: true })
  p.file = tempFile(png, p.win.webContents.id)
  p.base = thumbSize(png)
  if (p.moved) p.win.setSize(p.base.w, p.base.h)
  else layoutThumbs(p.displayId)
  p.win.webContents.send(IPC.pinImage, { png: new Uint8Array(png), appearance: getSettings().appearance })
}

export function closeAllPins() {
  for (const p of [...pins.values()]) p.win.close()
}

function setZoom(p: Pin, zoom: number, ax = 0.5, ay = 0.5) {
  const z = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom))
  const b = p.win.getBounds()
  const w = Math.max(16, Math.round(p.base.w * z))
  const h = Math.max(16, Math.round(p.base.h * z))
  // Keep the point under the cursor (or the center) where it is.
  p.win.setBounds({ x: Math.round(b.x + ax * b.width - ax * w), y: Math.round(b.y + ay * b.height - ay * h), width: w, height: h })
  p.zoom = z
  sendState(p)
}

function setOpacity(p: Pin, opacity: number) {
  p.opacity = Math.min(1, Math.max(OPACITY_MIN, opacity))
  p.win.setOpacity(p.opacity)
  sendState(p)
}

function showMenu(p: Pin) {
  const pct = (v: number) => `${Math.round(v * 100)}%`
  Menu.buildFromTemplate([
    { label: 'Copy', accelerator: 'CommandOrControl+C', click: () => clipboard.writeImage(nativeImage.createFromBuffer(p.png)) },
    { label: 'Save…', accelerator: 'CommandOrControl+S', click: () => void savePng(p.png) },
    { type: 'separator' },
    {
      label: 'Zoom',
      submenu: [0.5, 1, 1.5, 2].map((z) => ({ label: pct(z), type: 'radio' as const, checked: Math.abs(p.zoom - z) < 0.01, click: () => setZoom(p, z) }))
    },
    {
      label: 'Opacity',
      submenu: [1, 0.75, 0.5, 0.25].map((o) => ({ label: pct(o), type: 'radio' as const, checked: Math.abs(p.opacity - o) < 0.01, click: () => setOpacity(p, o) }))
    },
    { type: 'separator' },
    { label: 'Close', accelerator: 'Escape', click: () => p.win.close() },
    { label: 'Close All Pins', enabled: pins.size > 1, click: closeAllPins }
  ]).popup({ window: p.win })
}

export function registerPinIpc() {
  const of = (e: Electron.IpcMainEvent) => pins.get(e.sender.id)

  ipcOn(IPC.pinReady, (e) => {
    const p = of(e)
    if (!p) return
    p.win.webContents.send(IPC.pinImage, { png: new Uint8Array(p.png), appearance: getSettings().appearance })
    sendState(p)
    p.win.showInactive() // don't take focus from the app the user is in
  })
  ipcOn(IPC.pinMoveBy, (e, dx: number, dy: number) => {
    const p = of(e)
    if (!p) return
    const [x, y] = p.win.getPosition()
    p.win.setPosition(Math.round(x + dx), Math.round(y + dy))
    if (p.kind === 'thumb' && !p.moved) {
      p.moved = true
      layoutThumbs(p.displayId) // the others close the gap
    }
  })
  ipcOn(IPC.pinZoom, (e, z: number, ax: number, ay: number) => {
    const p = of(e)
    if (p) setZoom(p, z, ax, ay)
  })
  ipcOn(IPC.pinOpacity, (e, o: number) => {
    const p = of(e)
    if (p) setOpacity(p, o)
  })
  ipcOn(IPC.pinCopy, (e) => {
    const p = of(e)
    if (p) clipboard.writeImage(nativeImage.createFromBuffer(p.png))
  })
  ipcOn(IPC.pinSave, (e) => {
    const p = of(e)
    if (p) void savePng(p.png)
  })
  ipcOn(IPC.pinClose, (e) => of(e)?.win.close())
  ipcOn(IPC.pinMenu, (e) => {
    const p = of(e)
    if (p?.kind === 'pin') showMenu(p)
  })
  ipcOn(IPC.thumbEdit, (e) => {
    const p = of(e)
    if (p?.doc) void startEdit(p.doc, (png, doc) => !p.win.isDestroyed() && updateThumb(p, png, doc))
  })
  ipcOn(IPC.thumbPin, (e) => {
    const p = of(e)
    if (!p?.rect) return
    createPin(p.png, p.rect)
    p.win.close()
  })
  // Drag the image into another app as a PNG file.
  ipcOn(IPC.pinDragOut, (e) => {
    const p = of(e)
    if (!p) return
    const icon = nativeImage.createFromBuffer(p.png).resize({ width: Math.min(160, p.base.w) })
    e.sender.startDrag({ file: p.file, icon })
  })
}
