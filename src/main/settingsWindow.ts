import { app, BrowserWindow, dialog, nativeTheme, shell } from 'electron'
import { join } from 'path'
import { type Settings, type SettingsPatch } from '@shared/settings'
import { IPC, type SettingsSnapshot } from '@shared/ipc'
import { engineInfo } from './capture'
import { defaultSaveFolder } from './output'
import { ipcHandle, ipcOn } from './security'
import { DEFAULTS, getSettings, onSettingsChange, resetSettings, settingsFile, updateSettings } from './settings'
import { HOTKEY_NAMES, onHotkeyStatus, takenHotkeys, type HotkeyName } from './hotkeys'

const isMac = process.platform === 'darwin'
let win: BrowserWindow | null = null

const snapshot = (): SettingsSnapshot => ({
  settings: getSettings(),
  defaults: DEFAULTS,
  hotkeysTaken: takenHotkeys(),
  version: app.getVersion(),
  defaultSaveFolder: defaultSaveFolder(),
  engines: engineInfo()
})

/**
 * macOS: Snapkit is a menu-bar app, but while Settings is open it has a Dock
 * icon (and ⌘-Tab entry) like a normal app. Closing Settings takes it away again.
 */
function showInDock(show: boolean) {
  if (!isMac || !app.dock) return
  if (show) void app.dock.show()
  else app.dock.hide()
}

/** Open (or bring forward) the settings window. */
export function openSettingsWindow() {
  showInDock(true)
  if (isMac) app.focus({ steal: true })
  if (win && !win.isDestroyed()) {
    if (win.isMinimized()) win.restore()
    win.show()
    win.focus()
    return
  }
  const glass = getSettings().appearance.glass
  win = new BrowserWindow({
    width: 880,
    height: 640,
    minWidth: 720,
    minHeight: 480,
    show: false,
    title: 'Snapkit Settings',
    // Native translucent window material: real macOS glass behind the glass theme.
    ...(isMac
      ? { titleBarStyle: 'hiddenInset' as const, trafficLightPosition: { x: 16, y: 18 }, vibrancy: glass ? ('sidebar' as const) : undefined, visualEffectState: 'active' as const }
      : { backgroundMaterial: 'mica' as const, autoHideMenuBar: true }),
    backgroundColor: '#00000000', // the page paints its own background when glass is off
    webPreferences: { preload: join(__dirname, '../preload/index.js'), sandbox: true, contextIsolation: true }
  })
  if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) win.loadURL(process.env.ELECTRON_RENDERER_URL + '#settings')
  else win.loadFile(join(__dirname, '../renderer/index.html'), { hash: 'settings' })
  win.once('ready-to-show', () => win?.show())
  win.on('closed', () => {
    win = null
    showInDock(false)
  })
}

/** Whether Settings is open (macOS: a click on the Dock icon then brings it forward). */
export const isSettingsOpen = () => !!win && !win.isDestroyed()

/**
 * `setHotkey` changes the capture hotkey and returns an error message if the
 * shortcut can't be registered (the old one is kept then).
 */
/** Native window material and menus: Gray is a dark theme. */
const nativeMode = (m: Settings['appearance']['mode']) => (m === 'gray' ? 'dark' : m)

export function registerSettingsIpc(setHotkey: (name: HotkeyName, accelerator: string) => string | null) {
  ipcOn(IPC.openSettings, () => openSettingsWindow())
  ipcHandle(IPC.settingsGet, () => snapshot())
  ipcHandle(IPC.settingsUpdate, (_e, patch: SettingsPatch) => {
    updateSettings(patch)
    return snapshot()
  })
  ipcHandle(IPC.settingsReset, (_e, sections?: (keyof Settings)[]) => {
    resetSettings(sections)
    return snapshot()
  })
  ipcHandle(IPC.settingsSetHotkey, (_e, accelerator: string, name: HotkeyName = 'capture') =>
    setHotkey(HOTKEY_NAMES.includes(name) ? name : 'capture', String(accelerator))
  )
  ipcHandle(IPC.settingsChooseFolder, async () => {
    const res = await dialog.showOpenDialog(win ?? undefined!, { properties: ['openDirectory', 'createDirectory'], defaultPath: defaultSaveFolder() })
    return res.canceled ? null : (res.filePaths[0] ?? null)
  })
  ipcOn(IPC.settingsReveal, (_e, what: 'logs' | 'settings') => {
    if (what === 'logs') void shell.openPath(app.getPath('logs'))
    else shell.showItemInFolder(settingsFile())
  })
  // Light / dark / system for everything native too (window material, dialogs, menus).
  nativeTheme.themeSource = nativeMode(getSettings().appearance.mode)
  // Keep the window in sync with changes made anywhere (e.g. the last save folder).
  onSettingsChange((s, prev) => {
    nativeTheme.themeSource = nativeMode(s.appearance.mode)
    if (JSON.stringify(s.appearance) !== JSON.stringify(prev.appearance)) {
      for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send(IPC.appearanceChanged, s.appearance)
    }
    if (!win || win.isDestroyed()) return
    if (isMac && s.appearance.glass !== prev.appearance.glass) win.setVibrancy(s.appearance.glass ? 'sidebar' : null)
    win.webContents.send(IPC.settingsChanged, snapshot())
  })
  // A shortcut became taken or free: the Shortcuts section shows it.
  onHotkeyStatus(() => win && !win.isDestroyed() && win.webContents.send(IPC.settingsChanged, snapshot()))
}
