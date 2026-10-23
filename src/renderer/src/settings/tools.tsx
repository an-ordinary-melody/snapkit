import { GripVertical, Plus, X } from 'lucide-react'
import { useState } from 'react'
import { FEATURES, type FeatureDef } from '@shared/features'
import { visibleFeatures, type Settings } from '@shared/settings'
import { FeatureIcon } from '../overlay/Toolbars'
import { ColorField, Group, NumberField, Row, Segmented, SliderField, Toggle } from './controls'
import type { SectionProps } from './Settings'

/** The user's full order: saved ids first, then any new features. */
const fullOrder = (s: Settings) => [...s.toolbarOrder, ...FEATURES.map((f) => f.id).filter((id) => !s.toolbarOrder.includes(id))]

export function ToolbarSection({ snap, set }: SectionProps) {
  const s = snap.settings
  const order = fullOrder(s)
  const byKind = (kind: 'tool' | 'action') => order.map((id) => FEATURES.find((f) => f.id === id)).filter((f): f is FeatureDef => !!f && f.kind === kind)
  const enabled = (f: FeatureDef) => s.features[f.id] ?? f.defaultEnabled

  /** Reorder within one bar; the other bar keeps its order. */
  const move = (kind: 'tool' | 'action', from: number, to: number) => {
    const list = byKind(kind).map((f) => f.id)
    const [id] = list.splice(from, 1)
    list.splice(to, 0, id)
    const other = byKind(kind === 'tool' ? 'action' : 'tool').map((f) => f.id)
    set({ toolbarOrder: kind === 'tool' ? [...list, ...other] : [...other, ...list] })
  }

  return (
    <>
      <div className="st-preview" aria-label="Toolbar preview">
        <div className="toolbar docked st-mini">
          {visibleFeatures(s, 'tool').map((f) => (
            <span key={f.id} className="st-mini-btn">
              {f.id === 'color' ? <span className="color-box" style={{ background: s.annotate.palette[0] }} /> : <FeatureIcon id={f.id} size={15} />}
            </span>
          ))}
        </div>
        <div className="toolbar docked st-mini">
          {visibleFeatures(s, 'action').map((f) => (
            <span key={f.id} className="st-mini-btn">
              <FeatureIcon id={f.id} size={15} />
            </span>
          ))}
        </div>
      </div>
      <ReorderList title="Tools (vertical bar)" items={byKind('tool')} enabled={enabled} onToggle={(f, v) => set({ features: { [f.id]: v } })} onMove={(a, b) => move('tool', a, b)} />
      <ReorderList title="Actions (horizontal bar)" items={byKind('action')} enabled={enabled} onToggle={(f, v) => set({ features: { [f.id]: v } })} onMove={(a, b) => move('action', a, b)} />
    </>
  )
}

/** Rows you can drag (by the grip) to reorder, each with an on/off switch. */
function ReorderList(props: { title: string; items: FeatureDef[]; enabled(f: FeatureDef): boolean; onToggle(f: FeatureDef, v: boolean): void; onMove(from: number, to: number): void }) {
  const { title, items, enabled, onToggle, onMove } = props
  const [dragging, setDragging] = useState<number | null>(null)
  const [over, setOver] = useState<number | null>(null)
  return (
    <Group title={title} note="Drag to reorder.">
      {items.map((f, i) => (
        <div
          key={f.id}
          className={`st-row st-reorder${dragging === i ? ' dragging' : ''}${over === i && dragging !== null && dragging !== i ? ' over' : ''}`}
          draggable
          onDragStart={(e) => {
            setDragging(i)
            e.dataTransfer.effectAllowed = 'move'
          }}
          onDragOver={(e) => {
            e.preventDefault()
            setOver(i)
          }}
          onDrop={(e) => {
            e.preventDefault()
            if (dragging !== null && dragging !== i) onMove(dragging, i)
            setDragging(null)
            setOver(null)
          }}
          onDragEnd={() => {
            setDragging(null)
            setOver(null)
          }}
        >
          <div className="st-label row">
            <GripVertical size={15} className="st-grip" aria-hidden />
            <span className="st-feature-icon">
              {f.id === 'color' ? <span className="color-box st-color-icon" /> : <FeatureIcon id={f.id} size={16} />}
            </span>
            <span>{f.label}</span>
            {!f.implemented && <small className="st-badge">Coming later</small>}
          </div>
          <div className="st-control">
            <Toggle label={`Show ${f.label}`} value={enabled(f)} onChange={(v) => onToggle(f, v)} disabled={!f.implemented} />
          </div>
        </div>
      ))}
    </Group>
  )
}

