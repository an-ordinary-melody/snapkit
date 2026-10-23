import { describe, expect, it } from 'vitest'
import { orderEngines } from './order'

const engines = [
  { id: 'desktop-capturer', platforms: ['darwin', 'win32', 'linux'] },
  { id: 'node-screenshots', platforms: ['darwin', 'win32', 'linux'] },
  { id: 'mac-only', platforms: ['darwin'] }
]
const ids = (list: { id: string }[]) => list.map((e) => e.id)

describe('capture engine order', () => {
  it('uses the OS order: fastest first, fallback last', () => {
    expect(ids(orderEngines(engines, 'darwin', 'auto'))).toEqual(['node-screenshots', 'desktop-capturer'])
  })
  it('moves a chosen engine to the front and keeps the rest as fallbacks', () => {
    expect(ids(orderEngines(engines, 'win32', 'desktop-capturer'))).toEqual(['desktop-capturer', 'node-screenshots'])
  })
  it('ignores a choice that is unknown or not for this OS', () => {
    expect(ids(orderEngines(engines, 'linux', 'mac-only'))).toEqual(['node-screenshots', 'desktop-capturer'])
  })
  it('only offers engines that list an unknown OS', () => {
    expect(ids(orderEngines(engines, 'freebsd', 'auto'))).toEqual([])
  })
})
