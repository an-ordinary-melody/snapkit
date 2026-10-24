import { app, BrowserWindow, ipcMain, screen, type Display } from 'electron'
import { readFile, stat } from 'fs/promises'
import { extname, join } from 'path'
import { IPC, type ArmPayload, type CaptureDoc, type CopyExtra, type HistoryRecord, type PixelsPayload } from '@shared/ipc'
import { grabAllScreens } from './capture'
import { getSettings } from './settings'
import { copyPng, savePng } from './output'
import { log } from './log'
import { ipcHandle, ipcOn } from './security'
import { createThumb, hasPins, linkThumbToHistory } from './pin'
import { addToHistory } from './history'

const isMac = process.platform === 'darwin'

/** One preloaded, hidden overlay window per display so capture mode opens instantly. */
const overlays = new Map<number, BrowserWindow>()

let session = 0
let active = false
/** While editing a floating preview: where the edited result goes. */
let editTarget: ((png: Buffer, doc: CaptureDoc) => void) | null = null

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
      sandbox: true,
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
  // Diagnostics: overlay errors and crashes go to main.log.
  win.webContents.on('console-message', (_e, level, message, line, source) => {
    if (level >= 3) log(`[overlay ${display.id}] ${message} (${source.split('/').pop()}:${line})`)
  })
  win.webContents.on('render-process-gone', (_e, details) => {
    log(`[overlay ${display.id}] renderer gone: ${details.reason} (exit ${details.exitCode})`)
    if (active) endCapture()
    if (!win.isDestroyed()) win.destroy()
    overlays.set(display.id, createOverlay(display))
  })
  win.on('unresponsive', () => {
    log(`[overlay ${display.id}] unresponsive`)
    forceEndCapture('overlay stopped responding')
  })
  return win
}

export function rebuildOverlays() {
  for (const win of overlays.values()) win.destroy()
  overlays.clear()
  for (const d of screen.getAllDisplays()) overlays.set(d.id, createOverlay(d))
}

/** Hide overlays without ever showing a stale frame next time. */
/** Capture mode (or an edit session) is open. */
export const isCapturing = () => active

/** Capture mode closes by itself after this long without any input. */
const IDLE_LIMIT_MS = Number(process.env.SNAPKIT_IDLE_MS) || 3 * 60 * 1000 // the env var is for tests
let idleTimer: NodeJS.Timeout | null = null

function touchIdleTimer() {
  if (idleTimer) clearTimeout(idleTimer)
  idleTimer = setTimeout(() => forceEndCapture(`no input for ${Math.round(IDLE_LIMIT_MS / 1000)} s`), IDLE_LIMIT_MS)
}

/**
 * Safety net: close capture mode right now, without waiting for the overlay
 * page (it may be stuck). Used when the hotkey is pressed again, when the
 * overlay doesn't respond, and after a long idle time.
 */
export function forceEndCapture(reason: string) {
  if (!active) return
  log(`capture closed: ${reason}`)
  endCapture()
  for (const win of overlays.values()) if (!win.isDestroyed()) win.hide()
  releaseFocus()
}

/** A stuck overlay page is replaced so the next capture starts clean. */
function replaceOverlay(display: Display) {
  const old = overlays.get(display.id)
  if (old && !old.isDestroyed()) old.destroy()
  overlays.set(display.id, createOverlay(display))
}

