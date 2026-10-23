import { Check, Copy, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
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
  )
}
