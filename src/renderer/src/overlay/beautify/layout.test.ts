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

describe('frames', () => {
  const base = { padding: 10, radius: 0, shadow: 0 }

  it('widens a tall capture to 16:9, centered', () => {
    const l = beautifyLayout(100, 100, { ...base, frame: { kind: 'ratio', w: 16, h: 9 } }, 1)
    expect(l.height).toBe(120)
    expect(l.width).toBe(213)
    expect(l.x).toBe(Math.round((213 - 100) / 2))
    expect(l.y).toBe(10)
  })

  it('heightens a wide capture to 1:1', () => {
    const l = beautifyLayout(300, 100, { ...base, frame: { kind: 'ratio', w: 1, h: 1 } }, 1)
    expect([l.width, l.height]).toEqual([320, 320])
    expect(l.y).toBe(110)
  })

  it('fits a large capture into an exact size, never scaling up', () => {
    const big = beautifyLayout(2000, 1000, { ...base, frame: { kind: 'size', w: 1020, h: 1020 } }, 1)
    expect([big.width, big.height, big.drawW, big.drawH]).toEqual([1020, 1020, 1000, 500])
    const small = beautifyLayout(100, 50, { ...base, frame: { kind: 'size', w: 400, h: 300 } }, 1)
    expect([small.drawW, small.drawH, small.x, small.y]).toEqual([100, 50, 150, 125])
  })
})

describe('gradientLine', () => {
  it('runs left to right at 0° and top to bottom at 90°', () => {
    const round = (v: number[]) => v.map((n) => Math.round(n) || 0)
    expect(round(gradientLine(200, 100, 0))).toEqual([0, 50, 200, 50])
    expect(round(gradientLine(200, 100, 90))).toEqual([100, 0, 100, 100])
  })
})
