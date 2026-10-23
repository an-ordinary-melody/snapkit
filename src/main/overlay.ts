import { app, BrowserWindow, ipcMain, screen, type Display } from 'electron'
import { join } from 'path'
import { IPC, type ArmPayload, type PixelsPayload } from '@shared/ipc'
import { grabAllScreens } from './capture'
import { getSettings } from './settings'
import { copyPng, savePng } from './output'
import { log } from './log'

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
    transparent: true,
    backgroundColor: '#00000000',
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
  win.setOpacity(0)
  overlayUrl(win)
  win.on('closed', () => overlays.delete(display.id))
  return win
}

export function rebuildOverlays() {
  for (const win of overlays.values()) win.destroy()
  overlays.clear()
  for (const d of screen.getAllDisplays()) overlays.set(d.id, createOverlay(d))
}

/** Hide overlays without ever showing a stale frame next time. */
function endCapture() {
  active = false
  const endedSession = session
  for (const win of overlays.values()) {
    if (win.isDestroyed()) continue
    win.setOpacity(0) // disappears instantly
    win.webContents.send(IPC.reset)
    // Hide only after the renderer has painted an empty frame, so the next
    // show() can't flash the previous screenshot.
    waitFor(IPC.cleared, win, null, 150).then(() => {
      if (!active && session === endedSession && !win.isDestroyed()) win.hide()
    })
  }
}

export async function startCapture(t0 = Date.now()) {
  if (active) return
  active = true
  const id = ++session
  const settings = getSettings()
  const ms = () => `${Date.now() - t0}ms`

  let grabs
  try {
    grabs = await grabAllScreens()
  } catch (err) {
    log('capture failed', err)
    active = false
    return
  }
  if (id !== session) return
  log(`grabbed ${grabs.length} display(s) at ${ms()}`)

  // Displays may have changed since the overlays were built.
  if (grabs.some((g) => !overlays.has(g.display.id))) rebuildOverlays()

  const cursor = screen.getCursorScreenPoint()
  const focusDisplay = screen.getDisplayNearestPoint(cursor)

  await Promise.all(
    grabs.map(async (g) => {
      const win = overlays.get(g.display.id)
      if (!win || win.isDestroyed()) return
      if (win.webContents.isLoading()) await new Promise<void>((r) => win.webContents.once('did-finish-load', () => r()))

      // Step 1: show the dim right away over the live screen (it still looks identical).
      const arm: ArmPayload = { session: id, displayId: g.display.id, width: g.width, height: g.height, settings }
      const armed = waitFor(IPC.armed, win, id, 60)
      win.webContents.send(IPC.arm, arm)
      await armed
      if (id !== session || !active) return
      win.setBounds(g.display.bounds)
      win.showInactive()
      win.setOpacity(1)
      if (g.display.id === focusDisplay.id) {
        if (isMac) app.focus({ steal: true })
        win.focus()
      }
      log(`display ${g.display.id} shown at ${ms()}`)

      // Step 2: transfer the frozen image and paint it under the dim.
      const pixels = await g.pixels()
      if (id !== session || !active) return
      const painted = waitFor(IPC.painted, win, id, 2000)
      const payload: PixelsPayload = { session: id, pixels, width: g.width, height: g.height }
      win.webContents.send(IPC.pixels, payload)
      await painted
      log(`display ${g.display.id} frozen image painted at ${ms()} (${g.width}x${g.height})`)
    })
  )
}

/** Resolve when `win` sends `channel` (for `session`, if given), or after `timeout` ms. */
function waitFor(channel: string, win: BrowserWindow, session: number | null, timeout: number) {
  return new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      log(`timeout waiting for ${channel}`)
      done()
    }, timeout)
    function onMsg(e: Electron.IpcMainEvent, s?: number) {
      if (e.sender === win.webContents && (session === null || s === session)) done()
    }
    function done() {
      clearTimeout(timer)
      ipcMain.off(channel, onMsg)
      resolve()
    }
    ipcMain.on(channel, onMsg)
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
