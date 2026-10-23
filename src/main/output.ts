import { app, clipboard, dialog, nativeImage, Notification, shell } from 'electron'
import { existsSync, mkdirSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { dateStamp, fileName, uniqueName } from '@shared/naming'
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
  return `Snapkit ${dateStamp(new Date())}.png`
}

export function defaultSaveFolder() {
  return getSettings().save.folder || join(app.getPath('pictures'), 'Snapkit')
}

export async function savePng(png: Buffer) {
  const settings = getSettings()
  const folder = defaultSaveFolder()
  const { name: rule, nextNumber } = settings.save
  const named = (dir: string) => join(dir, uniqueName(fileName(rule, new Date(), nextNumber), (n) => existsSync(join(dir, n))))
  let target = named(folder)

  if (settings.save.askLocation) {
    const last = settings.save.lastFolder
    const start = last && existsSync(last) ? last : folder
    mkdirSync(start, { recursive: true })
    // Snapkit is a menu-bar app with no window up now: bring it forward so the dialog gets focus.
    if (process.platform === 'darwin') app.focus({ steal: true })
    const res = await dialog.showSaveDialog({
      defaultPath: named(start),
      filters: [{ name: 'PNG image', extensions: ['png'] }]
    })
    if (res.canceled || !res.filePath) return
    target = res.filePath
    if (dirname(target) !== last) updateSettings({ save: { lastFolder: dirname(target) } })
  } else {
    mkdirSync(folder, { recursive: true })
  }

  writeFileSync(target, png)
  if (rule.number !== 'none') updateSettings({ save: { nextNumber: nextNumber + 1 } })
  if (settings.notifications.onSave) notify('Screenshot saved', target, () => shell.showItemInFolder(target))
}
