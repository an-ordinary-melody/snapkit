/**
 * Annotation data model. Pure data and functions only, so it can be unit
 * tested and later reused by the editor in history (Phase 6).
 *
 * All coordinates are in overlay (screen) CSS pixels, the same space as the
 * selection rect. Export scales them up to image pixels.
 */

export type ToolId = 'pen' | 'line' | 'arrow' | 'rect' | 'ellipse' | 'highlighter' | 'text' | 'step' | 'blur'

interface Base {
  id: string
}

export interface StrokeShape extends Base {
  type: 'pen' | 'highlighter'
  /** Flat [x1, y1, x2, y2, ...] list. */
  points: number[]
  color: string
  width: number
}

export interface LineShape extends Base {
  type: 'line' | 'arrow'
  points: [number, number, number, number]
  color: string
  width: number
  /** Arrows: a solid triangle (default) or two strokes. */
  head?: 'filled' | 'open'
  /** Arrows: a head at the start too (two-way). */
  bothEnds?: boolean
}

/** The two short strokes of an open arrow head, as [x1, y1, tipX, tipY, x2, y2]. */
export function openArrowHead(points: LineShape['points'], length: number): number[] {
  const [x1, y1, x2, y2] = points
  const a = Math.atan2(y2 - y1, x2 - x1)
  const spread = Math.PI / 6.5
  return [
    x2 - length * Math.cos(a - spread), y2 - length * Math.sin(a - spread),
    x2, y2,
    x2 - length * Math.cos(a + spread), y2 - length * Math.sin(a + spread)
  ]
}

export interface BoxShape extends Base {
  type: 'rect' | 'ellipse'
  x: number
  y: number
  w: number
  h: number
  color: string
  width: number
  /** Solid fill instead of an outline. */
  filled?: boolean
}

export interface BlurShape extends Base {
  type: 'blur'
  x: number
  y: number
  w: number
  h: number
  mode: 'pixelate' | 'blur'
  /** Pixel block size / blur radius, in overlay px. */
  strength: number
}

export interface StepShape extends Base {
  type: 'step'
  /** Center. */
  x: number
  y: number
  size: number
  color: string
}

export interface TextShape extends Base {
  type: 'text'
  /** Top-left of the text box. */
  x: number
  y: number
  text: string
  color: string
  fontSize: number
  fontFamily: string
  /** Drop shadow strength, 0–1 (0 = none). */
  shadow: number
  /** Fill behind the text, or '' for none. */
  background: string
  /** Outline around the letters, or '' for none. */
  stroke?: string
  strokeWidth?: number
}

export type Shape = StrokeShape | LineShape | BoxShape | BlurShape | StepShape | TextShape

/** Current style choices, shared by every tool. */
export interface Style {
  /** Color for shapes, lines and steps. */
  color: string
  /** Text has its own color, so a text background style can pick a readable one without changing the other tools. */
  textColor: string
  /** The highlighter has its own (light) colors too. */
  highlighterColor: string
  /** And numbered steps their own badge color. */
  stepColor: string
  /** Index into the stroke width presets. */
  widthIndex: number
  blurMode: 'pixelate' | 'blur'
  blurStrength: number
  fontSize: number
  fontFamily: string
  /** Text shadow strength, 0–1. */
  shadow: number
  /** Text fill behind the letters ('' = none) and outline ('' = none). Only one is used at a time. */
  textBackground: string
  textStroke: string
  /** Remembered choices, used when switching the text style back to them. */
  textStrokeColor: string
  textBgColor: string
  textStrokeWidth: number
}

let counter = 0
export const newId = () => `s${Date.now().toString(36)}${(counter++).toString(36)}`

/** Step numbers follow drawing order, so deleting step 2 renumbers 3 → 2. */
export function stepNumbers(shapes: Shape[]): Map<string, number> {
  const out = new Map<string, number>()
  let n = 0
  for (const s of shapes) if (s.type === 'step') out.set(s.id, ++n)
  return out
}

/** Snap (dx, dy) to the nearest 45° direction, keeping its length. */
export function snap45(dx: number, dy: number): [number, number] {
  const len = Math.hypot(dx, dy)
  const angle = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4)
  return [Math.round(Math.cos(angle) * len) || 0, Math.round(Math.sin(angle) * len) || 0]
}

/** Box from a drag; with `square`, the shorter side grows to match the longer one. */
export function boxFromDrag(x0: number, y0: number, x1: number, y1: number, square = false) {
  let dx = x1 - x0
  let dy = y1 - y0
  if (square) {
    const m = Math.max(Math.abs(dx), Math.abs(dy))
    dx = Math.sign(dx || 1) * m
    dy = Math.sign(dy || 1) * m
  }
  return { x: Math.min(x0, x0 + dx), y: Math.min(y0, y0 + dy), w: Math.abs(dx), h: Math.abs(dy) }
}

