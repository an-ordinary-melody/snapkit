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

/** The latest copy: an earlier one that's still compressing doesn't overwrite it on the clipboard. */
let copySeq = 0

export async function copyPng(png: Buffer, opts: Partial<OutputOptions> = {}) {
  const mine = ++copySeq
  const out = await outputPng(png, 'copy', opts)
  if (mine !== copySeq) return
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
  const numbered = rule.number !== 'none'
  const named = (dir: string, n: number) => join(dir, uniqueName(fileName(rule, new Date(), n), (f) => existsSync(join(dir, f))))
  let target: string
  let data: Buffer

  if (settings.save.askLocation) {
    const last = settings.save.lastFolder
    const start = last && existsSync(last) ? last : folder
    mkdirSync(start, { recursive: true })
    // Snapkit is a menu-bar app with no window up now: bring it forward so the dialog gets focus.
    if (process.platform === 'darwin') app.focus({ steal: true })
    const res = await dialog.showSaveDialog({
      defaultPath: named(start, nextNumber),
      filters: [{ name: 'PNG image', extensions: ['png'] }]
    })
    if (res.canceled || !res.filePath) return
    target = res.filePath
    if (dirname(target) !== last) updateSettings({ save: { lastFolder: dirname(target) } })
    data = await outputPng(png, 'save', opts)
    writeFileSync(target, data)
    if (numbered) updateSettings({ save: { nextNumber: getSettings().save.nextNumber + 1 } })
  } else {
    // Two saves at once (compressing takes a while): each takes its number now, in the order
    // they were made, and picks a free name right before writing, so neither overwrites the other.
    if (numbered) updateSettings({ save: { nextNumber: nextNumber + 1 } })
    data = await outputPng(png, 'save', opts)
    mkdirSync(folder, { recursive: true })
    target = named(folder, nextNumber)
    writeFileSync(target, data)
  }

  if (settings.notifications.onSave) notify('Screenshot saved', target, () => shell.showItemInFolder(target))
}
