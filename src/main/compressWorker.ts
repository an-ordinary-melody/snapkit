import { parentPort } from 'worker_threads'
import UPNG from 'upng-js'

/** Pixels in Electron's bitmap order (BGRA) -> a PNG with at most 256 colors. */
parentPort?.on('message', ({ id, bgra, width, height }: { id: number; bgra: Uint8Array; width: number; height: number }) => {
  try {
    for (let i = 0; i < bgra.length; i += 4) {
      const b = bgra[i]
      bgra[i] = bgra[i + 2]
      bgra[i + 2] = b
    }
    const rgba = bgra.buffer.slice(bgra.byteOffset, bgra.byteOffset + bgra.byteLength) as ArrayBuffer
    const png = new Uint8Array(UPNG.encode([rgba], width, height, 256))
    parentPort!.postMessage({ id, png }, [png.buffer])
  } catch (err) {
    parentPort!.postMessage({ id, error: String(err) })
  }
})
