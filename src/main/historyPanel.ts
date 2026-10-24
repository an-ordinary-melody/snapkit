import { app, BrowserWindow, clipboard, nativeImage, screen, shell } from 'electron'
import { join } from 'path'
import { IPC } from '@shared/ipc'
import { clearHistory, deleteEntry, historyDir, historyDoc, historyFile, historyItems, onHistoryChange, setStarred, usage } from './history'
import { returnFocus, startEdit } from './overlay'
import { savePng } from './output'
import { createPin } from './pin'
import { getSettings } from './settings'
import { ipcHandle, ipcOn } from './security'

const isMac = process.platform === 'darwin'
let panel: BrowserWindow | null = null
let quitting = false
app.on('before-quit', () => {
  quitting = true
})

function create() {
  const glass = getSettings().appearance.glass
  panel = new BrowserWindow({
    width: 800,
    height: 520,
    show: false,
    // A normal title bar, hidden, so the window has the standard close button.
    ...(isMac
      ? { titleBarStyle: 'hiddenInset' as const, trafficLightPosition: { x: 16, y: 17 }, vibrancy: glass ? ('popover' as const) : undefined, visualEffectState: 'active' as const }
      : { frame: false }),
    backgroundColor: '#00000000',
    title: 'Snapkit History',
    resizable: false,
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
  onHistoryChange((items) => {
    for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send(IPC.historyChanged, items)
  })
  ipcHandle(IPC.historyList, () => historyItems())
  ipcHandle(IPC.historyThumb, (_e, id: string) => historyFile(String(id), 'thumb.jpg').then((b) => (b ? new Uint8Array(b) : null)))
  ipcHandle(IPC.historyUsage, () => usage())
  ipcHandle(IPC.historyClear, (_e, keepStarred: boolean) => clearHistory(!!keepStarred))
  ipcOn(IPC.historyReveal, () => void shell.openPath(historyDir()))
  ipcOn(IPC.historyClose, () => hidePanel(true))
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
    if (action === 'copy') {
      clipboard.writeImage(nativeImage.createFromBuffer(png))
      hidePanel(true)
    } else if (action === 'save') {
      hidePanel(false)
      await savePng(png)
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