const FONTS = [
  { value: '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif', label: 'System' },
  { value: 'ui-rounded, "SF Pro Rounded", system-ui, sans-serif', label: 'Rounded' },
  { value: 'Georgia, "Times New Roman", serif', label: 'Serif' },
  { value: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace', label: 'Monospace' },
  { value: '"Marker Felt", "Bradley Hand", "Comic Sans MS", cursive', label: 'Handwritten' }
]

/** Edit a list of colors: each swatch editable and removable, plus add (up to `max`). */
function PaletteEditor({ colors, onChange, max, label }: { colors: string[]; onChange(c: string[]): void; max: number; label: string }) {
  return (
    <div className="st-palette">
      {colors.map((c, i) => (
        <span key={i} className="st-palette-item">
          <ColorField label={`${label} ${i + 1}`} value={c} onChange={(v) => onChange(colors.map((x, j) => (j === i ? v : x)))} />
          {colors.length > 1 && (
            <button className="st-btn subtle icon" aria-label={`Remove ${label} ${i + 1}`} onClick={() => onChange(colors.filter((_, j) => j !== i))}>
              <X size={12} />
            </button>
          )}
        </span>
      ))}
      {colors.length < max && (
        <button className="st-btn subtle" onClick={() => onChange([...colors, '#888888'])}>
          <Plus size={13} /> Add
        </button>
      )}
    </div>
  )
}

export function ToolsSection({ snap, set }: SectionProps) {
  const a = snap.settings.annotate
  const v = snap.settings.toolVariants
  const rectVariants = FEATURES.find((f) => f.id === 'rect')!.variants!
  const setA = (patch: Partial<Settings['annotate']>) => set({ annotate: patch })
  const setText = (patch: Partial<Settings['annotate']['text']>) => set({ annotate: { text: patch } })
  return (
    <>
      <Group title="Colors" note="Picks you make while capturing stay until you change these settings or quit Snapkit.">
        <Row label="Quick colors" desc="In the style bar; the first is the starting color.">
          <PaletteEditor label="Color" colors={a.palette} max={8} onChange={(palette) => setA({ palette })} />
        </Row>
        <Row label="Highlighter colors" desc="Light colors work best.">
          <PaletteEditor label="Highlighter color" colors={a.highlighterPalette} max={6} onChange={(highlighterPalette) => setA({ highlighterPalette, highlighterColor: highlighterPalette[0] })} />
        </Row>
      </Group>

      <Group title="Lines and shapes">
        <Row label="Line widths" desc="Thin, medium and thick, in px.">
          {a.strokeWidths.map((w, i) => (
            <NumberField
              key={i}
              label={['Thin', 'Medium', 'Thick'][i] + ' width'}
              min={1}
              max={40}
              value={w}
              onChange={(n) => setA({ strokeWidths: a.strokeWidths.map((x, j) => (j === i ? n : x)) as [number, number, number] })}
            />
          ))}
        </Row>
        <Row label="Starting width">
          <Segmented
            label="Starting width"
            value={String(a.strokeWidth)}
            options={['Thin', 'Medium', 'Thick'].map((l, i) => ({ value: String(i), label: l }))}
            onChange={(i) => setA({ strokeWidth: Number(i) })}
          />
        </Row>
        <Row label="Arrow style">
          <Segmented
            label="Arrow style"
            value={v.arrow ?? 'arrow-open'}
            options={[
              { value: 'arrow-open', label: 'Open' },
              { value: 'arrow', label: 'Filled' }
            ]}
            onChange={(arrow) => set({ toolVariants: { ...v, arrow } })}
          />
        </Row>
        <Row label="Rectangle tool draws" desc="Right-click the tool to switch while capturing.">
          <select className="st-select" value={v.rect ?? 'rect'} onChange={(e) => set({ toolVariants: { ...v, rect: e.target.value } })} aria-label="Rectangle tool default">
            {rectVariants.map((r) => (
              <option key={r.id} value={r.id}>
                {r.label}
              </option>
            ))}
          </select>
        </Row>
        <Row label="Highlighter width">
          <SliderField label="Highlighter width" min={6} max={40} value={a.highlighterWidth} format={(n) => `${n} px`} onChange={(highlighterWidth) => setA({ highlighterWidth })} />
        </Row>
      </Group>

      <Group title="Text">
        <Row label="Font">
          <select className="st-select" value={a.text.fontFamily} onChange={(e) => setText({ fontFamily: e.target.value })} aria-label="Font">
            {!FONTS.some((f) => f.value === a.text.fontFamily) && <option value={a.text.fontFamily}>Custom</option>}
            {FONTS.map((f) => (
              <option key={f.label} value={f.value}>
                {f.label}
              </option>
            ))}
          </select>
        </Row>
        <Row label="Size">
          <NumberField label="Text size" min={8} max={200} value={a.text.fontSize} unit="px" onChange={(fontSize) => setText({ fontSize })} />
        </Row>
        <Row label="Starting style">
          <Segmented
            label="Starting text style"
            value={a.text.style}
            options={[
              { value: 'plain', label: 'Plain' },
              { value: 'stroke', label: 'Stroke' },
              { value: 'background', label: 'Background' }
            ]}
            onChange={(style) => setText({ style })}
          />
        </Row>
        <Row label="Stroke">
          <ColorField label="Stroke color" value={a.text.strokeColor} onChange={(strokeColor) => setText({ strokeColor })} />
          <NumberField label="Stroke width" min={1} max={12} value={a.text.strokeWidth} unit="px" onChange={(strokeWidth) => setText({ strokeWidth })} />
        </Row>
        <Row label="Background color" desc="For the background style; the text turns black or white to stay readable.">
          <ColorField label="Text background color" value={a.text.background || '#ffffff'} onChange={(background) => setText({ background })} />
        </Row>
        <Row label="Shadow">
          <SliderField label="Text shadow" min={0} max={0.6} step={0.01} value={a.text.shadow} format={(n) => (n ? `${Math.round(n * 100)}%` : 'Off')} onChange={(shadow) => setText({ shadow })} />
        </Row>
      </Group>

      <Group title="Numbered steps">
        <Row label="Badge size">
          <SliderField label="Step badge size" min={18} max={72} value={a.stepSize} format={(n) => `${n} px`} onChange={(stepSize) => setA({ stepSize })} />
        </Row>
        <Row label="Number color" desc="Auto: black or white, whichever reads better on the badge.">
          <Segmented
            label="Number color"
            value={a.stepTextColor ? 'custom' : 'auto'}
            options={[
              { value: 'auto', label: 'Auto' },
              { value: 'custom', label: 'Custom' }
            ]}
            onChange={(m) => setA({ stepTextColor: m === 'custom' ? a.stepTextColor || '#ffffff' : '' })}
          />
          {a.stepTextColor && <ColorField label="Number color" value={a.stepTextColor} onChange={(stepTextColor) => setA({ stepTextColor })} />}
        </Row>
      </Group>

      <Group title="Blur">
        <Row label="Style">
          <Segmented
            label="Blur style"
            value={a.blurMode}
            options={[
              { value: 'blur', label: 'Blur' },
              { value: 'pixelate', label: 'Pixelate' }
            ]}
            onChange={(blurMode) => setA({ blurMode })}
          />
        </Row>
        <Row label="Strength">
          <SliderField label="Blur strength" min={4} max={40} value={a.blurStrength} onChange={(blurStrength) => setA({ blurStrength })} />
        </Row>
      </Group>

    </>
  )
}
