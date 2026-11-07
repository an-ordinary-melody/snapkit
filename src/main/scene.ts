import { app, nativeImage, screen, type Display } from 'electron'
import { readFileSync } from 'fs'
import { dirname, join } from 'path'
import type { ArmPayload, OcrResult } from '@shared/ipc'
import type { ScreenGrab } from './capture'

/**
 * Test only: e2e/scene.mjs renders scene files (fixtures/scenes/*.json) so the
 * same states can be compared with the native Mac app. With SNAPKIT_SCENE set,
 * capture mode shows the scene's frozen screen, selection and drawings instead
 * of the real screen. Never active in a packaged app.
 */
interface Scene {
  /** The frozen screen, relative to fixtures/ (e.g. screens/bands-1470x956@2.png). */
  screen?: string
  selection?: { x: number; y: number; w: number; h: number }
  shapes?: unknown[]
  tool?: string
  selectedShape?: string
  ocr?: OcrResult
  window?: string
  /** BeautifyState for the background editor. */
  beautify?: unknown
}

const path = !app.isPackaged ? process.env.SNAPKIT_SCENE : undefined
export const scene: Scene | null = path ? JSON.parse(readFileSync(path, 'utf8')) : null

/** fixtures/ (SNAPKIT_FIXTURES, or the folder above the scene file's). */
const fixtures = () => process.env.SNAPKIT_FIXTURES ?? join(dirname(path ?? ''), '..')

/** The scene's screen image as a grab of the primary display, sized to the image (in points). */
export function sceneGrab(): ScreenGrab[] {
  const img = nativeImage.createFromPath(join(fixtures(), scene!.screen!))
  const { width, height } = img.getSize()
  const primary = screen.getPrimaryDisplay()
  const scale = Number(/@(\d+(?:\.\d+)?)\./.exec(scene!.screen!)?.[1] ?? primary.scaleFactor)
  const bounds = { ...primary.bounds, width: Math.round(width / scale), height: Math.round(height / scale) }
  const display: Display = { ...primary, bounds, size: { width: bounds.width, height: bounds.height } }
  const bgra = img.toBitmap()
  return [
    {
      display,
      width,
      height,
      // toBitmap is BGRA; the overlay wants RGBA.
      pixels: async () => {
        const rgba = new Uint8Array(bgra.length)
        for (let i = 0; i < bgra.length; i += 4) {
          rgba[i] = bgra[i + 2]
          rgba[i + 1] = bgra[i + 1]
          rgba[i + 2] = bgra[i]
          rgba[i + 3] = bgra[i + 3]
        }
        return rgba
      },
      png: async () => img.toPNG()
    }
  ]
}

/** The selection and starting state the scene asks for. */
export function sceneArm(arm: ArmPayload) {
  if (!scene) return
  if (scene.selection) arm.area = scene.selection
  arm.scene = { shapes: scene.shapes, tool: scene.tool, selectedShape: scene.selectedShape, ocr: scene.ocr, beautify: scene.beautify, editor: scene.window === 'editor' }
}
