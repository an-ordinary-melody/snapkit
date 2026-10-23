import { app, dialog, globalShortcut, screen } from 'electron'
import { warmUpCapture } from './capture'
import { log } from './log'
import { ensureScreenPermission } from './permissions'
import { rebuildOverlays, registerOverlayIpc, startCapture } from './overlay'
import { getSettings } from './settings'
import { createTray } from './tray'

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => capture())
  app.whenReady().then(init)
}

async function capture() {
  const t0 = Date.now()
  if (!(await ensureScreenPermission())) return
  log(`hotkey → permission checked in ${Date.now() - t0}ms`)
  await startCapture(t0)
}

function registerHotkey() {
  const key = getSettings().hotkeys.capture
  globalShortcut.unregisterAll()
  const ok = globalShortcut.register(key, () => void capture())
  if (!ok) {
    dialog.showErrorBox('Snapkit', `The shortcut ${key} is already used by another app. Snapkit is still running in the menu bar / tray.`)
  }
}

function init() {
  if (process.platform === 'darwin') app.dock?.hide() // menu-bar app, no Dock icon

  warmUpCapture()
  registerOverlayIpc()
  rebuildOverlays()
  createTray(() => void capture())
  registerHotkey()

  let rebuildTimer: NodeJS.Timeout | undefined
  const scheduleRebuild = () => {
    clearTimeout(rebuildTimer)
    rebuildTimer = setTimeout(rebuildOverlays, 300)
  }
  screen.on('display-added', scheduleRebuild)
  screen.on('display-removed', scheduleRebuild)
  screen.on('display-metrics-changed', scheduleRebuild)
}

// Keep running in the tray when windows close.
app.on('window-all-closed', () => {})
app.on('will-quit', () => globalShortcut.unregisterAll())
