import { app, BrowserWindow, dialog, nativeTheme, shell } from 'electron'
import { join } from 'path'
import { DEFAULT_SETTINGS, type Settings, type SettingsPatch } from '@shared/settings'
import { IPC, type SettingsSnapshot } from '@shared/ipc'
import { engineInfo } from './capture'
import { defaultSaveFolder } from './output'
import { ipcHandle, ipcOn } from './security'
import { getSettings, onSettingsChange, resetSettings, settingsFile, updateSettings } from './settings'

const isMac = process.platform === 'darwin'
let win: BrowserWindow | null = null

const snapshot = (): SettingsSnapshot => ({
  settings: getSettings(),
  defaults: DEFAULT_SETTINGS,
  version: app.getVersion(),
  defaultSaveFolder: defaultSaveFolder(),
  engines: engineInfo()
})

/** Open (or bring forward) the settings window. */
export function openSettingsWindow() {
  if (isMac) app.focus({ steal: true })
  if (win && !win.isDestroyed()) {
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
  })
}

/**
 * `setHotkey` changes the capture hotkey and returns an error message if the
 * shortcut can't be registered (the old one is kept then).
 */
type HotkeyName = 'capture' | 'history' | 'fullscreen' | 'settings'

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
    setHotkey(name === 'history' || name === 'fullscreen' || name === 'settings' ? name : 'capture', String(accelerator))
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
  nativeTheme.themeSource = getSettings().appearance.mode
  // Keep the window in sync with changes made anywhere (e.g. the last save folder).
  onSettingsChange((s, prev) => {
    nativeTheme.themeSource = s.appearance.mode
    if (!win || win.isDestroyed()) return
    if (isMac && s.appearance.glass !== prev.appearance.glass) win.setVibrancy(s.appearance.glass ? 'sidebar' : null)
    win.webContents.send(IPC.settingsChanged, snapshot())
  })
}
