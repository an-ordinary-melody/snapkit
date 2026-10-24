import { describe, expect, it } from 'vitest'
import { applyPatch, DEFAULT_SETTINGS, defaultsFor, mergeSettings } from './settings'

describe('settings', () => {
  it('patches nested values without dropping their siblings', () => {
    const saved = { annotate: { text: { fontSize: 30, strokeWidth: 4 } }, save: { askLocation: false } }
    const next = applyPatch(saved, { annotate: { text: { fontSize: 24 } } })
    expect(next).toEqual({ annotate: { text: { fontSize: 24, strokeWidth: 4 } }, save: { askLocation: false } })
    expect(saved.annotate.text.fontSize).toBe(30) // not mutated
  })

  it('replaces arrays whole', () => {
    const next = applyPatch({ annotate: { palette: ['#000', '#111'] } }, { annotate: { palette: ['#fff'] } })
    expect(next).toEqual({ annotate: { palette: ['#fff'] } })
  })

  it('fills everything not overridden from the defaults', () => {
    const s = mergeSettings(DEFAULT_SETTINGS, { appearance: { theme: 'dark' } })
    expect(s.appearance).toEqual({ ...DEFAULT_SETTINGS.appearance, theme: 'dark' })
    expect(s.annotate).toEqual(DEFAULT_SETTINGS.annotate)
  })

  it('ignores saved values of the wrong type', () => {
    const s = mergeSettings(DEFAULT_SETTINGS, { capture: { dimOpacity: 'dark' } })
    expect(s.capture.dimOpacity).toBe(DEFAULT_SETTINGS.capture.dimOpacity)
  })
})

describe('defaultsFor', () => {
  it('uses bigger text on Windows only', () => {
    expect(defaultsFor('win32').annotate.text.fontSize).toBe(26)
    expect(defaultsFor('darwin').annotate.text.fontSize).toBe(20)
    expect(defaultsFor('win32').annotate.text.strokeWidth).toBe(DEFAULT_SETTINGS.annotate.text.strokeWidth)
  })
})
