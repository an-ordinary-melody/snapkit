import { describe, expect, it } from 'vitest'
import { hexToHsv, hsvToHex, parseHex } from './color'

describe('color', () => {
  it('parses short and long hex, with or without #', () => {
    expect(parseHex('#ABC')).toBe('#aabbcc')
    expect(parseHex('ff0000')).toBe('#ff0000')
    expect(parseHex('red')).toBeNull()
    expect(parseHex('#12345')).toBeNull()
  })

  it('round-trips hex through HSV', () => {
    for (const c of ['#ef4444', '#22c55e', '#3b82f6', '#ffffff', '#000000', '#7f7f7f', '#a855f7']) {
      expect(hsvToHex(hexToHsv(c))).toBe(c)
    }
  })

  it('converts known values', () => {
    expect(hexToHsv('#ff0000')).toEqual({ h: 0, s: 1, v: 1 })
    expect(hsvToHex({ h: 120, s: 1, v: 1 })).toBe('#00ff00')
    expect(hsvToHex({ h: 240, s: 0.5, v: 0.5 })).toBe('#404080')
  })
})
