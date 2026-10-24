import { app, Menu, nativeImage, shell, Tray } from 'electron'
import { join } from 'path'
import { defaultSaveFolder } from './output'
import { closeAllPins } from './pin'
import { lastUpdateCheck } from './system'
import { getSettings, updateSettings } from './settings'

let tray: Tray | null = null
let actions: { capture(): void; settings(): void; history(): void; fullscreen(): void } | null = null

function iconPath() {
  const dir = app.isPackaged ? process.resourcesPath : join(__dirname, '../../resources')
  return process.platform === 'darwin' ? join(dir, 'trayTemplate.png') : join(dir, 'tray.png')
}

export function createTray(onCapture: () => void, onSettings: () => void, onHistory: () => void, onFullscreen: () => void) {
  actions = { capture: onCapture, settings: onSettings, history: onHistory, fullscreen: onFullscreen }
  const icon = nativeImage.createFromPath(iconPath())
  if (process.platform === 'darwin') icon.setTemplateImage(true)
  tray = new Tray(icon)
  tray.setToolTip('Snapkit')
  refreshTrayMenu()
  if (process.platform === 'win32') tray.on('click', onCapture)
}

export function refreshTrayMenu() {
  if (!tray || !actions) return
  const { capture: onCapture, settings: onSettings, history: onHistory, fullscreen: onFullscreen } = actions
  const { history: historyKey, fullscreen: fullscreenKey, settings: settingsKey } = getSettings().hotkeys
  const paused = getSettings().history.paused
  const update = lastUpdateCheck()
  const hotkey = getSettings().hotkeys.capture
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Capture Area', accelerator: hotkey, click: onCapture },
      { label: 'Capture Full Screen', accelerator: fullscreenKey || undefined, click: onFullscreen },
      { type: 'separator' },
      { label: 'History…', accelerator: historyKey || undefined, click: onHistory },
      { label: 'Pause History', type: 'checkbox', checked: paused, click: () => updateSettings({ history: { paused: !paused } }) },
      { type: 'separator' },
      { label: 'Open Screenshots Folder', click: () => shell.openPath(defaultSaveFolder()) },
      { label: 'Close All Pins', click: closeAllPins },
      { label: 'Settings…', accelerator: settingsKey || 'CommandOrControl+,', click: onSettings },
      { type: 'separator' },
      ...(update?.status === 'available'
        ? [{ label: `Update available: ${update.version}…`, click: () => void shell.openExternal(update.url!) }]
        : [{ label: `Snapkit ${app.getVersion()}`, enabled: false }]),
      { label: 'Quit Snapkit', accelerator: 'CommandOrControl+Q', click: () => app.quit() }
    ])
  )
}
