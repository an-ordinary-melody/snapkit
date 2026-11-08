import { describe, expect, it } from 'vitest'
import { THUMB_STANDARD, thumbSize } from './thumb'

describe('floating preview size', () => {
  it('follows the capture for screen-like shapes', () => {
    expect(thumbSize(1920, 1080)).toEqual({ w: 240, h: 135 })
    expect(thumbSize(800, 800)).toEqual({ w: 160, h: 160 })
    expect(thumbSize(1200, 1600)).toEqual({ w: 120, h: 160 }) // portrait 3:4
    expect(thumbSize(1500, 500)).toEqual({ w: 240, h: 80 }) // 3:1, the wide limit
    expect(thumbSize(600, 1200)).toEqual({ w: 80, h: 160 }) // 1:2, the tall limit
  })
  it('uses the standard 16:9 size for strips and tall captures', () => {
    expect(thumbSize(2400, 60)).toEqual(THUMB_STANDARD) // a toolbar
    expect(thumbSize(200, 1200)).toEqual(THUMB_STANDARD) // a sidebar
    expect(thumbSize(310, 100)).toEqual(THUMB_STANDARD) // just past 3:1
    expect(thumbSize(100, 210)).toEqual(THUMB_STANDARD) // just past 1:2
  })
})
