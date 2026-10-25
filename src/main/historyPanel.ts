import { app, BrowserWindow, nativeImage, screen, shell } from 'electron'
import { copyFileSync, mkdirSync, readFileSync } from 'fs'
import { join } from 'path'
import { IPC } from '@shared/ipc'
import { dateStamp } from '@shared/naming'
import { clearHistory, deleteEntry, historyDir, historyDoc, historyFile, historyItems, historyPath, onHistoryChange, setStarred, usage } from './history'
import { returnFocus, startEdit } from './overlay'
import { copyPng, savePng } from './output'
import { createPin } from './pin'
import { getSettings, onSettingsChange, updateSettings } from './settings'
import { ipcHandle, ipcOn } from './security'

const isMac = process.platform === 'darwin'
let panel: BrowserWindow | null = null
let quitting = false
const MIN_W = 480
const MIN_H = 340
app.on('before-quit', () => {
  quitting = true
})

function create() {
  const { appearance, history } = getSettings()
  const glass = appearance.glass
  panel = new BrowserWindow({
    width: Math.max(MIN_W, history.panel.width),
    height: Math.max(MIN_H, history.panel.height),
    minWidth: MIN_W,
    minHeight: MIN_H,
    show: false,
    // A normal title bar, hidden, so the window has the standard close button.
    ...(isMac
      ? { titleBarStyle: 'hiddenInset' as const, trafficLightPosition: { x: 16, y: 17 }, vibrancy: glass ? ('popover' as const) : undefined, visualEffectState: 'active' as const }
      : { frame: false }),
    backgroundColor: '#00000000',
    title: 'Snapkit History',
    resizable: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    hasShadow: true,
    // A panel floats over full-screen apps on macOS.
    ...(isMac ? { type: 'panel' as const } : {}),
    webPreferences: { preload: join(__dirname, '../preload/index.js'), sandbox: true, contextIsolation: true }
  })
  panel.setAlwaysOnTop(true, 'floating')
  if (isMac) panel.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true })
  if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) panel.loadURL(process.env.ELECTRON_RENDERER_URL + '#history')
  else panel.loadFile(join(__dirname, '../renderer/index.html'), { hash: 'history' })
  // Remember the size for next time (once resizing settles).
  let sizeTimer: NodeJS.Timeout | undefined
  panel.on('resize', () => {
    clearTimeout(sizeTimer)
    sizeTimer = setTimeout(() => {
      if (!panel || panel.isDestroyed()) return
      const [width, height] = panel.getSize()
      updateSettings({ history: { panel: { width, height } } })
    }, 400)
  })
  // Like a clipboard manager: clicking anywhere else closes it.
  panel.on('blur', () => hidePanel(false))
  // The close button hides it (it stays loaded so it opens instantly), except when quitting.
  panel.on('close', (e) => {
    if (quitting) return
    e.preventDefault()
    hidePanel(true)
  })
  panel.on('closed', () => {
    panel = null
  })
}

/** Load the panel early so it opens instantly. */
export function preloadHistoryPanel() {
  if (!panel) create()
}

/** Open (centered on the screen with the cursor) or close the history panel. */
export function toggleHistoryPanel() {
  if (panel?.isVisible()) return hidePanel(true)
  if (!panel || panel.isDestroyed()) create()
  const area = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea
  const [w, h] = panel!.getSize()
  panel!.setPosition(Math.round(area.x + (area.width - w) / 2), Math.round(area.y + (area.height - h) / 2))
  panel!.webContents.send(IPC.historyChanged, historyItems())
  if (isMac) app.focus({ steal: true })
  panel!.show()
  panel!.focus()
}

/** `giveFocusBack`: return focus to the app the user was in (after a copy, or Esc). */
function hidePanel(giveFocusBack: boolean) {
  if (!panel || panel.isDestroyed() || !panel.isVisible()) return
  panel.hide()
  if (giveFocusBack) returnFocus()
}

export function registerHistoryIpc() {
  // The native frosted backing follows Liquid Glass too (the panel stays loaded between opens).
  onSettingsChange((s, prev) => {
    if (isMac && panel && !panel.isDestroyed() && s.appearance.glass !== prev.appearance.glass) panel.setVibrancy(s.appearance.glass ? 'popover' : null)
  })
  onHistoryChange((items) => {
    for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send(IPC.historyChanged, items)
  })
  ipcHandle(IPC.historyList, () => historyItems())
  ipcHandle(IPC.historyThumb, (_e, id: string) => historyFile(String(id), 'thumb.jpg').then((b) => (b ? new Uint8Array(b) : null)))
  ipcHandle(IPC.historyUsage, () => usage())
  ipcHandle(IPC.historyClear, (_e, keepStarred: boolean) => clearHistory(!!keepStarred))
  ipcOn(IPC.historyReveal, () => void shell.openPath(historyDir()))
  ipcOn(IPC.historyClose, () => hidePanel(true))
  // Drag into another app: a copy named like a capture ("Snapkit <date>.png"), not "final.png".
  ipcOn(IPC.historyDragOut, (e, id: string) => {
    id = String(id)
    const src = historyPath(id, 'final.png')
    const item = historyItems().find((i) => i.id === id)
    if (!src || !item) return
    try {
      const dir = join(app.getPath('temp'), 'Snapkit')
      mkdirSync(dir, { recursive: true })
      const file = join(dir, `Snapkit ${dateStamp(new Date(item.updatedAt))}.png`)
      copyFileSync(src, file)
      const thumb = historyPath(id, 'thumb.jpg')
      const icon = nativeImage.createFromBuffer(readFileSync(thumb!)).resize({ width: 120 })
      e.sender.startDrag({ file, icon })
    } catch {
      // the entry was just deleted
    }
  })
  ipcOn(IPC.historyAction, async (_e, id: string, action: string) => {
    id = String(id)
    if (action === 'delete') return void deleteEntry(id)
    if (action === 'star' || action === 'unstar') return setStarred(id, action === 'star')
    if (action === 'edit') {
      const doc = await historyDoc(id)
      hidePanel(false)
      // The editor records its outputs into this same entry (doc.historyId).
      if (doc) void startEdit(doc, () => {})
      return
    }
    const png = await historyFile(id, 'final.png')
    if (!png) return
    // Image px per screen point, for the "Smallest" compression.
    const scale = getSettings().compress.enabled ? ((await historyDoc(id))?.scale ?? 1) : 1
    if (action === 'copy') {
      void copyPng(png, { scale })
      hidePanel(true)
    } else if (action === 'save') {
      hidePanel(false)
      await savePng(png, { scale })
    } else if (action === 'pin') {
      hidePanel(true)
      const { width, height } = nativeImage.createFromBuffer(png).getSize()
      const d = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
      const w = width / d.scaleFactor
      const h = height / d.scaleFactor
      createPin(png, { x: Math.round(d.workArea.x + (d.workArea.width - w) / 2), y: Math.round(d.workArea.y + (d.workArea.height - h) / 2), width: w, height: h })
    }
  })
}
