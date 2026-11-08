/** Largest floating preview, in points. */
export const THUMB_MAX = { w: 240, h: 160 }
/** The preview used for captures much wider or taller than a screen: 16:9, the image fitted inside. */
export const THUMB_STANDARD = { w: 240, h: 135 }
/** Shapes wider than 3:1 or taller than 1:2 (a toolbar strip, a sidebar) get the standard preview; inside these the preview keeps the capture's shape and is at least 80 pt on its short side. */
export const THUMB_RATIO = { min: 0.5, max: 3 }

/** Floating preview size for a capture of width × height pixels. */
export function thumbSize(width: number, height: number): { w: number; h: number } {
  const ratio = width / height
  if (!(ratio >= THUMB_RATIO.min && ratio <= THUMB_RATIO.max)) return { ...THUMB_STANDARD }
  const k = Math.min(THUMB_MAX.w / width, THUMB_MAX.h / height, 1)
  return { w: Math.max(60, Math.round(width * k)), h: Math.max(40, Math.round(height * k)) }
}
