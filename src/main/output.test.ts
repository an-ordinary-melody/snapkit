import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { applyPatch, defaultsFor, mergeSettings, type Settings } from '@shared/settings'

// Concurrent outputs (docs/state-machines.md, "Outputs"): compression runs on a worker thread,
// so two copies or saves made close together overlap.

const clipboardWrites: string[] = []
let settings: Settings
let folder: string

vi.mock('electron', () => ({
  app: { getPath: () => folder, focus: () => {} },
  clipboard: { writeImage: (img: { tag: string }) => clipboardWrites.push(img.tag) },
  nativeImage: { createFromBuffer: (b: Buffer) => ({ tag: b.toString() }) },
  dialog: { showSaveDialog: async () => ({ canceled: true }) },
  Notification: { isSupported: () => false },
  shell: {}
}))
vi.mock('./clipboardPng', () => ({ writePngExact: (b: Buffer) => clipboardWrites.push(b.toString()) }))
// "Compressing" takes as long as the image's name says (big: 50 ms, small: 5 ms).
vi.mock('./compress', () => ({
  compressPng: (png: Buffer) => new Promise<Buffer>((r) => setTimeout(() => r(Buffer.from(png.toString() + ' compressed')), png.toString().startsWith('big') ? 50 : 5))
}))
vi.mock('./settings', () => ({
  getSettings: () => settings,
  updateSettings: (patch: object) => (settings = mergeSettings(settings, applyPatch({}, patch as Record<string, unknown>)))
}))

const { copyPng, savePng } = await import('./output')

beforeEach(() => {
  folder = mkdtempSync(join(tmpdir(), 'snapkit-output-'))
  clipboardWrites.length = 0
  settings = mergeSettings(defaultsFor('darwin'), {
    compress: { enabled: true },
    save: { folder, askLocation: false, name: { text: 'Bug', date: 'none', number: 'after', digits: 3 }, nextNumber: 1 },
    notifications: { onCopy: false, onSave: false }
  })
})
afterEach(() => rmSync(folder, { recursive: true, force: true }))

describe('concurrent outputs', () => {
  it('the clipboard ends up with the last copy, even when an earlier one compresses longer', async () => {
    await Promise.all([copyPng(Buffer.from('big capture')), copyPng(Buffer.from('small capture'))])
    expect(clipboardWrites.at(-1)).toBe('small capture compressed')
  })

  it('two saves at once get two files and two numbers', async () => {
    await Promise.all([savePng(Buffer.from('big capture')), savePng(Buffer.from('small capture'))])
    const files = readdirSync(folder).sort()
    expect(files).toEqual(['Bug 001.png', 'Bug 002.png'])
    expect(readFileSync(join(folder, 'Bug 001.png'), 'utf8')).toBe('big capture compressed')
    expect(settings.save.nextNumber).toBe(3)
  })
})
