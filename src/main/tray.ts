import { app, Menu, nativeImage, shell, Tray } from 'electron'
import { join } from 'path'
import { defaultSaveFolder } from './output'
import { closeAllPins } from './pin'
import { getSettings } from './settings'

let tray: Tray | null = null
let actions: { capture(): void; settings(): void } | null = null

function iconPath() {
  const dir = app.isPackaged ? process.resourcesPath : join(__dirname, '../../resources')
  return process.platform === 'darwin' ? join(dir, 'trayTemplate.png') : join(dir, 'tray.png')
}

export function createTray(onCapture: () => void, onSettings: () => void) {
  actions = { capture: onCapture, settings: onSettings }
  const icon = nativeImage.createFromPath(iconPath())
  if (process.platform === 'darwin') icon.setTemplateImage(true)
  tray = new Tray(icon)
  tray.setToolTip('Snapkit')
  refreshTrayMenu()
  if (process.platform === 'win32') tray.on('click', onCapture)
}

export function refreshTrayMenu() {
  if (!tray || !actions) return
  const { capture: onCapture, settings: onSettings } = actions
  const hotkey = getSettings().hotkeys.capture
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Capture Area', accelerator: hotkey, click: onCapture },
      { type: 'separator' },
      { label: 'Open Screenshots Folder', click: () => shell.openPath(defaultSaveFolder()) },
      { label: 'Close All Pins', click: closeAllPins },
      { label: 'Settings…', accelerator: 'CommandOrControl+,', click: onSettings },
      { type: 'separator' },
      { label: `Snapkit ${app.getVersion()}`, enabled: false },
      { label: 'Quit Snapkit', accelerator: 'CommandOrControl+Q', click: () => app.quit() }
    ])
  )
}
