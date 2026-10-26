import { app } from 'electron'
import { spawn } from 'child_process'
import { existsSync } from 'fs'
import { join } from 'path'
import type { OcrLine } from '@shared/ipc'
import type { OcrEngine } from './types'

/** Where a helper program is: inside the app when packaged, build/ocr/ when running from source. */
export function helperPath(file: string) {
  return app.isPackaged ? join(process.resourcesPath, 'ocr', file) : join(app.getAppPath(), 'build', 'ocr', file)
}

/** The first run on a Mac can take most of a minute while macOS prepares its text models. */
const TIMEOUT_MS = 120_000

/**
 * An engine that runs a small helper program (see native/): the PNG goes in on
 * stdin, `{"lines":[{"text","x","y","w","h"}]}` comes back on stdout, boxes as
 * fractions of the image.
 */
export function helperEngine(def: { id: string; label: string; platform: NodeJS.Platform; file: string; languageArgs(languages: string[]): string[] }): OcrEngine {
  return {
    id: def.id,
    label: def.label,
    platforms: [def.platform],
    available: () => process.platform === def.platform && existsSync(helperPath(def.file)),
    recognize: (png, languages) =>
      new Promise<OcrLine[]>((resolve, reject) => {
        const child = spawn(helperPath(def.file), def.languageArgs(languages), { windowsHide: true })
        const out: Buffer[] = []
        const err: Buffer[] = []
        const timer = setTimeout(() => {
          child.kill()
          reject(new Error(`${def.id}: no answer after ${TIMEOUT_MS / 1000} s`))
        }, TIMEOUT_MS)
        child.stdout.on('data', (d: Buffer) => out.push(d))
        child.stderr.on('data', (d: Buffer) => err.push(d))
        child.on('error', (e) => {
          clearTimeout(timer)
          reject(e)
        })
        child.on('close', (code) => {
          clearTimeout(timer)
          if (code !== 0) return reject(new Error(`${def.id} exited with ${code}: ${Buffer.concat(err).toString().trim()}`))
          try {
            const { lines } = JSON.parse(Buffer.concat(out).toString('utf8')) as { lines: OcrLine[] }
            resolve(lines.filter((l) => l.text.trim()))
          } catch (e) {
            reject(e)
          }
        })
        child.stdin.on('error', () => {}) // a helper that exits early closes stdin; 'close' reports why
        child.stdin.end(png)
      })
  }
}
