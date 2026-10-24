import { app, dialog, globalShortcut, screen } from 'electron'
import { rmSync } from 'fs'
import { join } from 'path'
import { setPreferredEngine, warmUpCapture } from './capture'
import { captureFullScreen } from './fullscreen'
import { log } from './log'
import { lockDownWebContents } from './security'
import { onUpdateCheck, registerSystemIpc, scheduleUpdateChecks } from './system'
import { ensureScreenPermission, hasScreenPermission } from './permissions'
import { rebuildOverlays, registerOverlayIpc, startCapture } from './overlay'
import { registerPinIpc } from './pin'
import { loadHistory, prune, saveIndex } from './history'
import { preloadHistoryPanel, registerHistoryIpc, toggleHistoryPanel } from './historyPanel'
import { flushSettings, getSettings, onSettingsChange, updateSettings } from './settings'
import { openSettingsWindow, registerSettingsIpc } from './settingsWindow'
import { createTray, refreshTrayMenu } from './tray'

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  lockDownWebContents()
  // Opening Snapkit again captures; --history opens the history panel, --fullscreen captures the whole screen.
  app.on('second-instance', (_e, argv: string[] = []) =>
    argv.includes('--history') ? toggleHistoryPanel() : argv.includes('--fullscreen') ? fullscreen() : capture()
  )
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

const HOTKEY_ACTIONS = { capture, history: () => toggleHistoryPanel(), fullscreen: () => fullscreen() }

/** Like capture(): synchronous until the screen grab has started. */
function fullscreen() {
  const t0 = Date.now()
  if (hasScreenPermission()) return captureFullScreen(t0)
  void ensureScreenPermission().then((ok) => ok && captureFullScreen(t0))
}
type HotkeyName = keyof typeof HOTKEY_ACTIONS

function registerHotkey() {
  const keys = getSettings().hotkeys
  globalShortcut.unregisterAll()
  if (!globalShortcut.register(keys.capture, capture)) {
    dialog.showErrorBox('Snapkit', `The shortcut ${keys.capture} is already used by another app. Snapkit is still running in the menu bar / tray.`)
  }
  // These are optional: if one is taken, the menu-bar menu still has the action.
  for (const name of ['history', 'fullscreen'] as const) {
    if (!keys[name]) continue
    try {
      if (!globalShortcut.register(keys[name], HOTKEY_ACTIONS[name])) log(`[hotkeys] ${keys[name]} (${name}) is taken by another app`)
    } catch {
      // invalid accelerator in settings
    }
  }
}

/** Switch a hotkey from the settings window. Keeps the old one if the new one can't be used. '' turns it off (not the capture hotkey). */
function setHotkey(name: HotkeyName, accelerator: string): string | null {
  const old = getSettings().hotkeys[name]
  if (accelerator === old) return null
  if (old) globalShortcut.unregister(old)
  if (!accelerator && name !== 'capture') {
    updateSettings({ hotkeys: { [name]: '' } })
    return null
  }
  let ok = false
  try {
    ok = globalShortcut.register(accelerator, HOTKEY_ACTIONS[name])
  } catch {
    ok = false // not a valid accelerator
  }
  if (!ok) {
    if (old) globalShortcut.register(old, HOTKEY_ACTIONS[name])
    return `${accelerator.replace('CommandOrControl', process.platform === 'darwin' ? '⌘' : 'Ctrl')} can't be used. It may be taken by another app or by the system.`
  }
  updateSettings({ hotkeys: { [name]: accelerator } })
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
  loadHistory()
  // The age limit also applies while Snapkit stays open for days.
  setInterval(() => void prune(), 6 * 60 * 60 * 1000).unref()
  registerHistoryIpc()
  preloadHistoryPanel()
  createTray(capture, openSettingsWindow, toggleHistoryPanel, fullscreen)
  registerHotkey()
  registerSettingsIpc(setHotkey)
  registerSystemIpc()
  scheduleUpdateChecks()
  onUpdateCheck(() => refreshTrayMenu()) // shows "Update available" in the menu
  // The menu shows the hotkey; reset-to-defaults can change it too.
  onSettingsChange((s, prev) => {
    if (JSON.stringify(s.hotkeys) !== JSON.stringify(prev.hotkeys)) registerHotkey()
    const limits = ({ panel: _, ...h }: typeof s.history) => JSON.stringify(h)
    if (limits(s.history) !== limits(prev.history)) void prune() // new limits apply now
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
  saveIndex()
})
