import { desktopCapturer, dialog, shell, systemPreferences } from 'electron'

let requested = false

/** Synchronous so the hotkey path can start capturing without awaiting anything. */
export function hasScreenPermission(): boolean {
  return process.platform !== 'darwin' || systemPreferences.getMediaAccessStatus('screen') === 'granted'
}

/**
 * macOS only: Screen Recording permission. Without it captures contain only
 * the wallpaper, so we stop and explain how to grant it instead.
 * Returns true when it's OK to capture.
 */
export async function ensureScreenPermission(): Promise<boolean> {
  if (hasScreenPermission()) return true

  // Asking for a capture once makes macOS list Snapkit in System Settings
  // (and shows the system prompt the very first time).
  if (!requested) {
    requested = true
    await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 1, height: 1 } }).catch(() => {})
    if (systemPreferences.getMediaAccessStatus('screen') === 'granted') return true
  }

  const { response } = await dialog.showMessageBox({
    type: 'info',
    message: 'Snapkit needs Screen Recording permission',
    detail:
      'Open System Settings → Privacy & Security → Screen & System Audio Recording and turn on Snapkit.\n\n' +
      'If Snapkit is already listed and turned on (for example after an update), remove it with the “–” button and add it again.\n\n' +
      'Then quit and reopen Snapkit.',
    buttons: ['Open System Settings', 'Cancel'],
    defaultId: 0,
    cancelId: 1
  })
  if (response === 0) {
    await shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture')
  }
  return false
}
