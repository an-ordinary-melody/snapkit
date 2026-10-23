import { Grid3x3, Minus, Plus, Waves } from 'lucide-react'
import { useState } from 'react'
import { Slider } from '../Slider'
import { parseHex } from './color'
import { ColorPicker } from './ColorPicker'
import type { Shape, Style, ToolId } from './model'

/** What the style bar is editing: the active tool, or the selected shape's type. */
export type StyleTarget = ToolId | Shape['type']

const STROKED = new Set<StyleTarget>(['pen', 'line', 'arrow', 'rect', 'ellipse'])
const COLORED = new Set<StyleTarget>(['pen', 'line', 'arrow', 'rect', 'ellipse', 'text', 'step'])

/** Nothing to show for this target. */
export const hasStyleOptions = (t: StyleTarget) => COLORED.has(t) || t === 'blur'

/** One choice at a time; plain text first. Backgrounds come with a readable text color. */
const TEXT_STYLES: { label: string; shadow: boolean; background: string; color?: string }[] = [
  { label: 'Plain', shadow: false, background: '' },
  { label: 'Shadow', shadow: true, background: '' },
  { label: 'Light background', shadow: false, background: '#ffffff', color: '#111111' },
  { label: 'Dark background', shadow: false, background: '#111111', color: '#ffffff' }
]

export const BLUR_RANGE = { min: 4, max: 40 }

/** Custom colors picked this session, newest first. */
let recentCustom: string[] = []

interface Props {
  target: StyleTarget
  /** The target is a filled shape (no stroke width to choose). */
  filled: boolean
  style: Style
  palette: string[]
  /** `continuous`: part of a drag (slider, picker), merged into one undo step. */
  onChange(patch: Partial<Style>, continuous?: boolean): void
}

export function StyleBar({ target, filled, style, palette, onChange }: Props) {
  const [picking, setPicking] = useState(false)
  const sep = <div className="sep" />
  const lower = palette.map((c) => c.toLowerCase())
  const customs = recentCustom.filter((c) => !lower.includes(c))
  // Text keeps its own color.
  const colorKey = target === 'text' ? 'textColor' : 'color'
  const currentColor = style[colorKey]
  const current = currentColor.toLowerCase()
  // A custom color in use that isn't in the list yet still gets a swatch.
  if (!lower.includes(current) && !customs.includes(current)) customs.unshift(current)

  const closePicker = () => {
    setPicking(false)
    const c = parseHex(currentColor)
    if (c && !lower.includes(c)) recentCustom = [c, ...recentCustom.filter((x) => x !== c)].slice(0, 4)
  }

  const swatch = (c: string) => (
    <button key={c} className={`swatch${c.toLowerCase() === current ? ' active' : ''}`} data-tip={c} onClick={() => onChange({ [colorKey]: c })}>
      <span style={{ background: c }} />
    </button>
  )

  return (
    <>
      {COLORED.has(target) && (
        <>
          {palette.map(swatch)}
          {customs.map(swatch)}
          <div className="picker-anchor">
            <button className={`swatch custom${picking ? ' active' : ''}`} data-tip="Custom color" onClick={() => (picking ? closePicker() : setPicking(true))}>
              <span />
            </button>
            {picking && <ColorPicker color={currentColor} onChange={(c) => onChange({ [colorKey]: c }, true)} onClose={closePicker} />}
          </div>
        </>
      )}

      {STROKED.has(target) && !filled && (
        <>
          {sep}
          {[0, 1, 2].map((i) => (
            <button key={i} className={style.widthIndex === i ? 'active' : ''} data-tip={['Thin', 'Medium', 'Thick'][i]} onClick={() => onChange({ widthIndex: i })}>
              <span className="width-dot" style={{ width: 4 + i * 4, height: 4 + i * 4 }} />
            </button>
          ))}
        </>
      )}

      {target === 'text' && (
        <>
          {sep}
          <button data-tip="Smaller text" onClick={() => onChange({ fontSize: Math.max(10, style.fontSize - 4) })}>
            <Minus size={15} />
          </button>
          <span className="value">{style.fontSize}</span>
          <button data-tip="Larger text" onClick={() => onChange({ fontSize: Math.min(200, style.fontSize + 4) })}>
            <Plus size={15} />
          </button>
          {sep}
          {TEXT_STYLES.map((t) => {
            const on = style.shadow === t.shadow && style.textBackground === t.background
            const glyph = t.background ? 'glyph boxed' : t.shadow ? 'glyph shadowed' : 'glyph'
            return (
              <button key={t.label} className={on ? 'active' : ''} data-tip={t.label} onClick={() => onChange({ shadow: t.shadow, textBackground: t.background, ...(t.color && { textColor: t.color }) })}>
                <span className={glyph} style={t.background ? { background: t.background, color: t.background === '#ffffff' ? '#111' : '#fff' } : undefined}>
                  A
                </span>
              </button>
            )
          })}
        </>
      )}

      {target === 'blur' && (
        <>
          <button className={style.blurMode === 'blur' ? 'active' : ''} data-tip="Blur" onClick={() => onChange({ blurMode: 'blur' })}>
            <Waves size={16} />
          </button>
          <button className={style.blurMode === 'pixelate' ? 'active' : ''} data-tip="Pixelate" onClick={() => onChange({ blurMode: 'pixelate' })}>
            <Grid3x3 size={16} />
          </button>
          {sep}
          <Slider
            label="Blur strength"
            min={BLUR_RANGE.min}
            max={BLUR_RANGE.max}
            value={style.blurStrength}
            onChange={(v) => onChange({ blurStrength: v }, true)}
          />
          <span className="value">{style.blurStrength}</span>
        </>
      )}
    </>
  )
}
