import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { join } from 'path'
import { DEFAULT_SETTINGS, type Settings, type SettingsPatch } from '@shared/settings'
import { IPC, type SettingsSnapshot } from '@shared/ipc'
import { defaultSaveFolder } from './output'
import { getSettings, onSettingsChange, resetSettings, settingsFile, updateSettings } from './settings'

const isMac = process.platform === 'darwin'
let win: BrowserWindow | null = null

const snapshot = (): SettingsSnapshot => ({
  settings: getSettings(),
  defaults: DEFAULT_SETTINGS,
  version: app.getVersion(),
  defaultSaveFolder: defaultSaveFolder()
})

/** Open (or bring forward) the settings window. */
export function openSettingsWindow() {
  if (isMac) app.focus({ steal: true })
  if (win && !win.isDestroyed()) {
    win.show()
    win.focus()
    return
  }
  const glass = getSettings().appearance.theme === 'glass'
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
    backgroundColor: glass ? '#00000000' : '#1e1e21',
    webPreferences: { preload: join(__dirname, '../preload/index.js'), sandbox: false, contextIsolation: true }
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
export function registerSettingsIpc(setHotkey: (accelerator: string) => string | null) {
  ipcMain.on(IPC.openSettings, () => openSettingsWindow())
  ipcMain.handle(IPC.settingsGet, () => snapshot())
  ipcMain.handle(IPC.settingsUpdate, (_e, patch: SettingsPatch) => {
    updateSettings(patch)
    return snapshot()
  })
  ipcMain.handle(IPC.settingsReset, (_e, sections?: (keyof Settings)[]) => {
    resetSettings(sections)
    return snapshot()
  })
  ipcMain.handle(IPC.settingsSetHotkey, (_e, accelerator: string) => setHotkey(accelerator))
  ipcMain.handle(IPC.settingsChooseFolder, async () => {
    const res = await dialog.showOpenDialog(win ?? undefined!, { properties: ['openDirectory', 'createDirectory'], defaultPath: defaultSaveFolder() })
    return res.canceled ? null : (res.filePaths[0] ?? null)
  })
  ipcMain.on(IPC.settingsReveal, (_e, what: 'logs' | 'settings') => {
    if (what === 'logs') void shell.openPath(app.getPath('logs'))
    else shell.showItemInFolder(settingsFile())
  })
  // Keep the window in sync with changes made anywhere (e.g. the last save folder).
  onSettingsChange(() => {
    if (win && !win.isDestroyed()) win.webContents.send(IPC.settingsChanged, snapshot())
  })
}
