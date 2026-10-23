import type { BeautifyBackground, BeautifyPreset } from '@shared/settings'

/**
 * Output size: `auto` adapts to the captured area; `ratio` widens or heightens
 * the background to an aspect ratio; `size` is an exact size in output pixels
 * (the screenshot is scaled down to fit if needed).
 */
export type Frame = { kind: 'auto' } | { kind: 'ratio'; w: number; h: number } | { kind: 'size'; w: number; h: number }

export const FRAMES: { label: string; frame: Frame }[] = [
  { label: 'Auto', frame: { kind: 'auto' } },
  { label: 'Square 1:1', frame: { kind: 'ratio', w: 1, h: 1 } },
  { label: 'Slide 16:9', frame: { kind: 'ratio', w: 16, h: 9 } },
  { label: 'Classic 4:3', frame: { kind: 'ratio', w: 4, h: 3 } },
  { label: 'Story 9:16', frame: { kind: 'ratio', w: 9, h: 16 } }
]

/** Per-capture beautify choices: a preset plus the user's tweaks to it. */
export interface BeautifyState {
  on: boolean
  presetId: string
  /** Background picked in the editor instead of the preset's. */
  background?: BeautifyBackground
  padding: number
  radius: number
  shadow: number
  frame?: Frame
}

/** The background in effect: the editor's pick, else the preset's. */
export const backgroundOf = (s: BeautifyState, presets: BeautifyPreset[]): BeautifyBackground | null =>
  s.background ?? presets.find((p) => p.id === s.presetId)?.background ?? presets[0]?.background ?? null

export interface BeautifyLayout {
  width: number
  height: number
  /** Where the screenshot goes on the output canvas, and its drawn size. */
  x: number
  y: number
  drawW: number
  drawH: number
  radius: number
  shadowBlur: number
  shadowOffsetY: number
  shadowAlpha: number
}

/**
 * Output geometry in image pixels for an image of w×h. `scale` converts the
 * preset's screen px to image px (2 on a Retina screen). A fixed `size` frame
 * is in final output px; `frameScale` shrinks it for a smaller preview render.
 */
export function beautifyLayout(
  w: number,
  h: number,
  s: Pick<BeautifyState, 'padding' | 'radius' | 'shadow' | 'frame'>,
  scale: number,
  frameScale = 1
): BeautifyLayout {
  const pad = Math.max(0, Math.round(s.padding * scale))
  const frame = s.frame ?? { kind: 'auto' }
  let width = w + pad * 2
  let height = h + pad * 2
  let drawW = w
  let drawH = h
  if (frame.kind === 'ratio' && frame.w > 0 && frame.h > 0) {
    const r = frame.w / frame.h
    if (width / height < r) width = Math.round(height * r)
    else height = Math.round(width / r)
  } else if (frame.kind === 'size' && frame.w > 0 && frame.h > 0) {
    width = Math.round(frame.w * frameScale)
    height = Math.round(frame.h * frameScale)
    const fit = Math.min(1, Math.max(1, width - pad * 2) / w, Math.max(1, height - pad * 2) / h)
    drawW = Math.round(w * fit)
    drawH = Math.round(h * fit)
  }
  // A corner can't be rounder than half the shorter side.
  const radius = Math.min(Math.max(0, s.radius * scale), Math.min(drawW, drawH) / 2)
  const shadowAlpha = Math.min(1, Math.max(0, s.shadow))
  // Keep the shadow inside the space around the screenshot so it isn't cut off.
  const room = Math.min(width - drawW, height - drawH) / 2
  const shadowBlur = shadowAlpha > 0 ? Math.max(0, Math.min(room * 0.8, 30 * scale)) : 0
  return {
    width,
    height,
    x: Math.round((width - drawW) / 2),
    y: Math.round((height - drawH) / 2),
    drawW,
    drawH,
    radius,
    shadowBlur,
    shadowOffsetY: shadowBlur * 0.3,
    shadowAlpha
  }
}

export function stateFromPreset(p: BeautifyPreset, on: boolean, frame?: Frame): BeautifyState {
  return { on, presetId: p.id, padding: p.padding, radius: p.radius, shadow: p.shadow, frame }
}

/** What the output looks like with the background off: just the screenshot. */
export const PLAIN = { padding: 0, radius: 0, shadow: 0, frame: { kind: 'auto' } as Frame }

/** Start and end points of a CSS-style linear gradient at `angle` degrees across a w×h box. */
export function gradientLine(w: number, h: number, angle: number): [number, number, number, number] {
  const a = (angle * Math.PI) / 180
  const dx = Math.cos(a)
  const dy = Math.sin(a)
  // Half-length so the gradient spans corner to corner, like CSS.
  const half = (Math.abs(w * dx) + Math.abs(h * dy)) / 2
  const cx = w / 2
  const cy = h / 2
  return [cx - dx * half, cy - dy * half, cx + dx * half, cy + dy * half]
}
