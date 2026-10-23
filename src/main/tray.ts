import { app, Menu, nativeImage, shell, Tray } from 'electron'
import { join } from 'path'
import { defaultSaveFolder } from './output'
import { getSettings } from './settings'

let tray: Tray | null = null

function iconPath() {
  const dir = app.isPackaged ? process.resourcesPath : join(__dirname, '../../resources')
  return process.platform === 'darwin' ? join(dir, 'trayTemplate.png') : join(dir, 'tray.png')
}

export function createTray(onCapture: () => void) {
  const icon = nativeImage.createFromPath(iconPath())
  if (process.platform === 'darwin') icon.setTemplateImage(true)
  tray = new Tray(icon)
  tray.setToolTip('Snapkit')
  refreshTrayMenu(onCapture)
  if (process.platform === 'win32') tray.on('click', onCapture)
}

export function refreshTrayMenu(onCapture: () => void) {
  if (!tray) return
  const hotkey = getSettings().hotkeys.capture
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Capture Area', accelerator: hotkey, click: onCapture },
      { type: 'separator' },
      { label: 'Open Screenshots Folder', click: () => shell.openPath(defaultSaveFolder()) },
      { label: 'Settings… (coming soon)', enabled: false },
      { type: 'separator' },
      { label: `Snapkit ${app.getVersion()}`, enabled: false },
      { label: 'Quit Snapkit', accelerator: 'CommandOrControl+Q', click: () => app.quit() }
    ])
  )
}