/** Shapes too small to mean anything (a click without a drag) are dropped. */
export function isMeaningful(s: Shape): boolean {
  switch (s.type) {
    case 'pen':
    case 'highlighter':
      return s.points.length >= 4
    case 'line':
    case 'arrow':
      return Math.hypot(s.points[2] - s.points[0], s.points[3] - s.points[1]) >= 4
    case 'rect':
    case 'ellipse':
    case 'blur':
      return s.w >= 4 && s.h >= 4
    case 'text':
      return s.text.trim().length > 0
    case 'step':
      return true
  }
}

export function moveShape(s: Shape, dx: number, dy: number): Shape {
  switch (s.type) {
    case 'pen':
    case 'highlighter':
      return { ...s, points: s.points.map((v, i) => v + (i % 2 ? dy : dx)) }
    case 'line':
    case 'arrow':
      return { ...s, points: [s.points[0] + dx, s.points[1] + dy, s.points[2] + dx, s.points[3] + dy] }
    default:
      return { ...s, x: s.x + dx, y: s.y + dy }
  }
}

// ---- undo / redo -------------------------------------------------------------

export interface History {
  past: Shape[][]
  present: Shape[]
  future: Shape[][]
  /** Merge key of the last commit (see `commit`). */
  mergeKey?: string
}

export const emptyHistory = (): History => ({ past: [], present: [], future: [] })

/**
 * Record a new state. No-op if nothing changed. Consecutive commits with the
 * same `mergeKey` (e.g. dragging a slider) become a single undo step.
 */
export function commit(h: History, next: Shape[], mergeKey?: string): History {
  if (next === h.present) return h
  if (mergeKey && mergeKey === h.mergeKey) return { ...h, present: next, future: [] }
  return { past: [...h.past, h.present], present: next, future: [], mergeKey }
}

export function undo(h: History): History {
  if (!h.past.length) return h
  return { past: h.past.slice(0, -1), present: h.past[h.past.length - 1], future: [h.present, ...h.future] }
}

export function redo(h: History): History {
  if (!h.future.length) return h
  return { past: [...h.past, h.present], present: h.future[0], future: h.future.slice(1) }
}

export const upsert = (shapes: Shape[], s: Shape) =>
  shapes.some((x) => x.id === s.id) ? shapes.map((x) => (x.id === s.id ? s : x)) : [...shapes, s]

export const remove = (shapes: Shape[], id: string) => shapes.filter((x) => x.id !== id)

// ---- smart snapping ------------------------------------------------------------

export interface Box {
  x: number
  y: number
  w: number
  h: number
}

/** A guide line to show while snapped: vertical at x (from y1 to y2), or horizontal at y. */
export type Guide = { dir: 'v'; at: number; from: number; to: number } | { dir: 'h'; at: number; from: number; to: number }

/**
 * Snap a moving box so its left/center/right (and top/middle/bottom) line up
 * with another box's, when within `threshold`. Returns the nudge and the
 * guides to draw.
 */
export function snapBox(box: Box, targets: Box[], threshold: number): { dx: number; dy: number; guides: Guide[] } {
  const xs = (b: Box) => [b.x, b.x + b.w / 2, b.x + b.w]
  const ys = (b: Box) => [b.y, b.y + b.h / 2, b.y + b.h]
  let best = { dx: Infinity, x: 0, t: null as Box | null }
  let bestY = { dy: Infinity, y: 0, t: null as Box | null }
  for (const t of targets) {
    for (const tx of xs(t)) for (const bx of xs(box)) if (Math.abs(tx - bx) < Math.abs(best.dx)) best = { dx: tx - bx, x: tx, t }
    for (const ty of ys(t)) for (const by of ys(box)) if (Math.abs(ty - by) < Math.abs(bestY.dy)) bestY = { dy: ty - by, y: ty, t }
  }
  const dx = Math.abs(best.dx) <= threshold ? best.dx : 0
  const dy = Math.abs(bestY.dy) <= threshold ? bestY.dy : 0
  const moved = { ...box, x: box.x + dx, y: box.y + dy }
  const guides: Guide[] = []
  if (dx || (best.t && Math.abs(best.dx) <= threshold)) {
    const t = best.t!
    guides.push({ dir: 'v', at: best.x, from: Math.min(moved.y, t.y), to: Math.max(moved.y + moved.h, t.y + t.h) })
  }
  if (dy || (bestY.t && Math.abs(bestY.dy) <= threshold)) {
    const t = bestY.t!
    guides.push({ dir: 'h', at: bestY.y, from: Math.min(moved.x, t.x), to: Math.max(moved.x + moved.w, t.x + t.w) })
  }
  return { dx, dy, guides }
}
