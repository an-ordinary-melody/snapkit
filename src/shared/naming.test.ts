import { describe, expect, it } from 'vitest'
import { DEFAULT_NAME_RULE, fileName, uniqueName } from './naming'

const at = new Date(2026, 9, 24, 5, 30, 12)

describe('file naming', () => {
  it('defaults to the text plus a timestamp', () => {
    expect(fileName(DEFAULT_NAME_RULE, at, 1)).toBe('Snapkit 2026-10-24 at 05.30.12.png')
  })

  it('puts a padded number and/or the date before or after the text', () => {
    expect(fileName({ text: 'Bug', date: 'none', number: 'after', digits: 3 }, at, 7)).toBe('Bug 007.png')
    expect(fileName({ text: 'Bug', date: 'before', number: 'before', digits: 2 }, at, 12)).toBe('12 2026-10-24 at 05.30.12 Bug.png')
    expect(fileName({ text: 'Bug', date: 'after', number: 'after', digits: 1 }, at, 3)).toBe('Bug 2026-10-24 at 05.30.12 3.png')
  })

  it('makes the text safe for file names and never returns an empty name', () => {
    expect(fileName({ text: 'a/b: c', date: 'none', number: 'none', digits: 3 }, at, 1)).toBe('a-b- c.png')
    expect(fileName({ text: '  ', date: 'none', number: 'none', digits: 3 }, at, 1)).toBe('Snapkit 2026-10-24 at 05.30.12.png')
  })

  it('adds a counter when the name is taken', () => {
    const used = new Set(['x.png', 'x 2.png'])
    expect(uniqueName('x.png', (n) => used.has(n))).toBe('x 3.png')
    expect(uniqueName('y.png', (n) => used.has(n))).toBe('y.png')
  })
})