function endCapture() {
  active = false
  editTarget = null
  if (idleTimer) clearTimeout(idleTimer)
  idleTimer = null
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

/**
 * macOS: give focus back to the app the user was in. Otherwise Snapkit stays
 * the frontmost app with no visible window after a copy, and the next capture
 * is slow or seems to do nothing until the user clicks elsewhere.
 */
function releaseFocus() {
  if (!isMac) return
  returnFocus()
}

/** Give focus back to the app the user was in (keeping pins on screen). */
export function returnFocus() {
  if (!isMac) return
  app.hide()
  // Hiding the app hides pins too: bring them back without taking focus.
  if (hasPins()) app.show()
}

export async function startCapture(t0 = Date.now()) {
  // The hotkey again closes capture mode, whatever state it's in: a way out
  // that doesn't depend on the overlay page responding.
  if (active) return forceEndCapture('hotkey pressed again')
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

  if (isMac) app.show() // undo releaseFocus() so the overlays can appear

  const cursor = screen.getCursorScreenPoint()
  const focusDisplay = screen.getDisplayNearestPoint(cursor)

  await Promise.all(
    grabs.map(async (g) => {
      const win = overlays.get(g.display.id)
      if (!win || win.isDestroyed()) return
      if (win.webContents.isLoading()) await new Promise<void>((r) => win.webContents.once('did-finish-load', () => r()))

      // Step 1: show the dim right away over the live screen (it still looks identical).
      const arm: ArmPayload = { session: id, displayId: g.display.id, width: g.width, height: g.height, settings }
      const armed = waitFor(IPC.armed, win, id, 1000)
      win.webContents.send(IPC.arm, arm)
      if (!(await armed)) {
        // Showing a page that doesn't answer could leave a dim you can't get out of.
        forceEndCapture(`overlay ${g.display.id} didn't respond`)
        replaceOverlay(g.display)
        return
      }
      if (id !== session || !active) return
      win.setBounds(g.display.bounds)
      win.showInactive()
      win.setOpacity(1)
      if (g.display.id === focusDisplay.id) {
        if (isMac) app.focus({ steal: true })
        win.focus()
      }
      log(`display ${g.display.id} shown at ${ms()}`)
      touchIdleTimer()

      // Step 2: transfer the frozen image and paint it under the dim.
      const pixels = await g.pixels()
      if (id !== session || !active) return
      const painted = waitFor(IPC.painted, win, id, 2000)
      const payload: PixelsPayload = { session: id, pixels, width: g.width, height: g.height }
      win.webContents.send(IPC.pixels, payload)
      if (!(await painted)) {
        forceEndCapture(`overlay ${g.display.id} never showed the frozen image`)
        replaceOverlay(g.display)
        return
      }
      log(`display ${g.display.id} frozen image painted at ${ms()} (${g.width}x${g.height})`)
    })
  )
}

/**
 * Reopen a capture in the editor (from a floating preview). The overlay on
 * the display under the cursor opens straight into the background editor.
 */
export async function startEdit(doc: CaptureDoc, onDone: (png: Buffer, doc: CaptureDoc) => void) {
  if (active) return
  active = true
  const id = ++session
  editTarget = onDone
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
  if (!overlays.has(display.id)) rebuildOverlays()
  const win = overlays.get(display.id)
  if (!win || win.isDestroyed()) return endCapture()
  if (win.webContents.isLoading()) await new Promise<void>((r) => win.webContents.once('did-finish-load', () => r()))
  if (isMac) app.show()
  const arm: ArmPayload = { session: id, displayId: display.id, width: doc.width, height: doc.height, settings: getSettings(), edit: doc }
  const armed = waitFor(IPC.armed, win, id, 300)
  win.webContents.send(IPC.arm, arm)
  await armed
  if (id !== session || !active) return
  win.setBounds(display.bounds)
  win.showInactive()
  win.setOpacity(1)
  if (isMac) app.focus({ steal: true })
  win.focus()
}

/**
 * Resolve true when `win` sends `channel` (for `session`, if given), or false
 * after `timeout` ms. Listens with ipcMain directly (the sender is checked
 * here) so the listener can be removed again.
 */
function waitFor(channel: string, win: BrowserWindow, session: number | null, timeout: number) {
  return new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => {
      log(`timeout waiting for ${channel}`)
      done(false)
    }, timeout)
    function onMsg(e: Electron.IpcMainEvent, s?: number) {
      if (e.sender === win.webContents && (session === null || s === session)) done(true)
    }
    function done(ok: boolean) {
      clearTimeout(timer)
      ipcMain.off(channel, onMsg)
      resolve(ok)
    }
    ipcMain.on(channel, onMsg)
  })
}

const IMAGE_TYPES = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp', '.heic'])

export function registerOverlayIpc() {
  const valid = (s: number) => active && s === session

  // Image backgrounds for beautify: only image files a background setting points at, and not huge ones.
  ipcHandle(IPC.readImage, async (_e, path: unknown) => {
    if (typeof path !== 'string' || !IMAGE_TYPES.has(extname(path).toLowerCase())) return null
    const allowed = getSettings().beautify.presets.some((p) => p.background.type === 'image' && p.background.path === path)
    if (!allowed) return null
    try {
      if ((await stat(path)).size > 40 * 1024 * 1024) return null
      return new Uint8Array(await readFile(path))
    } catch (err) {
      log('background image unreadable', path, String(err))
      return null
    }
  })

  ipcOn(IPC.selectionStarted, (e, s: number) => {
    if (!valid(s)) return
    for (const win of overlays.values()) {
      if (!win.isDestroyed() && win.webContents !== e.sender) win.webContents.send(IPC.clearSelection)
    }
  })
  ipcOn(IPC.cancel, (_e, s: number) => {
    if (!valid(s)) return
    endCapture()
    releaseFocus()
  })
  ipcOn(IPC.copy, (e, s: number, png: ArrayBuffer, extra?: CopyExtra) => {
    if (!valid(s)) return
    const target = editTarget
    const origin = BrowserWindow.fromWebContents(e.sender)?.getBounds() ?? { x: 0, y: 0 }
    endCapture()
    const buf = Buffer.from(png)
    copyPng(buf)
    if (extra && target) target(buf, extra.doc) // editing a floating preview: update it
    else if (extra) {
      const r = extra.rect
      createThumb(buf, extra.doc, { x: origin.x + r.x, y: origin.y + r.y, width: r.w, height: r.h }, s)
    }
    releaseFocus()
  })
  // Any input in capture mode pushes the idle timeout back.
  ipcOn(IPC.activity, (_e, s: number) => s === session && active && touchIdleTimer())
  // Sent right after an output; the session has usually ended by then.
  ipcOn(IPC.historyAdd, (_e, r: HistoryRecord) => {
    void addToHistory(r).then((id) => id && linkThumbToHistory(r.session, id))
  })
  ipcOn(IPC.editDone, (_e, s: number, png: ArrayBuffer, doc: CaptureDoc) => {
    if (!valid(s)) return
    editTarget?.(Buffer.from(png), doc)
    endCapture()
    releaseFocus()
  })
  ipcOn(IPC.save, async (_e, s: number, png: ArrayBuffer) => {
    if (!valid(s)) return
    endCapture() // hide first so the save dialog isn't covered by the overlay
    await savePng(Buffer.from(png))
    releaseFocus()
  })
}
