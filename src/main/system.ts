import { app, net, Notification, shell } from 'electron'
import { IPC, type LoginItemState, type UpdateCheck } from '@shared/ipc'
import { compareVersions } from '@shared/version'
import { log } from './log'
import { ipcHandle, ipcOn } from './security'
import { getSettings, updateSettings } from './settings'

const isMac = process.platform === 'darwin'

// ---- launch at login -----------------------------------------------------------

/** Read from the OS each time: the user can also change it in System Settings. */
export function loginItemState(): LoginItemState {
  const s = app.getLoginItemSettings()
  // macOS 13+ may need the user to allow it in System Settings → General → Login Items.
  const status = (s as { status?: string }).status
  return { enabled: s.openAtLogin || status === 'enabled', needsApproval: status === 'requires-approval' }
}

export function setLaunchAtLogin(enabled: boolean): LoginItemState {
  app.setLoginItemSettings({ openAtLogin: enabled })
  log(`[login item] ${enabled ? 'on' : 'off'}`)
  return loginItemState()
}

// ---- update checks ---------------------------------------------------------------

let latest: UpdateCheck | null = null
const listeners = new Set<(u: UpdateCheck) => void>()

/** The last check's result (for the menu-bar menu). */
export const lastUpdateCheck = () => latest

export function onUpdateCheck(fn: (u: UpdateCheck) => void) {
  listeners.add(fn)
}

/**
 * Compare the newest GitHub release of `updates.repo` with this version.
 * Notify-and-download: an available update opens its release page; nothing
 * is installed automatically. `manual` checks always report back; automatic
 * ones only notify once per new version.
 */
export async function checkForUpdates(manual = false): Promise<UpdateCheck> {
  const { repo } = getSettings().updates
  const current = app.getVersion()
  let result: UpdateCheck
  try {
    if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new Error('not a GitHub "owner/repo"')
    const res = await net.fetch(`https://api.github.com/repos/${repo}/releases/latest`, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': `Snapkit/${current}` },
      signal: AbortSignal.timeout(10_000)
    })
    if (res.status === 404) {
      result = { status: 'unavailable', current, message: 'No release has been published yet.' }
    } else if (!res.ok) {
      result = { status: 'error', current, message: `GitHub answered ${res.status}.` }
    } else {
      const r = (await res.json()) as { tag_name?: string; html_url?: string; name?: string; assets?: { name: string; browser_download_url: string }[] }
      const version = (r.tag_name ?? '').replace(/^v/, '')
      // The installer for this OS, when the release has one; else the release page.
      const ext = isMac ? '.dmg' : process.platform === 'win32' ? '.exe' : ''
      const asset = ext ? r.assets?.find((a) => a.name.toLowerCase().endsWith(ext)) : undefined
      const url = asset?.browser_download_url ?? r.html_url ?? `https://github.com/${repo}/releases/latest`
      const page = r.html_url ?? `https://github.com/${repo}/releases/latest`
      result = compareVersions(version, current) > 0 ? { status: 'available', current, version, url, page } : { status: 'latest', current, version }
    }
  } catch (err) {
    result = { status: 'error', current, message: err instanceof Error ? err.message : String(err) }
  }
  updateSettings({ updates: { lastCheck: Date.now() } })
  latest = result
  log(`[updates] ${manual ? 'manual' : 'auto'} check: ${result.status}${result.version ? ' ' + result.version : ''}${result.message ? ' (' + result.message + ')' : ''}`)
  if (result.status === 'available' && (manual || getSettings().updates.notified !== result.version)) {
    updateSettings({ updates: { notified: result.version } })
    notifyUpdate(result)
  }
  for (const fn of listeners) fn(result)
  return result
}

function notifyUpdate(u: UpdateCheck) {
  if (!Notification.isSupported() || !u.url) return
  const n = new Notification({ title: `Snapkit ${u.version} is available`, body: `You have ${u.current}. Click to download.`, silent: true })
  n.on('click', () => void shell.openExternal(u.url!))
  n.show()
}

/** Check a little after startup, then every 6 hours; at most once a day unless asked. */
export function scheduleUpdateChecks() {
  const maybe = () => {
    const { autoCheck, lastCheck } = getSettings().updates
    if (autoCheck && Date.now() - lastCheck > 24 * 60 * 60 * 1000) void checkForUpdates(false)
  }
  setTimeout(maybe, 30_000).unref()
  setInterval(maybe, 6 * 60 * 60 * 1000).unref()
}

export function registerSystemIpc() {
  ipcHandle(IPC.loginItemGet, () => loginItemState())
  ipcHandle(IPC.loginItemSet, (_e, enabled: boolean) => setLaunchAtLogin(!!enabled))
  ipcHandle(IPC.updatesCheck, () => checkForUpdates(true))
  ipcHandle(IPC.updatesLast, () => latest)
  ipcOn(IPC.openUrl, (_e, which: string) => {
    // Only the few places Snapkit itself links to.
    if (which === 'update' && latest?.url) void shell.openExternal(latest.url)
    else if (which === 'release' && latest?.page) void shell.openExternal(latest.page)
    else if (which === 'login-items' && isMac) void shell.openExternal('x-apple.systempreferences:com.apple.LoginItems-Settings.extension')
  })
}
