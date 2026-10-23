import { Grid3x3, Minus, Plus, Waves } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Slider } from '../Slider'
import { isLight, parseHex, readableOn } from './color'
import { ColorPicker } from './ColorPicker'
import type { Shape, Style, ToolId } from './model'

/** What the style bar is editing: the active tool, or the selected shape's type. */
export type StyleTarget = ToolId | Shape['type']

const STROKED = new Set<StyleTarget>(['pen', 'line', 'arrow', 'rect', 'ellipse'])
const COLORED = new Set<StyleTarget>(['pen', 'line', 'arrow', 'rect', 'ellipse', 'text', 'step', 'highlighter'])

/** Nothing to show for this target. */
export const hasStyleOptions = (t: StyleTarget) => COLORED.has(t) || t === 'blur'

type TextLook = 'plain' | 'stroke' | 'light' | 'dark'

/** One look at a time, plain first. A background comes with readable (black/white) text. */
const TEXT_LOOKS: { id: TextLook; label: string }[] = [
  { id: 'plain', label: 'Plain' },
  { id: 'stroke', label: 'Stroke (outline)' },
  { id: 'light', label: 'Light background' },
  { id: 'dark', label: 'Dark background' }
]

function textLook(s: Style): TextLook {
  if (s.textBackground) return isLight(s.textBackground) ? 'light' : 'dark'
  return s.textStroke ? 'stroke' : 'plain'
}

function lookPatch(id: TextLook, s: Style): Partial<Style> {
  // Leaving a background look: its black/white text would vanish on the screenshot, so use the drawing color again.
  const restore = s.textBackground ? { textColor: s.color } : {}
  switch (id) {
    case 'plain':
      return { textStroke: '', textBackground: '', ...restore }
    case 'stroke':
      return { textStroke: s.textStrokeColor, textBackground: '', ...restore }
    case 'light': {
      const bg = isLight(s.textBgColor) ? s.textBgColor : '#ffffff'
      return { textStroke: '', textBackground: bg, textBgColor: bg, textColor: readableOn(bg) }
    }
    case 'dark': {
      const bg = isLight(s.textBgColor) ? '#111111' : s.textBgColor
      return { textStroke: '', textBackground: bg, textBgColor: bg, textColor: readableOn(bg) }
    }
  }
}

export const BLUR_RANGE = { min: 4, max: 40 }

/** Custom colors picked this session, newest first. */
let recentCustom: string[] = []

interface Props {
  target: StyleTarget
  /** Colors offered for the highlighter (it has its own, lighter set). */
  highlighterPalette: string[]
  /** Changes when the tool bar's color button is clicked. */
  pickerRequest: number
  /** The target is a filled shape (no stroke width to choose). */
  filled: boolean
  style: Style
  palette: string[]
  /** `continuous`: part of a drag (slider, picker), merged into one undo step. */
  onChange(patch: Partial<Style>, continuous?: boolean): void
}

export function StyleBar({ target, filled, style, palette: mainPalette, highlighterPalette, onChange, pickerRequest }: Props) {
  const palette = target === 'highlighter' ? highlighterPalette : mainPalette
  const [picking, setPicking] = useState<false | 'color' | 'textExtra'>(false)
  // The color button in the tool bar opens the color picker here.
  const firstRequest = useRef(pickerRequest)
  useEffect(() => {
    if (pickerRequest !== firstRequest.current && COLORED.has(target) && target !== 'highlighter') setPicking('color')
  }, [pickerRequest]) // eslint-disable-line react-hooks/exhaustive-deps
  const look = textLook(style)
  const sep = <div className="sep" />
  const lower = palette.map((c) => c.toLowerCase())
  const customizable = target !== 'highlighter'
  const customs = recentCustom.filter((c) => !lower.includes(c))
  // Text keeps its own color.
  const colorKey = target === 'text' ? 'textColor' : target === 'highlighter' ? 'highlighterColor' : target === 'step' ? 'stepColor' : 'color'
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
          {/* The highlighter keeps to its own few light colors: no custom ones. */}
          {customizable && customs.map(swatch)}
          {customizable && (
            <div className="picker-anchor">
              <button className={`swatch custom${picking === 'color' ? ' active' : ''}`} data-tip="Custom color" onClick={() => (picking === 'color' ? closePicker() : setPicking('color'))}>
                <span />
              </button>
              {picking === 'color' && <ColorPicker color={currentColor} onChange={(c) => onChange({ [colorKey]: c }, true)} onClose={closePicker} />}
            </div>
          )}
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
          <FontSizeInput value={style.fontSize} onChange={(fontSize) => onChange({ fontSize })} />
          <button data-tip="Larger text" onClick={() => onChange({ fontSize: Math.min(200, style.fontSize + 4) })}>
            <Plus size={15} />
          </button>
          {sep}
          {TEXT_LOOKS.map((t) => (
            <button key={t.id} className={look === t.id ? 'active' : ''} data-tip={t.label} onClick={() => onChange(lookPatch(t.id, style))}>
              <span className={`glyph ${t.id}`}>A</span>
            </button>
          ))}
          {/* The stroke's or background's own color. */}
          {(look === 'stroke' || look === 'light' || look === 'dark') && (
            <div className="picker-anchor">
              <button
                className={`swatch${picking === 'textExtra' ? ' active' : ''}`}
                data-tip={look === 'stroke' ? 'Stroke color' : 'Background color'}
                onClick={() => setPicking(picking === 'textExtra' ? false : 'textExtra')}
              >
                <span style={{ background: look === 'stroke' ? style.textStroke : style.textBackground }} />
              </button>
              {picking === 'textExtra' && (
                <ColorPicker
                  color={look === 'stroke' ? style.textStroke : style.textBackground}
                  onChange={(c) =>
                    onChange(look === 'stroke' ? { textStroke: c, textStrokeColor: c } : { textBackground: c, textBgColor: c, textColor: readableOn(c) }, true)
                  }
                  onClose={() => setPicking(false)}
                />
              )}
            </div>
          )}
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

/** Text size you can type (8–200), applied as you type. */
function FontSizeInput({ value, onChange }: { value: number; onChange(v: number): void }) {
  const [text, setText] = useState(String(value))
  useEffect(() => setText(String(value)), [value])
  return (
    <input
      className="size-input"
      type="number"
      aria-label="Text size"
      min={8}
      max={200}
      value={text}
      onChange={(e) => {
        setText(e.target.value)
        const v = Number(e.target.value)
        if (v >= 8 && v <= 200) onChange(Math.round(v))
      }}
      onBlur={() => setText(String(value))}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === 'Enter' || e.key === 'Escape') e.currentTarget.blur()
      }}
    />
  )
}
