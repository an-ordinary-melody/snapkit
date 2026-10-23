import { app, BrowserWindow, ipcMain, screen, type Display } from 'electron'
import { join } from 'path'
import { IPC, type CaptureStartPayload } from '@shared/ipc'
import { grabAllScreens } from './capture'
import { getSettings } from './settings'
import { copyPng, savePng } from './output'

const isMac = process.platform === 'darwin'

/** One preloaded, hidden overlay window per display so capture mode opens instantly. */
const overlays = new Map<number, BrowserWindow>()

let session = 0
let active = false

function overlayUrl(win: BrowserWindow) {
  if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) {
    return win.loadURL(process.env.ELECTRON_RENDERER_URL + '#overlay')
  }
  return win.loadFile(join(__dirname, '../renderer/index.html'), { hash: 'overlay' })
}

function createOverlay(display: Display): BrowserWindow {
  const { x, y, width, height } = display.bounds
  const win = new BrowserWindow({
    x,
    y,
    width,
    height,
    show: false,
    frame: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    hasShadow: false,
    enableLargerThanScreen: true,
    roundedCorners: false,
    backgroundColor: '#000000',
    // A non-activating panel can sit above full-screen apps on macOS.
    ...(isMac ? { type: 'panel' as const } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      backgroundThrottling: false
    }
  })
  win.setAlwaysOnTop(true, 'screen-saver')
  if (isMac) win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true })
  win.setBounds(display.bounds)
  overlayUrl(win)
  win.on('closed', () => overlays.delete(display.id))
  return win
}

export function rebuildOverlays() {
  for (const win of overlays.values()) win.destroy()
  overlays.clear()
  for (const d of screen.getAllDisplays()) overlays.set(d.id, createOverlay(d))
}

function endCapture() {
  active = false
  for (const win of overlays.values()) {
    if (win.isDestroyed()) continue
    win.webContents.send(IPC.reset)
    win.hide()
  }
}

export async function startCapture() {
  if (active) return
  active = true
  const id = ++session
  const settings = getSettings()

  let grabs
  try {
    grabs = await grabAllScreens()
  } catch (err) {
    console.error('[overlay] capture failed', err)
    active = false
    return
  }
  if (id !== session) return

  // Displays may have changed since the overlays were built.
  if (grabs.some((g) => !overlays.has(g.display.id))) rebuildOverlays()

  const cursor = screen.getCursorScreenPoint()
  const focusDisplay = screen.getDisplayNearestPoint(cursor)

  await Promise.all(
    grabs.map(async (g) => {
      const win = overlays.get(g.display.id)
      if (!win || win.isDestroyed()) return
      if (win.webContents.isLoading()) await new Promise<void>((r) => win.webContents.once('did-finish-load', () => r()))
      const ready = waitForReady(win, id)
      const payload: CaptureStartPayload = {
        session: id,
        displayId: g.display.id,
        pixels: g.pixels,
        width: g.width,
        height: g.height,
        settings
      }
      win.setBounds(g.display.bounds)
      win.webContents.send(IPC.captureStart, payload)
      await ready
      if (id !== session || !active) return
      win.show()
      if (g.display.id === focusDisplay.id) {
        if (isMac) app.focus({ steal: true })
        win.focus()
      }
    })
  )
}

function waitForReady(win: BrowserWindow, id: number) {
  return new Promise<void>((resolve) => {
    const timer = setTimeout(done, 500) // never leave the user waiting on a slow renderer
    function onReady(e: Electron.IpcMainEvent, s: number) {
      if (e.sender === win.webContents && s === id) done()
    }
    function done() {
      clearTimeout(timer)
      ipcMain.off(IPC.ready, onReady)
      resolve()
    }
    ipcMain.on(IPC.ready, onReady)
  })
}

export function registerOverlayIpc() {
  const valid = (s: number) => active && s === session

  ipcMain.on(IPC.selectionStarted, (e, s: number) => {
    if (!valid(s)) return
    for (const win of overlays.values()) {
      if (!win.isDestroyed() && win.webContents !== e.sender) win.webContents.send(IPC.clearSelection)
    }
  })
  ipcMain.on(IPC.cancel, (_e, s: number) => valid(s) && endCapture())
  ipcMain.on(IPC.copy, (_e, s: number, png: ArrayBuffer) => {
    if (!valid(s)) return
    endCapture()
    copyPng(Buffer.from(png))
  })
  ipcMain.on(IPC.save, async (_e, s: number, png: ArrayBuffer) => {
    if (!valid(s)) return
    endCapture() // hide first so the save dialog isn't covered by the overlay
    await savePng(Buffer.from(png))
  })
}
