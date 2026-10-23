import { describe, expect, it } from 'vitest'
import { boxFromDrag, commit, emptyHistory, isMeaningful, moveShape, openArrowHead, redo, remove, snap45, stepNumbers, undo, upsert, type Shape } from './model'

const step = (id: string): Shape => ({ id, type: 'step', x: 0, y: 0, size: 20, color: 'red' })
const rect = (id: string, x = 0): Shape => ({ id, type: 'rect', x, y: 0, w: 10, h: 10, color: 'red', width: 2 })

describe('history', () => {
  it('undoes and redoes', () => {
    let h = emptyHistory()
    h = commit(h, [rect('a')])
    h = commit(h, [rect('a'), rect('b')])
    expect(h.present.map((s) => s.id)).toEqual(['a', 'b'])
    h = undo(h)
    expect(h.present.map((s) => s.id)).toEqual(['a'])
    h = undo(h)
    expect(h.present).toEqual([])
    expect(undo(h)).toBe(h)
    h = redo(h)
    expect(h.present.map((s) => s.id)).toEqual(['a'])
  })

  it('drops the redo stack after a new change', () => {
    let h = commit(emptyHistory(), [rect('a')])
    h = undo(h)
    h = commit(h, [rect('b')])
    expect(h.future).toEqual([])
    expect(redo(h)).toBe(h)
  })

  it('merges consecutive commits with the same key into one undo step', () => {
    let h = commit(emptyHistory(), [rect('a')])
    h = commit(h, [rect('a', 1)], 'slide')
    h = commit(h, [rect('a', 2)], 'slide')
    h = commit(h, [rect('a', 3)], 'slide')
    expect(h.past).toHaveLength(2)
    h = undo(h)
    expect((h.present[0] as { x: number }).x).toBe(0)
    // After an undo, the same key starts a new step instead of merging.
    h = commit(redo(h), [rect('a', 4)], 'slide')
    expect(h.past).toHaveLength(3)
  })

  it('ignores commits that change nothing', () => {
    const h = commit(emptyHistory(), [rect('a')])
    expect(commit(h, h.present)).toBe(h)
  })

  it('upserts and removes by id', () => {
    const list = upsert([rect('a')], rect('a', 5))
    expect(list).toHaveLength(1)
    expect((list[0] as { x: number }).x).toBe(5)
    expect(remove(upsert(list, rect('b')), 'a').map((s) => s.id)).toEqual(['b'])
  })
})

describe('shapes', () => {
  it('numbers steps in drawing order and renumbers after delete', () => {
    const shapes = [step('a'), rect('r'), step('b'), step('c')]
    expect([...stepNumbers(shapes)]).toEqual([['a', 1], ['b', 2], ['c', 3]])
    expect(stepNumbers(remove(shapes, 'b')).get('c')).toBe(2)
  })

  it('snaps to 45° steps', () => {
    expect(snap45(100, 3)).toEqual([100, 0])
    const [x, y] = snap45(70, 75)
    expect(x).toBe(y)
    expect(snap45(-2, -100)).toEqual([0, -100])
  })

  it('builds boxes from drags in any direction, optionally square', () => {
    expect(boxFromDrag(50, 50, 10, 20)).toEqual({ x: 10, y: 20, w: 40, h: 30 })
    expect(boxFromDrag(0, 0, 30, -10, true)).toEqual({ x: 0, y: -30, w: 30, h: 30 })
  })

  it('drops click-sized shapes and empty text', () => {
    expect(isMeaningful({ ...rect('a'), w: 2 } as Shape)).toBe(false)
    expect(isMeaningful({ id: 't', type: 'text', x: 0, y: 0, text: '  ', color: '', fontSize: 1, fontFamily: '', shadow: 0, background: '' })).toBe(false)
    expect(isMeaningful(step('s'))).toBe(true)
  })

  it('draws an open arrow head as two strokes meeting at the tip, behind it', () => {
    const [ax, ay, tx, ty, bx, by] = openArrowHead([0, 0, 100, 0], 20)
    expect([tx, ty]).toEqual([100, 0])
    expect(ax).toBeLessThan(100)
    expect(bx).toBeCloseTo(ax)
    expect(ay).toBeCloseTo(-by)
  })

  it('moves point-based and box-based shapes', () => {
    const line: Shape = { id: 'l', type: 'arrow', points: [0, 0, 10, 10], color: '', width: 1 }
    expect((moveShape(line, 5, -5) as typeof line).points).toEqual([5, -5, 15, 5])
    expect((moveShape(rect('a'), 3, 4) as { x: number; y: number }).y).toBe(4)
  })
})
