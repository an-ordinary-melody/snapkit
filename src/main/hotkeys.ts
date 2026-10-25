import { globalShortcut, Notification } from 'electron'
import { log } from './log'
import { isCapturing } from './overlay'
import { getSettings, updateSettings } from './settings'

export const HOTKEY_NAMES = ['capture', 'history', 'fullscreen', 'settings', 'lastArea'] as const
export type HotkeyName = (typeof HOTKEY_NAMES)[number]

let actions: Record<HotkeyName, () => void> | null = null

/**
 * ⌘ shortcuts capture mode handles itself (undo, redo, copy, save, settings).
 * A global hotkey set to one of them (e.g. ⌘⇧Z, which is also Redo) steps
 * aside while capturing so the key reaches capture mode.
 */
const CAPTURE_MODE_KEYS = new Set(['Z', 'Shift+Z', 'Y', 'C', 'S', ','].map((k) => `CommandOrControl+${k}`))
const stepsAside = (k: string) => isCapturing() && CAPTURE_MODE_KEYS.has(k)

/**
 * Hotkeys another app holds right now. Snapkit keeps trying them and takes
 * each one as soon as it's free (e.g. when that app quits); there's no OS
 * event for that, so it checks every few seconds while any is taken.
 */
const taken = new Set<HotkeyName>()
const RETRY_MS = 4000
let retryTimer: NodeJS.Timeout | null = null
const statusListeners: (() => void)[] = []
export const takenHotkeys = (): HotkeyName[] => [...taken]
/** Called when a hotkey becomes taken or free. */
export const onHotkeyStatus = (cb: () => void) => void statusListeners.push(cb)

/** Register one hotkey if it isn't already ours. False: another app has it. */
function claim(name: HotkeyName): boolean {
  const k = getSettings().hotkeys[name]
  if (!k || !actions || globalShortcut.isRegistered(k) || stepsAside(k)) return true
  try {
    return globalShortcut.register(k, actions[name])
  } catch {
    return true // not a valid accelerator: nothing to retry
  }
}

/** Claim every hotkey that isn't registered yet; keep retrying the taken ones. */
function claimAll() {
  let changed = false
  for (const name of HOTKEY_NAMES) {
    const k = getSettings().hotkeys[name]
    const ok = claim(name)
    if (!ok && !taken.has(name)) {
      taken.add(name)
      changed = true
      log(`[hotkeys] ${k} (${name}) is taken by another app; retrying every ${RETRY_MS / 1000} s`)
    } else if (ok && taken.has(name)) {
      taken.delete(name)
      changed = true
      log(`[hotkeys] ${k} (${name}) is free again: registered`)
    }
  }
  if (taken.size && !retryTimer) retryTimer = setInterval(claimAll, RETRY_MS)
  if (!taken.size && retryTimer) {
    clearInterval(retryTimer)
    retryTimer = null
  }
  if (changed) for (const cb of statusListeners) cb()
}

/** (Re)register every hotkey from the settings. `startup`: tell the user if the capture hotkey is taken. */
export function registerHotkeys(a: Record<HotkeyName, () => void>, startup = false) {
  actions = a
  globalShortcut.unregisterAll()
  const before = taken.size
  taken.clear()
  claimAll()
  if (!taken.size && before) for (const cb of statusListeners) cb()
  // A notification, not a dialog: a dialog would block Snapkit (and these retries) until it's closed.
  if (startup && taken.has('capture') && Notification.isSupported()) {
    const k = getSettings().hotkeys.capture.replace('CommandOrControl', process.platform === 'darwin' ? '⌘' : 'Ctrl')
    new Notification({
      title: `${k} is used by another app`,
      body: `Snapkit takes it once it's free. Meanwhile, use the menu bar or pick another in Settings.`,
      silent: true
    }).show()
  }
}

/** Capture mode opened or closed: shortcuts that are also capture-mode keys step aside, then come back. */
export function captureModeChanged(on: boolean) {
  const keys = getSettings().hotkeys
  if (on) {
    for (const name of HOTKEY_NAMES) if (keys[name] && CAPTURE_MODE_KEYS.has(keys[name])) globalShortcut.unregister(keys[name])
  } else claimAll()
}

/** Switch a hotkey from the settings window. Keeps the old one if the new one can't be used. '' turns it off (not the capture hotkey). */
export function setHotkey(name: HotkeyName, accelerator: string): string | null {
  if (!actions) return null
  const old = getSettings().hotkeys[name]
  if (accelerator === old) return null
  if (old) globalShortcut.unregister(old)
  if (!accelerator && name !== 'capture') {
    updateSettings({ hotkeys: { [name]: '' } })
    return null
  }
  let ok = false
  try {
    ok = globalShortcut.register(accelerator, actions[name])
  } catch {
    ok = false // not a valid accelerator
  }
  if (!ok) {
    if (old) globalShortcut.register(old, actions[name])
    return `${accelerator.replace('CommandOrControl', process.platform === 'darwin' ? '⌘' : 'Ctrl')} is taken by another app or the system.`
  }
  updateSettings({ hotkeys: { [name]: accelerator } })
  return null
}
