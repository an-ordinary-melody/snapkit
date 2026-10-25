import { Check, ChevronLeft, ChevronRight, Plus, RotateCcw, Trash2 } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import type { BeautifyBackground, BeautifyPreset } from '@shared/settings'
import { cssBackground } from '../overlay/beautify/BackgroundEditor'
import { ColorField, Group, Row, SliderField, Toggle } from './controls'
import type { SectionProps } from './Settings'

const sameBg = (a: BeautifyBackground, b: BeautifyBackground) =>
  a.type === 'gradient' && b.type === 'gradient'
    ? a.from.toLowerCase() === b.from.toLowerCase() && a.to.toLowerCase() === b.to.toLowerCase()
    : a.type === 'solid' && b.type === 'solid' && a.color.toLowerCase() === b.color.toLowerCase()

/**
 * The default background (its look and layout), then the gradient and color
 * libraries the background editor offers; any of them can become the default.
 */
export function BackgroundSection({ snap, set }: SectionProps) {
  const b = snap.settings.beautify
  const def: BeautifyPreset = b.presets.find((p) => p.id === b.preset) ?? b.presets[0]
  const updateDefault = (patch: Partial<BeautifyPreset>) =>
    set({ beautify: { presets: b.presets.map((p) => (p.id === def.id ? { ...p, ...patch } : p)), preset: def.id } })
  const angle = def.background.type === 'gradient' ? def.background.angle : 135

  return (
    <>
      <Group title="Default background" note="Used when Background is on.">
        <div className="st-bg-preview" style={{ background: cssBackground(def.background), padding: Math.min(44, def.padding / 2) }}>
          <div
            className="st-bg-shot"
            style={{ borderRadius: def.radius / 2, boxShadow: def.shadow ? `0 ${6 * def.shadow}px ${24 * def.shadow}px rgba(0,0,0,${def.shadow})` : 'none' }}
          />
        </div>
        <Row label="Padding">
          <SliderField label="Padding" min={0} max={200} value={def.padding} format={(n) => `${n} px`} onChange={(padding) => updateDefault({ padding })} />
        </Row>
        <Row label="Corners">
          <SliderField label="Corner radius" min={0} max={48} value={def.radius} format={(n) => `${n} px`} onChange={(radius) => updateDefault({ radius })} />
        </Row>
        <Row label="Shadow">
          <SliderField label="Shadow" min={0} max={1} step={0.01} value={def.shadow} format={(n) => `${Math.round(n * 100)}%`} onChange={(shadow) => updateDefault({ shadow })} />
        </Row>
        {def.background.type === 'gradient' && (
          <Row label="Gradient angle">
            <SliderField
              label="Gradient angle"
              min={0}
              max={359}
              value={def.background.angle}
              format={(n) => `${n}°`}
              onChange={(a) => updateDefault({ background: { ...(def.background as Extract<BeautifyBackground, { type: 'gradient' }>), angle: a } })}
            />
          </Row>
        )}
        <Row label="Remember last background" desc="The last one you copied or saved with becomes the default.">
          <Toggle label="Remember last background" value={b.rememberLast} onChange={(rememberLast) => set({ beautify: { rememberLast } })} />
        </Row>
      </Group>

      <LibraryEditor<[string, string]>
        title="Gradient library"
        note="Shown in the background editor. New ones go first."
        items={b.gradients}
        defaults={snap.defaults.beautify.gradients}
        fresh={['#a1c4fd', '#6366f1']}
        swatch={([from, to]) => `linear-gradient(225deg, ${from}, ${to})`}
        describe={([from, to]) => `${from} to ${to}`}
        isDefault={([from, to]) => sameBg(def.background, { type: 'gradient', from, to, angle })}
        onMakeDefault={([from, to]) => updateDefault({ background: { type: 'gradient', from, to, angle } })}
        onChange={(gradients) => set({ beautify: { gradients } })}
        editor={(g, update) => (
          <>
            <ColorField label="Start color" value={g[0]} onChange={(c) => update([c, g[1]])} />
            <ColorField label="End color" value={g[1]} onChange={(c) => update([g[0], c])} />
          </>
        )}
      />
      <LibraryEditor<string>
        title="Color library"
        note="Solid colors shown in the background editor."
        items={b.solids}
        defaults={snap.defaults.beautify.solids}
        fresh="#94a3b8"
        swatch={(c) => c}
        describe={(c) => c}
        isDefault={(c) => sameBg(def.background, { type: 'solid', color: c })}
        onMakeDefault={(color) => updateDefault({ background: { type: 'solid', color } })}
        onChange={(solids) => set({ beautify: { solids } })}
        editor={(c, update) => <ColorField label="Color" value={c} onChange={update} />}
      />
    </>
  )
}

/**
 * A list of swatches to edit: click one to change it or make it the default,
 * drag (or use the arrows) to reorder, add (it goes first), delete, or reset.
 */
function LibraryEditor<T>(props: {
  title: string
  note: string
  items: T[]
  defaults: T[]
  fresh: T
  swatch(item: T): string
  describe(item: T): string
  isDefault(item: T): boolean
  onMakeDefault(item: T): void
  onChange(items: T[]): void
  editor(item: T, update: (next: T) => void): ReactNode
}) {
  const { title, note, items, defaults, fresh, swatch, describe, isDefault, onMakeDefault, onChange, editor } = props
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
        <span className="st-muted">
          {items.length} {items.length === 1 ? 'item' : 'items'} · click one to edit it or make it the default
        </span>
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
          <button
            className="st-btn subtle"
            onClick={() => {
              onChange(defaults)
              setSel(null)
            }}
            title="Back to the built-in list"
          >
            <RotateCcw size={13} /> Reset to defaults
          </button>
        </span>
      </div>
      <div className="st-lib-grid">
        {items.map((it, i) => (
          <button
            key={i}
            className={`st-lib-swatch${sel === i ? ' active' : ''}${drag === i ? ' dragging' : ''}`}
            aria-label={describe(it) + (isDefault(it) ? ' (default)' : '')}
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
            {isDefault(it) && (
              <em className="st-lib-default" aria-hidden>
                <Check size={10} strokeWidth={3} />
              </em>
            )}
          </button>
        ))}
      </div>
      {current !== null && sel !== null && (
        <div className="st-row st-lib-edit">
          <span className="st-control">{editor(current, (next) => onChange(items.map((x, j) => (j === sel ? next : x))))}</span>
          <span className="st-control">
            <button className="st-btn" disabled={isDefault(current)} onClick={() => onMakeDefault(current)}>
              <Check size={13} /> {isDefault(current) ? 'Default' : 'Make default'}
            </button>
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
