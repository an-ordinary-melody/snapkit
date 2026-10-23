import { app, BrowserWindow, clipboard, ipcMain, Menu, nativeImage, screen, type Rectangle } from 'electron'
import { mkdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { IPC, type PinState } from '@shared/ipc'
import { log } from './log'
import { savePng, timestampName } from './output'

const isMac = process.platform === 'darwin'

interface Pin {
  win: BrowserWindow
  png: Buffer
  /** Size at 100% zoom, in screen points. */
  base: { w: number; h: number }
  zoom: number
  opacity: number
  /** Temp file used when dragging the image into another app. */
  file: string
}

/** Floating screenshots, keyed by their window's webContents id. */
const pins = new Map<number, Pin>()

export const hasPins = () => pins.size > 0

const ZOOM_MIN = 0.1
const ZOOM_MAX = 5
const OPACITY_MIN = 0.15

function pinUrl(win: BrowserWindow) {
  if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) return win.loadURL(process.env.ELECTRON_RENDERER_URL + '#pin')
  return win.loadFile(join(__dirname, '../renderer/index.html'), { hash: 'pin' })
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

  const win = new BrowserWindow({
    x,
    y,
    width: w,
    height: h,
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
    webPreferences: { preload: join(__dirname, '../preload/index.js'), sandbox: false, contextIsolation: true }
  })
  win.setAlwaysOnTop(true, 'floating')
  if (isMac) win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true })

  const dir = join(app.getPath('temp'), 'Snapkit')
  mkdirSync(dir, { recursive: true })
  const file = join(dir, timestampName().replace(/\.png$/, ` ${win.webContents.id}.png`))
  writeFileSync(file, png)

  const pin: Pin = { win, png, base: { w, h }, zoom: 1, opacity: 1, file }
  const id = win.webContents.id
  pins.set(id, pin)
  win.on('closed', () => {
    pins.delete(id)
    rmSync(file, { force: true })
  })
  win.webContents.on('render-process-gone', (_e, d) => log(`[pin] renderer gone: ${d.reason}`))
  win.webContents.on('console-message', (_e, level, message) => level >= 3 && log(`[pin] ${message}`))
  pinUrl(win)
  log(`pinned ${px.width}x${px.height} at ${x},${y}`)
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

  ipcMain.on(IPC.pinReady, (e) => {
    const p = of(e)
    if (!p) return
    p.win.webContents.send(IPC.pinImage, { png: new Uint8Array(p.png) })
    sendState(p)
    p.win.showInactive() // don't take focus from the app the user is in
  })
  ipcMain.on(IPC.pinMoveBy, (e, dx: number, dy: number) => {
    const p = of(e)
    if (!p) return
    const [x, y] = p.win.getPosition()
    p.win.setPosition(Math.round(x + dx), Math.round(y + dy))
  })
  ipcMain.on(IPC.pinZoom, (e, z: number, ax: number, ay: number) => {
    const p = of(e)
    if (p) setZoom(p, z, ax, ay)
  })
  ipcMain.on(IPC.pinOpacity, (e, o: number) => {
    const p = of(e)
    if (p) setOpacity(p, o)
  })
  ipcMain.on(IPC.pinCopy, (e) => {
    const p = of(e)
    if (p) clipboard.writeImage(nativeImage.createFromBuffer(p.png))
  })
  ipcMain.on(IPC.pinSave, (e) => {
    const p = of(e)
    if (p) void savePng(p.png)
  })
  ipcMain.on(IPC.pinClose, (e) => of(e)?.win.close())
  ipcMain.on(IPC.pinMenu, (e) => {
    const p = of(e)
    if (p) showMenu(p)
  })
  // Drag the image into another app as a PNG file.
  ipcMain.on(IPC.pinDragOut, (e) => {
    const p = of(e)
    if (!p) return
    const icon = nativeImage.createFromBuffer(p.png).resize({ width: Math.min(160, p.base.w) })
    e.sender.startDrag({ file: p.file, icon })
  })
}
