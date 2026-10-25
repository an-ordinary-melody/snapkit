import { nativeImage } from 'electron'
import type { Worker } from 'worker_threads'
import type { CompressPreset } from '@shared/settings'
import createWorker from './compressWorker?nodeWorker'
import { log } from './log'

let worker: Worker | null = null
let nextId = 1
const waiting = new Map<number, { resolve(png: Buffer): void; reject(err: Error): void }>()

/** One worker thread, started on first use, so the app never stalls while it encodes. */
function getWorker() {
  if (worker) return worker
  const w = createWorker({})
  w.on('message', ({ id, png, error }: { id: number; png?: Uint8Array; error?: string }) => {
    const job = waiting.get(id)
    waiting.delete(id)
    if (png) job?.resolve(Buffer.from(png.buffer, png.byteOffset, png.byteLength))
    else job?.reject(new Error(error ?? 'compression failed'))
  })
  w.on('error', (err: Error) => {
    log('[compress] worker failed:', String(err))
    for (const job of waiting.values()) job.reject(err)
    waiting.clear()
    worker = null
  })
  w.unref()
  worker = w
  return w
}

/**
 * A smaller PNG of `png`: at most 256 colors (text stays sharp, like TinyPNG).
 * 'smallest' also brings Retina / HiDPI captures (`scale` > 1) back to 1× size.
 * Returns the original when compressing doesn't make it smaller, or fails.
 */
export async function compressPng(png: Buffer, scale: number, preset: CompressPreset): Promise<Buffer> {
  const started = Date.now()
  try {
    let img = nativeImage.createFromBuffer(png)
    const full = img.getSize()
    const resized = preset === 'smallest' && scale > 1
    if (resized) img = img.resize({ width: Math.max(1, Math.round(full.width / scale)), height: Math.max(1, Math.round(full.height / scale)), quality: 'best' })
    const { width, height } = img.getSize()
    const bgra = new Uint8Array(img.toBitmap())
    const id = nextId++
    const out = await new Promise<Buffer>((resolve, reject) => {
      waiting.set(id, { resolve, reject })
      getWorker().postMessage({ id, bgra, width, height }, [bgra.buffer])
    })
    log(`[compress] ${preset} ${full.width}×${full.height} → ${width}×${height}: ${kb(png.length)} → ${kb(out.length)} in ${Date.now() - started} ms`)
    return out.length < png.length || resized ? out : png
  } catch (err) {
    log('[compress] kept the original:', String(err))
    return png
  }
}

const kb = (n: number) => `${Math.round(n / 1024)} KB`
