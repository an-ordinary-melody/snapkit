import { app, clipboard, dialog, nativeImage, Notification, shell } from 'electron'
import { existsSync, mkdirSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { dateStamp, fileName, uniqueName } from '@shared/naming'
import type { OutputOptions } from '@shared/ipc'
import { compressesFor } from '@shared/settings'
import { writePngExact } from './clipboardPng'
import { compressPng } from './compress'
import { getSettings, updateSettings } from './settings'

function notify(title: string, body: string, onClick?: () => void) {
  if (!Notification.isSupported()) return
  const n = new Notification({ title, body, silent: true })
  if (onClick) n.on('click', onClick)
  n.show()
}

/** The PNG to write for this output: compressed when the setting (or the editor's switch) says so. */
/** `compress`: the Compress switch (default: the setting). `scale`: image px per screen point. */
async function outputPng(png: Buffer, output: 'copy' | 'save', opts: Partial<OutputOptions>) {
  const c = getSettings().compress
  if (!compressesFor(c.applyTo, opts.compress ?? c.enabled, output)) return png
  return compressPng(png, opts.scale ?? 1, opts.preset ?? c.preset)
}

export async function copyPng(png: Buffer, opts: Partial<OutputOptions> = {}) {
  const out = await outputPng(png, 'copy', opts)
  if (out === png) clipboard.writeImage(nativeImage.createFromBuffer(png))
  else writePngExact(out)
  if (getSettings().notifications.onCopy) notify('Copied', 'Screenshot copied to clipboard')
}

export function timestampName() {
  return `Snapkit ${dateStamp(new Date())}.png`
}

export function defaultSaveFolder() {
  return getSettings().save.folder || join(app.getPath('pictures'), 'Snapkit')
}

export async function savePng(png: Buffer, opts: Partial<OutputOptions> = {}) {
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

  writeFileSync(target, await outputPng(png, 'save', opts))
  if (rule.number !== 'none') updateSettings({ save: { nextNumber: nextNumber + 1 } })
  if (settings.notifications.onSave) notify('Screenshot saved', target, () => shell.showItemInFolder(target))
}
