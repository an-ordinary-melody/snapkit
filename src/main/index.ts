import { app, globalShortcut, screen } from 'electron'
import { rmSync } from 'fs'
import { join } from 'path'
import { setPreferredEngine, warmUpCapture } from './capture'
import { captureFullScreen, captureRect } from './fullscreen'
import { lastArea } from './lastArea'
import { captureModeChanged, registerHotkeys, setHotkey } from './hotkeys'
import { lockDownWebContents } from './security'
import { onUpdateCheck, registerSystemIpc, scheduleUpdateChecks } from './system'
import { ensureScreenPermission, hasScreenPermission } from './permissions'
import { forceEndCapture, isCapturing, onCaptureMode, rebuildOverlays, registerOverlayIpc, startCapture } from './overlay'
import { registerPinIpc } from './pin'
import { loadHistory, prune, saveIndex } from './history'
import { preloadHistoryPanel, registerHistoryIpc, toggleHistoryPanel } from './historyPanel'
import { flushSettings, getSettings, onSettingsChange } from './settings'
import { isSettingsOpen, openSettingsWindow, registerSettingsIpc } from './settingsWindow'
import { createTray, refreshTrayMenu } from './tray'

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  lockDownWebContents()
  // Opening Snapkit again captures; --history opens the history panel, --fullscreen captures the whole screen.
  app.on('second-instance', (_e, argv: string[] = []) =>
    argv.includes('--history')
      ? toggleHistoryPanel()
      : argv.includes('--fullscreen')
        ? fullscreen()
        : argv.includes('--last-area')
          ? captureLastArea()
          : argv.includes('--text')
            ? captureText()
            : capture()
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

/**
 * "Capture last area": the area last copied or saved (or the whole screen after a full-screen
 * capture), copied right away or opened selected in capture mode. Nothing yet: a normal capture.
 */
function captureLastArea() {
  const t0 = Date.now()
  const go = () => {
    const last = isCapturing() ? null : lastArea()
    if (!last) return void startCapture(t0)
    if (getSettings().capture.lastAreaInstant) captureRect(last.display, last.rect, t0)
    else void startCapture(t0, last)
  }
  if (hasScreenPermission()) return go()
  void ensureScreenPermission().then((ok) => ok && go())
}

/** "Capture text": drag an area and its text is read. Synchronous until the screen grab has started, like capture(). */
function captureText() {
  const t0 = Date.now()
  if (hasScreenPermission()) return void startCapture(t0, undefined, true)
  void ensureScreenPermission().then((ok) => {
    if (ok) void startCapture(t0, undefined, true)
  })
}

const HOTKEY_ACTIONS = {
  capture,
  history: () => toggleHistoryPanel(),
  fullscreen: () => fullscreen(),
  settings: () => openSettings(),
  lastArea: captureLastArea,
  ocr: captureText
}

/** From anywhere, capture mode included (it closes, so the window isn't hidden behind it). */
function openSettings() {
  if (isCapturing()) forceEndCapture('settings opened')
  openSettingsWindow()
}

/** Like capture(): synchronous until the screen grab has started. */
function fullscreen() {
  const t0 = Date.now()
  if (hasScreenPermission()) return captureFullScreen(t0)
  void ensureScreenPermission().then((ok) => ok && captureFullScreen(t0))
}
function init() {
  if (process.platform === 'darwin') {
    app.dock?.hide() // menu-bar app: a Dock icon only while Settings is open
    app.on('activate', () => isSettingsOpen() && openSettingsWindow())
  }

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
  createTray(capture, openSettings, toggleHistoryPanel, fullscreen, captureLastArea, captureText)
  registerHotkeys(HOTKEY_ACTIONS, true)
  onCaptureMode(captureModeChanged)
  registerSettingsIpc(setHotkey)
  registerSystemIpc()
  scheduleUpdateChecks()
  onUpdateCheck(() => refreshTrayMenu()) // shows "Update available" in the menu
  // The menu shows the hotkey; reset-to-defaults can change it too.
  onSettingsChange((s, prev) => {
    if (JSON.stringify(s.hotkeys) !== JSON.stringify(prev.hotkeys)) registerHotkeys(HOTKEY_ACTIONS)
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
