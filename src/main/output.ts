import { app, clipboard, dialog, nativeImage, Notification, shell } from 'electron'
import { existsSync, mkdirSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { getSettings, updateSettings } from './settings'

function notify(title: string, body: string, onClick?: () => void) {
  if (!Notification.isSupported()) return
  const n = new Notification({ title, body, silent: true })
  if (onClick) n.on('click', onClick)
  n.show()
}

export function copyPng(png: Buffer) {
  clipboard.writeImage(nativeImage.createFromBuffer(png))
  if (getSettings().notifications.onCopy) notify('Copied', 'Screenshot copied to clipboard')
}

export function timestampName() {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `Snapkit ${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} at ${p(d.getHours())}.${p(d.getMinutes())}.${p(d.getSeconds())}.png`
}

export function defaultSaveFolder() {
  return getSettings().save.folder || join(app.getPath('pictures'), 'Snapkit')
}

export async function savePng(png: Buffer) {
  const settings = getSettings()
  const folder = defaultSaveFolder()
  let target = join(folder, timestampName())

  if (settings.save.askLocation) {
    const last = settings.save.lastFolder
    const start = last && existsSync(last) ? last : folder
    mkdirSync(start, { recursive: true })
    // Snapkit is a menu-bar app with no window up now: bring it forward so the dialog gets focus.
    if (process.platform === 'darwin') app.focus({ steal: true })
    const res = await dialog.showSaveDialog({
      defaultPath: join(start, timestampName()),
      filters: [{ name: 'PNG image', extensions: ['png'] }]
    })
    if (res.canceled || !res.filePath) return
    target = res.filePath
    if (dirname(target) !== last) updateSettings({ save: { lastFolder: dirname(target) } })
  } else {
    mkdirSync(folder, { recursive: true })
  }

  writeFileSync(target, png)
  if (settings.notifications.onSave) notify('Screenshot saved', target, () => shell.showItemInFolder(target))
}
