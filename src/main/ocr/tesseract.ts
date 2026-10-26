import { app, nativeImage } from 'electron'
import { join } from 'path'
import type { Worker } from 'tesseract.js'
import type { OcrLine } from '@shared/ipc'
import { log } from '../log'
import type { OcrEngine } from './types'

/** Tesseract's language data: downloaded on first use (~1.6 MB Vietnamese, ~5 MB English), then kept here. */
const dataDir = () => join(app.getPath('userData'), 'ocr-data')

/** Its codes for the languages Snapkit asks for. */
const CODES: Record<string, string> = { vi: 'vie', en: 'eng' }

let worker: Promise<Worker> | null = null
let workerLangs = ''
let idleTimer: NodeJS.Timeout | null = null

/** One Tesseract worker, started on first use and closed after two idle minutes. */
function getWorker(langs: string[]) {
  const key = langs.join('+')
  if (worker && workerLangs !== key) void close()
  if (!worker) {
    workerLangs = key
    const t0 = Date.now()
    worker = import('tesseract.js').then(async ({ createWorker }) => {
      const w = await createWorker(langs, 1 /* LSTM only */, { cachePath: dataDir(), errorHandler: (e) => log('[ocr] tesseract:', String(e)) })
      log(`[ocr] tesseract ready (${key}) in ${Date.now() - t0} ms`)
      return w
    })
    worker.catch(() => (worker = null))
  }
  if (idleTimer) clearTimeout(idleTimer)
  idleTimer = setTimeout(() => void close(), 120_000)
  idleTimer.unref()
  return worker
}

async function close() {
  const w = worker
  worker = null
  await (await w?.catch(() => null))?.terminate()
}

/**
 * Tesseract (open source, runs in WebAssembly). Used on Windows to read
 * Vietnamese, which Windows' own OCR doesn't offer. Can also be chosen by hand.
 */
export const tesseract: OcrEngine = {
  id: 'tesseract',
  label: 'Tesseract',
  platforms: ['win32'],
  available: () => true,
  async recognize(png, languages) {
    const langs = [...new Set(languages.map((l) => CODES[l]).filter(Boolean))]
    const w = await getWorker(langs.length ? langs : ['eng'])
    const { width, height } = nativeImage.createFromBuffer(png).getSize()
    const { data } = await w.recognize(png, {}, { blocks: true, text: false })
    const lines: OcrLine[] = []
    for (const block of data.blocks ?? [])
      for (const p of block.paragraphs)
        for (const l of p.lines) {
          const { x0, y0, x1, y1 } = l.bbox
          lines.push({ text: l.text.trim(), x: x0 / width, y: y0 / height, w: (x1 - x0) / width, h: (y1 - y0) / height })
        }
    return lines.filter((l) => l.text)
  }
}
