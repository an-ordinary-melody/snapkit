import type { BeautifyPreset } from '@shared/settings'

/** Per-capture beautify choices: a preset plus the user's tweaks to it. */
export interface BeautifyState {
  on: boolean
  presetId: string
  padding: number
  radius: number
  shadow: number
}

export interface BeautifyLayout {
  width: number
  height: number
  /** Where the screenshot goes on the output canvas. */
  x: number
  y: number
  radius: number
  shadowBlur: number
  shadowOffsetY: number
  shadowAlpha: number
}

/**
 * Output geometry in image pixels for an image of w×h. `scale` converts the
 * preset's screen px to image px (2 on a Retina screen).
 */
export function beautifyLayout(w: number, h: number, s: Pick<BeautifyState, 'padding' | 'radius' | 'shadow'>, scale: number): BeautifyLayout {
  const pad = Math.max(0, Math.round(s.padding * scale))
  // A corner can't be rounder than half the shorter side.
  const radius = Math.min(Math.max(0, s.radius * scale), Math.min(w, h) / 2)
  const shadowAlpha = Math.min(1, Math.max(0, s.shadow))
  // Keep the shadow inside the padding so it isn't cut off.
  const shadowBlur = shadowAlpha > 0 ? Math.min(pad * 0.8, 30 * scale) : 0
  return {
    width: w + pad * 2,
    height: h + pad * 2,
    x: pad,
    y: pad,
    radius,
    shadowBlur,
    shadowOffsetY: shadowBlur * 0.3,
    shadowAlpha
  }
}

export function stateFromPreset(p: BeautifyPreset, on: boolean): BeautifyState {
  return { on, presetId: p.id, padding: p.padding, radius: p.radius, shadow: p.shadow }
}

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
