import { describe, expect, it } from 'vitest'
import { moveRect, placeToolbars, resizeRect, type Rect } from './layout'

const screen = { w: 1440, h: 900 }
const actions = { w: 200, h: 40 }
const tools = { w: 40, h: 300 }

const box = (p: { x: number; y: number }, s: { w: number; h: number }): Rect => ({ ...p, ...s })
const overlap = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
const onScreen = (r: Rect) => r.x >= 0 && r.y >= 0 && r.x + r.w <= screen.w && r.y + r.h <= screen.h

function check(sel: Rect) {
  const l = placeToolbars(sel, screen, actions, tools)
  const a = box(l.actions, actions)
  const t = box(l.tools, tools)
  expect(onScreen(a)).toBe(true)
  expect(onScreen(t)).toBe(true)
  expect(overlap(a, t)).toBe(false)
  return l
}

describe('placeToolbars', () => {
  it('places bars outside a centered selection (below + right)', () => {
    const l = check({ x: 400, y: 200, w: 500, h: 400 })
    expect(l.actions.side).toBe('below')
    expect(l.tools.side).toBe('right')
    expect(l.actions.y).toBe(608)
    expect(l.tools.x).toBe(908)
  })

  it('moves the action bar above when the selection touches the bottom', () => {
    const l = check({ x: 400, y: 400, w: 500, h: 495 })
    expect(l.actions.side).toBe('above')
  })

  it('moves the tool bar left when the selection touches the right edge', () => {
    const l = check({ x: 800, y: 200, w: 630, h: 400 })
    expect(l.tools.side).toBe('left')
  })

  it('puts both bars inside a full-screen selection without overlapping', () => {
    const l = check({ x: 0, y: 0, w: 1440, h: 900 })
    expect(l.actions.side).toBe('inside')
    expect(l.tools.side).toBe('inside')
  })

  it('keeps bars on screen for a tiny selection in a corner', () => {
    check({ x: 0, y: 0, w: 10, h: 10 })
    check({ x: 1430, y: 890, w: 10, h: 10 })
    check({ x: 1430, y: 0, w: 10, h: 10 })
  })

  it('never overlaps or leaves the screen across many selections', () => {
    for (let x = 0; x < 1440; x += 97)
      for (let y = 0; y < 900; y += 83)
        for (const [w, h] of [[20, 20], [300, 200], [900, 700], [1440 - x, 900 - y]]) {
          check({ x, y, w: Math.min(w, 1440 - x), h: Math.min(h, 900 - y) })
        }
  })
})

describe('rect helpers', () => {
  it('resizes from a corner and flips past the opposite edge', () => {
    expect(resizeRect({ x: 100, y: 100, w: 100, h: 100 }, 'se', 50, 20, screen)).toEqual({ x: 100, y: 100, w: 150, h: 120 })
    expect(resizeRect({ x: 100, y: 100, w: 100, h: 100 }, 'e', -150, 0, screen)).toEqual({ x: 50, y: 100, w: 50, h: 100 })
  })

  it('keeps moved rects on screen', () => {
    expect(moveRect({ x: 100, y: 100, w: 100, h: 100 }, 5000, -5000, screen)).toEqual({ x: 1340, y: 0, w: 100, h: 100 })
  })
})
