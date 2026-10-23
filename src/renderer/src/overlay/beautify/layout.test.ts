import { describe, expect, it } from 'vitest'
import { beautifyLayout, gradientLine } from './layout'

describe('beautifyLayout', () => {
  it('adds padding on every side, in image pixels', () => {
    const l = beautifyLayout(800, 600, { padding: 48, radius: 12, shadow: 0.3 }, 2)
    expect(l).toMatchObject({ width: 800 + 192, height: 600 + 192, x: 96, y: 96, radius: 24 })
  })

  it('keeps corners and shadow within bounds', () => {
    const l = beautifyLayout(40, 20, { padding: 10, radius: 100, shadow: 2 }, 1)
    expect(l.radius).toBe(10) // half the shorter side
    expect(l.shadowAlpha).toBe(1)
    expect(l.shadowBlur).toBeLessThanOrEqual(10 * 0.8)
  })

  it('has no shadow or padding when they are zero', () => {
    const l = beautifyLayout(100, 100, { padding: 0, radius: 8, shadow: 0 }, 2)
    expect(l).toMatchObject({ width: 100, height: 100, x: 0, shadowBlur: 0 })
  })
})

describe('gradientLine', () => {
  it('runs left to right at 0° and top to bottom at 90°', () => {
    const round = (v: number[]) => v.map((n) => Math.round(n) || 0)
    expect(round(gradientLine(200, 100, 0))).toEqual([0, 50, 200, 50])
    expect(round(gradientLine(200, 100, 90))).toEqual([100, 0, 100, 100])
  })
})
