import { app, dialog, globalShortcut, screen } from 'electron'
import { warmUpCapture } from './capture'
import { ensureScreenPermission, hasScreenPermission } from './permissions'
import { rebuildOverlays, registerOverlayIpc, startCapture } from './overlay'
import { getSettings } from './settings'
import { createTray } from './tray'

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', capture)
  app.whenReady().then(init)
}

/**
 * Keep this synchronous until the screen grab has started. A promise
 * continuation queued inside a native hotkey or tray callback can stall until
 * the next OS event (a mouse move or click), which made captures take seconds
 * to start, especially right after ⌘C.
 */
function capture() {
  const t0 = Date.now()
  if (hasScreenPermission()) {
    void startCapture(t0)
    return
  }
  void ensureScreenPermission().then((ok) => {
    if (ok) void startCapture(t0)
  })
}

function registerHotkey() {
  const key = getSettings().hotkeys.capture
  globalShortcut.unregisterAll()
  const ok = globalShortcut.register(key, capture)
  if (!ok) {
    dialog.showErrorBox('Snapkit', `The shortcut ${key} is already used by another app. Snapkit is still running in the menu bar / tray.`)
  }
}

function init() {
  if (process.platform === 'darwin') app.dock?.hide() // menu-bar app, no Dock icon

  warmUpCapture()
  registerOverlayIpc()
  rebuildOverlays()
  createTray(capture)
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
