import { Check, ChevronLeft, ChevronRight, Copy, Plus, RotateCcw, Trash2 } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import type { BeautifyBackground, BeautifyPreset } from '@shared/settings'
import { cssBackground } from '../overlay/beautify/BackgroundEditor'
import { ColorField, Group, Row, Segmented, SliderField } from './controls'
import type { SectionProps } from './Settings'

const newId = () => `p${Date.now().toString(36)}`

/** Background presets: a list on the left, the selected one's editor on the right. */
export function BackgroundSection({ snap, set }: SectionProps) {
  const b = snap.settings.beautify
  const [selectedId, setSelectedId] = useState(b.preset)
  const presets = b.presets
  const sel = presets.find((p) => p.id === selectedId) ?? presets[0]

  const save = (next: BeautifyPreset[], preset = b.preset) => set({ beautify: { presets: next, preset } })
  const update = (patch: Partial<BeautifyPreset>) => save(presets.map((p) => (p.id === sel.id ? { ...p, ...patch } : p)))
  const setBg = (background: BeautifyBackground) => update({ background })
  const add = (from: BeautifyPreset) => {
    const p = { ...from, id: newId(), name: `${from.name} copy` }
    save([...presets, p])
    setSelectedId(p.id)
  }
  const remove = () => {
    const rest = presets.filter((p) => p.id !== sel.id)
    save(rest, b.preset === sel.id ? rest[0].id : b.preset)
    setSelectedId(rest[0].id)
  }

  return (
    <>
    <div className="st-split">
      <div className="st-preset-list" role="listbox" aria-label="Background presets">
        {presets.map((p) => (
          <button key={p.id} role="option" aria-selected={p.id === sel.id} className={`st-preset${p.id === sel.id ? ' active' : ''}`} onClick={() => setSelectedId(p.id)}>
            <span className="st-preset-swatch" style={{ background: cssBackground(p.background) }} />
            <span className="st-preset-name">{p.name}</span>
            {p.id === b.preset && <small className="st-badge">Default</small>}
          </button>
        ))}
        <button className="st-btn subtle" onClick={() => add({ id: '', name: 'New preset', background: { type: 'gradient', from: '#a1c4fd', to: '#c2e9fb', angle: 135 }, padding: 48, radius: 12, shadow: 0.3 })}>
          <Plus size={13} /> New preset
        </button>
      </div>

      {sel && (
        <div className="st-preset-editor">
          <div className="st-preset-preview" style={{ background: cssBackground(sel.background), padding: Math.min(40, sel.padding / 2) }}>
            <div
              className="st-preset-shot"
              style={{ borderRadius: sel.radius / 2, boxShadow: sel.shadow ? `0 ${6 * sel.shadow}px ${24 * sel.shadow}px rgba(0,0,0,${sel.shadow})` : 'none' }}
            />
          </div>
          <Group>
            <Row label="Name">
              <input className="st-input wide" aria-label="Preset name" value={sel.name} onChange={(e) => update({ name: e.target.value })} />
            </Row>
            <Row label="Background">
              <Segmented
                label="Background type"
                value={sel.background.type === 'solid' ? 'solid' : 'gradient'}
                options={[
                  { value: 'gradient', label: 'Gradient' },
                  { value: 'solid', label: 'Color' }
                ]}
                onChange={(t) =>
                  setBg(
                    t === 'solid'
                      ? { type: 'solid', color: sel.background.type === 'gradient' ? sel.background.from : '#ffffff' }
                      : { type: 'gradient', from: sel.background.type === 'solid' ? sel.background.color : '#a1c4fd', to: '#6366f1', angle: 135 }
                  )
                }
              />
            </Row>
            {sel.background.type === 'gradient' && (
              <>
                <Row label="Colors">
                  <ColorField label="Start color" value={sel.background.from} onChange={(from) => setBg({ ...(sel.background as Extract<BeautifyBackground, { type: 'gradient' }>), from })} />
                  <ColorField label="End color" value={sel.background.to} onChange={(to) => setBg({ ...(sel.background as Extract<BeautifyBackground, { type: 'gradient' }>), to })} />
                </Row>
                <Row label="Angle">
                  <SliderField
                    label="Gradient angle"
                    min={0}
                    max={359}
                    value={sel.background.angle}
                    format={(n) => `${n}°`}
                    onChange={(angle) => setBg({ ...(sel.background as Extract<BeautifyBackground, { type: 'gradient' }>), angle })}
                  />
                </Row>
              </>
            )}
            {sel.background.type === 'solid' && (
              <Row label="Color">
                <ColorField label="Background color" value={sel.background.color} onChange={(color) => setBg({ type: 'solid', color })} />
              </Row>
            )}
            <Row label="Padding">
              <SliderField label="Padding" min={0} max={200} value={sel.padding} format={(n) => `${n} px`} onChange={(padding) => update({ padding })} />
            </Row>
            <Row label="Corners">
              <SliderField label="Corner radius" min={0} max={48} value={sel.radius} format={(n) => `${n} px`} onChange={(radius) => update({ radius })} />
            </Row>
            <Row label="Shadow">
              <SliderField label="Shadow" min={0} max={1} step={0.01} value={sel.shadow} format={(n) => `${Math.round(n * 100)}%`} onChange={(shadow) => update({ shadow })} />
            </Row>
          </Group>
          <div className="st-actions">
            <button className="st-btn" disabled={sel.id === b.preset} onClick={() => set({ beautify: { preset: sel.id } })}>
              <Check size={14} /> {sel.id === b.preset ? 'Default preset' : 'Make default'}
            </button>
            <button className="st-btn" onClick={() => add(sel)}>
              <Copy size={14} /> Duplicate
            </button>
            <button className="st-btn danger" disabled={presets.length < 2} onClick={remove}>
              <Trash2 size={14} /> Delete
            </button>
          </div>
        </div>
      )}
    </div>

    <LibraryEditor<[string, string]>
      title="Gradient library"
      note="Shown in the background editor. New ones go first."
      items={b.gradients}
      defaults={snap.defaults.beautify.gradients}
      fresh={['#a1c4fd', '#6366f1']}
      swatch={([from, to]) => `linear-gradient(225deg, ${from}, ${to})`}
      describe={([from, to]) => `${from} to ${to}`}
      onChange={(gradients) => set({ beautify: { gradients } })}
      editor={(g, update) => (
        <>
          <ColorField label="Start color" value={g[0]} onChange={(c) => update([c, g[1]])} />
          <ColorField label="End color" value={g[1]} onChange={(c) => update([g[0], c])} />
        </>
      )}
    />
    <LibraryEditor
      title="Color library"
      note="Solid colors shown in the background editor."
      items={b.solids}
      defaults={snap.defaults.beautify.solids}
      fresh="#94a3b8"
      swatch={(c) => c}
      describe={(c) => c}
      onChange={(solids) => set({ beautify: { solids } })}
      editor={(c, update) => <ColorField label="Color" value={c} onChange={update} />}
    />
    </>
  )
}

