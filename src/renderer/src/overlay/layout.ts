export interface Rect {
  x: number
  y: number
  w: number
  h: number
}
export interface Size {
  w: number
  h: number
}
export interface Point {
  x: number
  y: number
}

export type Side = 'below' | 'above' | 'inside' | 'right' | 'left'

export interface ToolbarLayout {
  actions: Point & { side: Side }
  tools: Point & { side: Side }
}

const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v))

const overlaps = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h

/**
 * Lightshot-style toolbar placement.
 *
 * - Action bar (horizontal): below the selection, right-aligned. If there's no
 *   room below it goes above; if there's no room above either, inside the
 *   bottom edge.
 * - Tool bar (vertical): right of the selection, bottom-aligned. Falls back to
 *   the left side, then inside the right edge.
 * - The two bars never overlap and never leave the screen.
 */
export function placeToolbars(sel: Rect, screen: Size, actions: Size, tools: Size, gap = 8, margin = 6): ToolbarLayout {
  const maxX = (w: number) => screen.w - w - margin
  const maxY = (h: number) => screen.h - h - margin

  // Action bar
  let aSide: Side = 'below'
  let ay = sel.y + sel.h + gap
  if (ay > maxY(actions.h)) {
    aSide = 'above'
    ay = sel.y - gap - actions.h
    if (ay < margin) {
      aSide = 'inside'
      ay = sel.y + sel.h - gap - actions.h
    }
  }
  let ax = clamp(sel.x + sel.w - actions.w, margin, maxX(actions.w))
  ay = clamp(ay, margin, maxY(actions.h))

  // Tool bar
  let tSide: Side = 'right'
  let tx = sel.x + sel.w + gap
  if (tx > maxX(tools.w)) {
    tSide = 'left'
    tx = sel.x - gap - tools.w
    if (tx < margin) {
      tSide = 'inside'
      tx = sel.x + sel.w - gap - tools.w
    }
  }
  tx = clamp(tx, margin, maxX(tools.w))
  let ty = clamp(sel.y + sel.h - tools.h, margin, maxY(tools.h))

  // Resolve overlap: move the tool bar vertically out of the action bar's way,
  // and if it still collides, slide the action bar sideways.
  const aRect = () => ({ x: ax, y: ay, w: actions.w, h: actions.h })
  const tRect = () => ({ x: tx, y: ty, w: tools.w, h: tools.h })
  if (overlaps(aRect(), tRect())) {
    const upY = ay - gap - tools.h
    const downY = ay + actions.h + gap
    if (upY >= margin) ty = upY
    else if (downY <= maxY(tools.h)) ty = downY
  }
  if (overlaps(aRect(), tRect())) {
    const leftX = tx - gap - actions.w
    ax = leftX >= margin ? leftX : clamp(tx + tools.w + gap, margin, maxX(actions.w))
  }

  return { actions: { x: ax, y: ay, side: aSide }, tools: { x: tx, y: ty, side: tSide } }
}

/** Normalise a drag from point a to point b into a rect clamped to the screen. */
export function rectFromPoints(a: Point, b: Point, screen: Size): Rect {
  const x1 = clamp(Math.min(a.x, b.x), 0, screen.w)
  const y1 = clamp(Math.min(a.y, b.y), 0, screen.h)
  const x2 = clamp(Math.max(a.x, b.x), 0, screen.w)
  const y2 = clamp(Math.max(a.y, b.y), 0, screen.h)
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 }
}

export type Handle = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw'

/** Resize a rect by dragging one of its handles by (dx, dy). Allows flipping past the opposite edge. */
export function resizeRect(start: Rect, handle: Handle, dx: number, dy: number, screen: Size): Rect {
  let x1 = start.x
  let y1 = start.y
  let x2 = start.x + start.w
  let y2 = start.y + start.h
  if (handle.includes('w')) x1 += dx
  if (handle.includes('e')) x2 += dx
  if (handle.includes('n')) y1 += dy
  if (handle.includes('s')) y2 += dy
  return rectFromPoints({ x: x1, y: y1 }, { x: x2, y: y2 }, screen)
}

/** Move a rect by (dx, dy), keeping it fully on screen. */
export function moveRect(start: Rect, dx: number, dy: number, screen: Size): Rect {
  return {
    ...start,
    x: clamp(start.x + dx, 0, screen.w - start.w),
    y: clamp(start.y + dy, 0, screen.h - start.h)
  }
}
