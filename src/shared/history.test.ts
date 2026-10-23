import { describe, expect, it } from 'vitest'
import { HISTORY_LIMITS, toPrune, type HistoryEntry } from './history'

const MB = 1024 * 1024
const day = 86_400_000
const now = 100 * day
const entry = (id: string, age: number, bytes = MB, starred = false): HistoryEntry => ({
  id, createdAt: now - age, updatedAt: now - age, width: 10, height: 10, bytes, starred
})

describe('history pruning', () => {
  it('keeps the newest N, never starred ones', () => {
    const list = [entry('a', 1), entry('b', 2), entry('c', 3, MB, true), entry('d', 4), entry('e', 5)]
    expect(toPrune(list, { maxCount: 2, maxMB: 999, maxAgeDays: 0 }, now)).toEqual(['d', 'e'])
  })

  it('deletes the oldest until under the size limit', () => {
    const list = [entry('a', 1, 3 * MB), entry('b', 2, 3 * MB), entry('c', 3, 3 * MB)]
    expect(toPrune(list, { maxCount: 10, maxMB: 6, maxAgeDays: 0 }, now)).toEqual(['c'])
  })

  it('deletes entries older than the age limit', () => {
    const list = [entry('a', 1 * day), entry('b', 40 * day), entry('c', 50 * day, MB, true)]
    expect(toPrune(list, { maxCount: 10, maxMB: 999, maxAgeDays: 30 }, now)).toEqual(['b'])
  })

  it('applies the hard ceiling even if settings ask for more', () => {
    const list = Array.from({ length: HISTORY_LIMITS.maxCount + 5 }, (_, i) => entry(`e${i}`, i + 1, 1))
    expect(toPrune(list, { maxCount: 10_000, maxMB: 999_999, maxAgeDays: 0 }, now)).toHaveLength(5)
  })

  it('a count of 0 keeps only starred entries', () => {
    const list = [entry('a', 1), entry('b', 2, MB, true)]
    expect(toPrune(list, { maxCount: 0, maxMB: 999, maxAgeDays: 0 }, now)).toEqual(['a'])
  })
})