/**
 * A list of swatches to edit: click one to change it, drag (or use the
 * arrows) to reorder, add (it goes first), delete, or reset to the defaults.
 */
function LibraryEditor<T>(props: {
  title: string
  note: string
  items: T[]
  defaults: T[]
  fresh: T
  swatch(item: T): string
  describe(item: T): string
  onChange(items: T[]): void
  editor(item: T, update: (next: T) => void): ReactNode
}) {
  const { title, note, items, defaults, fresh, swatch, describe, onChange, editor } = props
  const [sel, setSel] = useState<number | null>(null)
  const [drag, setDrag] = useState<number | null>(null)
  const move = (from: number, to: number) => {
    if (to < 0 || to >= items.length) return
    const next = [...items]
    const [it] = next.splice(from, 1)
    next.splice(to, 0, it)
    onChange(next)
    setSel(to)
  }
  const current = sel !== null && sel < items.length ? items[sel] : null
  return (
    <Group title={title} note={note}>
      <div className="st-row st-lib-head">
        <span className="st-muted">{items.length} {items.length === 1 ? 'item' : 'items'}</span>
        <span className="st-control">
          <button
            className="st-btn"
            onClick={() => {
              onChange([fresh, ...items])
              setSel(0)
            }}
          >
            <Plus size={13} /> Add
          </button>
          <button className="st-btn subtle" onClick={() => (onChange(defaults), setSel(null))} title="Back to the built-in list">
            <RotateCcw size={13} /> Reset to defaults
          </button>
        </span>
      </div>
      <div className="st-lib-grid">
        {items.map((it, i) => (
          <button
            key={i}
            className={`st-lib-swatch${sel === i ? ' active' : ''}${drag === i ? ' dragging' : ''}`}
            aria-label={describe(it)}
            aria-pressed={sel === i}
            draggable
            onClick={() => setSel(sel === i ? null : i)}
            onDragStart={() => setDrag(i)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault()
              if (drag !== null && drag !== i) move(drag, i)
              setDrag(null)
            }}
            onDragEnd={() => setDrag(null)}
          >
            <span style={{ background: swatch(it) }} />
          </button>
        ))}
      </div>
      {current !== null && sel !== null && (
        <div className="st-row st-lib-edit">
          <span className="st-control">{editor(current, (next) => onChange(items.map((x, j) => (j === sel ? next : x))))}</span>
          <span className="st-control">
            <button className="st-btn subtle icon" aria-label="Move earlier" disabled={sel === 0} onClick={() => move(sel, sel - 1)}>
              <ChevronLeft size={14} />
            </button>
            <button className="st-btn subtle icon" aria-label="Move later" disabled={sel === items.length - 1} onClick={() => move(sel, sel + 1)}>
              <ChevronRight size={14} />
            </button>
            <button
              className="st-btn danger"
              disabled={items.length < 2}
              onClick={() => {
                onChange(items.filter((_, j) => j !== sel))
                setSel(null)
              }}
            >
              <Trash2 size={13} /> Delete
            </button>
          </span>
        </div>
      )}
    </Group>
  )
}
