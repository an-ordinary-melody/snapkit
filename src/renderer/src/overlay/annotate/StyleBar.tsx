import { Grid3x3, Minus, Plus, Waves } from 'lucide-react'
import type { Shape, Style, ToolId } from './model'

/** What the style bar is editing: the active tool, or the selected shape's type. */
export type StyleTarget = ToolId | Shape['type']

const STROKED = new Set<StyleTarget>(['pen', 'line', 'arrow', 'rect', 'ellipse'])
const COLORED = new Set<StyleTarget>(['pen', 'line', 'arrow', 'rect', 'ellipse', 'text', 'step'])

/** Nothing to show for this target. */
export const hasStyleOptions = (t: StyleTarget) => COLORED.has(t) || t === 'blur'

const TEXT_BACKGROUNDS = [
  { value: '', label: 'No background' },
  { value: '#ffffff', label: 'Light background' },
  { value: '#111111', label: 'Dark background' }
]

interface Props {
  target: StyleTarget
  style: Style
  palette: string[]
  onChange(patch: Partial<Style>): void
}

export function StyleBar({ target, style, palette, onChange }: Props) {
  const sep = <div className="sep" />
  return (
    <>
      {COLORED.has(target) &&
        palette.map((c) => (
          <button
            key={c}
            className={`swatch${c.toLowerCase() === style.color.toLowerCase() ? ' active' : ''}`}
            title={c}
            onClick={() => onChange({ color: c })}
          >
            <span style={{ background: c }} />
          </button>
        ))}

      {STROKED.has(target) && (
        <>
          {sep}
          {[0, 1, 2].map((i) => (
            <button key={i} className={style.widthIndex === i ? 'active' : ''} title={['Thin', 'Medium', 'Thick'][i]} onClick={() => onChange({ widthIndex: i })}>
              <span className="width-dot" style={{ width: 4 + i * 4, height: 4 + i * 4 }} />
            </button>
          ))}
        </>
      )}

      {target === 'text' && (
        <>
          {sep}
          <button title="Smaller text" onClick={() => onChange({ fontSize: Math.max(10, style.fontSize - 4) })}>
            <Minus size={15} />
          </button>
          <span className="value">{style.fontSize}</span>
          <button title="Larger text" onClick={() => onChange({ fontSize: Math.min(200, style.fontSize + 4) })}>
            <Plus size={15} />
          </button>
          {sep}
          <button className={style.shadow ? 'active' : ''} title="Shadow" onClick={() => onChange({ shadow: !style.shadow })}>
            <span className="glyph shadowed">A</span>
          </button>
          {TEXT_BACKGROUNDS.map((b) => (
            <button key={b.label} className={style.textBackground === b.value ? 'active' : ''} title={b.label} onClick={() => onChange({ textBackground: b.value })}>
              <span className="glyph boxed" style={{ background: b.value || 'transparent', color: b.value === '#ffffff' ? '#111' : '#fff' }}>
                A
              </span>
            </button>
          ))}
        </>
      )}

      {target === 'blur' && (
        <>
          <button className={style.blurMode === 'pixelate' ? 'active' : ''} title="Pixelate" onClick={() => onChange({ blurMode: 'pixelate' })}>
            <Grid3x3 size={16} />
          </button>
          <button className={style.blurMode === 'blur' ? 'active' : ''} title="Blur" onClick={() => onChange({ blurMode: 'blur' })}>
            <Waves size={16} />
          </button>
        </>
      )}
    </>
  )
}
