import type { OcrLine } from '@shared/ipc'

/**
 * A way to read text in an image. Engines are swappable, like the capture
 * engines: each OS has its own (see ./index.ts) and the ocr.engine setting can
 * force one. A new engine (Tesseract, an ONNX model, a cloud service) only
 * needs to implement this and be added to ENGINES.
 */
export interface OcrEngine {
  id: string
  label: string
  /** Platforms it can run on (process.platform values). */
  platforms: NodeJS.Platform[]
  /** Usable on this machine (e.g. its helper program is there). */
  available(): boolean
  /** The text lines in `png`, top to bottom. Throws if it can't read the image. */
  recognize(png: Buffer, languages: string[]): Promise<OcrLine[]>
}
