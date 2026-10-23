/** Color helpers for the custom color picker. h: 0–360, s/v: 0–1. */

export interface Hsv {
  h: number
  s: number
  v: number
}

/** Normalise "#abc", "abc", "#aabbcc" to "#aabbcc", or null if it isn't a hex color. */
export function parseHex(input: string): string | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(input.trim())
  if (!m) return null
  const h = m[1].length === 3 ? [...m[1]].map((c) => c + c).join('') : m[1]
  return '#' + h.toLowerCase()
}

export function hexToHsv(hex: string): Hsv {
  const n = parseInt((parseHex(hex) ?? '#000000').slice(1), 16)
  const r = ((n >> 16) & 255) / 255
  const g = ((n >> 8) & 255) / 255
  const b = (n & 255) / 255
  const max = Math.max(r, g, b)
  const d = max - Math.min(r, g, b)
  let h = 0
  if (d) {
    if (max === r) h = ((g - b) / d) % 6
    else if (max === g) h = (b - r) / d + 2
    else h = (r - g) / d + 4
  }
  return { h: (h * 60 + 360) % 360, s: max ? d / max : 0, v: max }
}

/** Black or white, whichever reads better on `hex`. */
export function readableOn(hex: string) {
  return isLight(hex) ? '#111111' : '#ffffff'
}

export function isLight(hex: string) {
  const c = parseHex(hex)
  if (!c) return false
  const n = parseInt(c.slice(1), 16)
  return (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255 > 0.6
}

export function hsvToHex({ h, s, v }: Hsv): string {
  const f = (k: number) => {
    const x = (k + h / 60) % 6
    return v - v * s * Math.max(0, Math.min(x, 4 - x, 1))
  }
  const to = (c: number) => Math.round(c * 255).toString(16).padStart(2, '0')
  return `#${to(f(5))}${to(f(3))}${to(f(1))}`
}
