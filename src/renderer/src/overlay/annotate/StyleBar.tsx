import { Grid3x3, Minus, Plus, Waves } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { hexToHsv, hsvToHex, parseHex, type Hsv } from './color'
import type { Shape, Style, ToolId } from './model'

/** What the style bar is editing: the active tool, or the selected shape's type. */
export type StyleTarget = ToolId | Shape['type']

const STROKED = new Set<StyleTarget>(['pen', 'line', 'arrow', 'rect', 'ellipse'])
const COLORED = new Set<StyleTarget>(['pen', 'line', 'arrow', 'rect', 'ellipse', 'text', 'step'])

/** Nothing to show for this target. */
export const hasStyleOptions = (t: StyleTarget) => COLORED.has(t) || t === 'blur'

/** One choice at a time; plain text first. */
const TEXT_STYLES = [
  { label: 'Plain', shadow: false, background: '' },
  { label: 'Shadow', shadow: true, background: '' },
  { label: 'Light background', shadow: false, background: '#ffffff' },
  { label: 'Dark background', shadow: false, background: '#111111' }
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
  const current = style.color.toLowerCase()
  // A custom color in use that isn't in the list yet still gets a swatch.
  if (!lower.includes(current) && !customs.includes(current)) customs.unshift(current)

  const closePicker = () => {
    setPicking(false)
    const c = parseHex(style.color)
    if (c && !lower.includes(c)) recentCustom = [c, ...recentCustom.filter((x) => x !== c)].slice(0, 4)
  }

  const swatch = (c: string) => (
    <button key={c} className={`swatch${c.toLowerCase() === current ? ' active' : ''}`} data-tip={c} onClick={() => onChange({ color: c })}>
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
            {picking && <ColorPicker color={style.color} onChange={(c) => onChange({ color: c }, true)} onClose={closePicker} />}
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
              <button key={t.label} className={on ? 'active' : ''} data-tip={t.label} onClick={() => onChange({ shadow: t.shadow, textBackground: t.background })}>
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
          <input
            className="slider"
            type="range"
            min={BLUR_RANGE.min}
            max={BLUR_RANGE.max}
            value={style.blurStrength}
            data-tip="Strength"
            onChange={(e) => onChange({ blurStrength: Number(e.target.value) }, true)}
            onPointerUp={(e) => e.currentTarget.blur()} // give the keyboard back to capture mode
          />
          <span className="value">{style.blurStrength}</span>
        </>
      )}
    </>
  )
}

/** Saturation/brightness square, hue slider and hex field. Opens above or below the style bar. */
function ColorPicker({ color, onChange, onClose }: { color: string; onChange(c: string): void; onClose(): void }) {
  const ref = useRef<HTMLDivElement>(null)
  const [hsv, setHsv] = useState<Hsv>(() => hexToHsv(color))
  const [hex, setHex] = useState(color)
  const [up, setUp] = useState(true)

  useLayoutEffect(() => {
    const bar = ref.current?.parentElement?.getBoundingClientRect()
    if (bar) setUp(bar.top > 240)
  }, [])

  // Close on a click anywhere outside the picker.
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      const anchor = ref.current?.parentElement
      if (anchor && !anchor.contains(e.target as Node)) onClose()
    }
    window.addEventListener('pointerdown', onDown, true)
    return () => window.removeEventListener('pointerdown', onDown, true)
  }, [onClose])

  const set = (next: Hsv) => {
    setHsv(next)
    const c = hsvToHex(next)
    setHex(c)
    onChange(c)
  }

  const dragSquare = (e: React.PointerEvent<HTMLDivElement>) => {
    const el = e.currentTarget
    el.setPointerCapture(e.pointerId)
    const apply = (ev: { clientX: number; clientY: number }) => {
      const r = el.getBoundingClientRect()
      const s = Math.min(1, Math.max(0, (ev.clientX - r.left) / r.width))
      const v = 1 - Math.min(1, Math.max(0, (ev.clientY - r.top) / r.height))
      set({ ...hsvRef.current, s, v })
    }
    apply(e)
    const move = (ev: PointerEvent) => apply(ev)
    const up = () => {
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
    }
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
  }
  const hsvRef = useRef(hsv)
  hsvRef.current = hsv

  return (
    <div ref={ref} className={`color-picker ${up ? 'up' : 'down'}`}>
      <div className="sv" style={{ background: `hsl(${hsv.h} 100% 50%)` }} onPointerDown={dragSquare}>
        <div className="sv-white" />
        <div className="sv-black" />
        <div className="sv-dot" style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%`, background: hsvToHex(hsv) }} />
      </div>
      <input className="hue" type="range" min={0} max={359} value={Math.round(hsv.h)} onChange={(e) => set({ ...hsv, h: Number(e.target.value) })} />
      <div className="hex-row">
        <span className="preview" style={{ background: hsvToHex(hsv) }} />
        <input
          className="hex"
          value={hex}
          spellCheck={false}
          maxLength={7}
          onChange={(e) => {
            setHex(e.target.value)
            const c = parseHex(e.target.value)
            if (c) {
              setHsv(hexToHsv(c))
              onChange(c)
            }
          }}
          onKeyDown={(e) => {
            e.stopPropagation()
            if (e.key === 'Enter' || e.key === 'Escape') onClose()
          }}
        />
      </div>
    </div>
  )
}
