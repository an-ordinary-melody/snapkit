import { clipboard } from 'electron'
import type { OcrResult } from '@shared/ipc'
import { log } from '../log'
import { helperEngine } from './helper'
import type { OcrEngine } from './types'

/** macOS: Apple's Vision (native/ocr-mac). Language codes are Vision's (Vietnamese is vi-VT). */
const vision = helperEngine({
  id: 'vision',
  label: 'Apple Vision',
  platform: 'darwin',
  file: 'snapkit-ocr',
  languageArgs: (langs) => langs.map((l) => (l === 'vi' ? 'vi-VT' : l === 'en' ? 'en-US' : l))
})

/** Windows: the OCR built into Windows 10+ (native/ocr-win). Reads the languages whose OCR pack is installed. */
const windows = helperEngine({
  id: 'windows',
  label: 'Windows OCR',
  platform: 'win32',
  file: 'snapkit-ocr.exe',
  languageArgs: (langs) => langs
})

/** Every engine Snapkit knows. Add new ones here. */
export const OCR_ENGINES: OcrEngine[] = [vision, windows]

/** For the settings window: this OS's engines and whether each can run here. */
export function ocrEngineInfo() {
  return OCR_ENGINES.filter((e) => e.platforms.includes(process.platform)).map((e) => ({ id: e.id, label: e.label, available: e.available() }))
}

/** Languages to read, most likely first. */
const LANGUAGES = ['vi', 'en']

/** 'auto' picks the first engine for this OS; an engine id forces that one. */
export function ocrEngineFor(choice = 'auto'): OcrEngine | null {
  const usable = OCR_ENGINES.filter((e) => e.platforms.includes(process.platform) && e.available())
  return usable.find((e) => e.id === choice) ?? usable[0] ?? null
}

/** Read `png` and copy its text. Returns the number of lines copied (0: no text), or -1 if it couldn't be read. */
export async function copyTextFrom(png: Buffer, choice = 'auto'): Promise<number> {
  try {
    const { lines } = await recognizeText(png, choice)
    if (lines.length) clipboard.writeText(lines.map((l) => l.text).join('\n'))
    return lines.length
  } catch (err) {
    log('[ocr] failed:', String(err))
    return -1
  }
}

/** The text in `png` (top to bottom), with the engine that read it and how long it took. */
export async function recognizeText(png: Buffer, choice = 'auto'): Promise<OcrResult> {
  const engine = ocrEngineFor(choice)
  if (!engine) throw new Error('No text recognition on this computer')
  const t0 = Date.now()
  const lines = await engine.recognize(png, LANGUAGES)
  const ms = Date.now() - t0
  log(`[ocr] ${engine.id}: ${lines.length} line(s) in ${ms} ms`)
  return { lines, engine: engine.id, ms }
}
