import { app, dialog, globalShortcut, screen } from 'electron'
import { rmSync } from 'fs'
import { join } from 'path'
import { setPreferredEngine, warmUpCapture } from './capture'
import { lockDownWebContents } from './security'
import { ensureScreenPermission, hasScreenPermission } from './permissions'
import { rebuildOverlays, registerOverlayIpc, startCapture } from './overlay'
import { registerPinIpc } from './pin'
import { flushSettings, getSettings, onSettingsChange, updateSettings } from './settings'
import { openSettingsWindow, registerSettingsIpc } from './settingsWindow'
import { createTray, refreshTrayMenu } from './tray'

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  lockDownWebContents()
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

/** Switch the capture hotkey from the settings window. Keeps the old one if the new one can't be used. */
function setHotkey(accelerator: string): string | null {
  const old = getSettings().hotkeys.capture
  if (accelerator === old) return null
  globalShortcut.unregister(old)
  let ok = false
  try {
    ok = globalShortcut.register(accelerator, capture)
  } catch {
    ok = false // not a valid accelerator
  }
  if (!ok) {
    globalShortcut.register(old, capture)
    return `${accelerator.replace('CommandOrControl', process.platform === 'darwin' ? '⌘' : 'Ctrl')} can't be used. It may be taken by another app or by the system.`
  }
  updateSettings({ hotkeys: { capture: accelerator } })
  return null
}

function init() {
  if (process.platform === 'darwin') app.dock?.hide() // menu-bar app, no Dock icon

  // Drag-out files left by a previous run (pins are gone, so are their files).
  rmSync(join(app.getPath('temp'), 'Snapkit'), { recursive: true, force: true })
  setPreferredEngine(getSettings().capture.engine)
  warmUpCapture()
  registerOverlayIpc()
  registerPinIpc()
  rebuildOverlays()
  createTray(capture, openSettingsWindow)
  registerHotkey()
  registerSettingsIpc(setHotkey)
  // The menu shows the hotkey; reset-to-defaults can change it too.
  onSettingsChange((s, prev) => {
    if (s.hotkeys.capture !== prev.hotkeys.capture) registerHotkey()
    if (s.capture.engine !== prev.capture.engine) setPreferredEngine(s.capture.engine)
    refreshTrayMenu()
  })

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
app.on('will-quit', () => {
  globalShortcut.unregisterAll()
  flushSettings() // a change made just before quitting still gets saved
})
