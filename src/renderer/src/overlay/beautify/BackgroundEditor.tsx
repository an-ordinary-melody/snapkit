import { Copy, Save, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { BeautifyBackground, BeautifyPreset } from '@shared/settings'
import { ColorPicker } from '../annotate/ColorPicker'
import { backgroundOf, stateFromPreset, type BeautifyState } from './layout'
import { drawBeautified, loadBackgroundImage } from './render'

/** Built-in backgrounds offered in the editor, on top of the presets from settings. */
const GRADIENTS: [string, string][] = [
  ['#4f8cff', '#a855f7'], ['#fb923c', '#ec4899'], ['#34d399', '#06b6d4'], ['#fbc2eb', '#a6c1ee'],
  ['#a3e635', '#22c55e'], ['#f97316', '#ef4444'], ['#7c3aed', '#db2777'], ['#38bdf8', '#6366f1'],
  ['#fde68a', '#f59e0b'], ['#fda4af', '#e11d48'], ['#22d3ee', '#3b82f6'], ['#f472b6', '#818cf8'],
  ['#065f46', '#10b981'], ['#94a3b8', '#475569'], ['#1e293b', '#475569'], ['#0f172a', '#312e81']
]
const SOLIDS = ['#ffffff', '#f4f4f5', '#e5e7eb', '#9ca3af', '#4b5563', '#18181b', '#000000', '#fee2e2', '#ffedd5', '#fef3c7', '#dcfce7', '#dbeafe', '#ede9fe', '#fce7f3']

const SIDEBAR = 300

interface Props {
  presets: BeautifyPreset[]
  state: BeautifyState
  onChange(next: BeautifyState): void
  /** Selection size in screen px. */
  selection: { w: number; h: number }
  /** The selection with its annotations, at `scale` image px per screen px. */
  compose(scale: number): HTMLCanvasElement
  onClose(): void
  onCopy(): void
  onSave(): void
}

export function cssBackground(bg: BeautifyBackground): string {
  if (bg.type === 'solid') return bg.color
  if (bg.type === 'gradient') return `linear-gradient(${bg.angle + 90}deg, ${bg.from}, ${bg.to})`
  return '#9ca3af'
}

const same = (a: BeautifyBackground | null, b: BeautifyBackground) => !!a && JSON.stringify(a) === JSON.stringify(b)

/** Full-screen editor for the background around the screenshot. */
export function BackgroundEditor({ presets, state, onChange, selection, compose, onClose, onCopy, onSave }: Props) {
  const stageRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [area, setArea] = useState({ w: 0, h: 0 })
  const [picking, setPicking] = useState<null | 'solid' | 'from' | 'to'>(null)
  const [image, setImage] = useState<HTMLImageElement | null>(null)
  const bg = backgroundOf(state, presets)

  useEffect(() => {
    const el = stageRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setArea({ w: el.clientWidth, h: el.clientHeight }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Esc closes the editor, not the capture.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || picking) return
      e.preventDefault()
      e.stopImmediatePropagation()
      onClose()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose, picking])

  useEffect(() => {
    if (bg?.type === 'image') void loadBackgroundImage(bg.path).then(setImage)
    else setImage(null)
  }, [bg])

  // Preview scale: large enough to fill the preview area, sharp on Retina.
  const dpr = window.devicePixelRatio || 1
  const fit = area.w ? Math.min(1, (area.w - 48) / (selection.w + state.padding * 2), (area.h - 48) / (selection.h + state.padding * 2)) : 0
  const scale = fit * dpr
  const source = useMemo(() => (scale > 0 ? compose(scale) : null), [compose, scale])

  useEffect(() => {
    const out = canvasRef.current
    if (!out || !source || !bg) return
    drawBeautified(source, bg, state, scale, image, out)
    out.style.width = `${out.width / dpr}px`
    out.style.height = `${out.height / dpr}px`
  }, [source, bg, state, scale, image, dpr])

  const set = (patch: Partial<BeautifyState>) => onChange({ ...state, ...patch, on: true })
  const setBg = (b: BeautifyBackground) => set({ background: b })
  const gradient = bg?.type === 'gradient' ? bg : null

  const slider = (label: string, key: 'padding' | 'radius' | 'shadow', max: number, step: number, fmt = (v: number) => String(v)) => (
    <label className="be-row">
      <span>{label}</span>
      <input
        type="range"
        min={0}
        max={max}
        step={step}
        value={state[key]}
        onChange={(e) => set({ [key]: Number(e.target.value) })}
        onPointerUp={(e) => e.currentTarget.blur()}
      />
      <span className="be-value">{fmt(state[key])}</span>
    </label>
  )

  return (
    <div className="be-backdrop" onPointerDown={(e) => e.stopPropagation()} onContextMenu={(e) => e.preventDefault()}>
      <div className="be-card">
        <div ref={stageRef} className="be-stage">
          <canvas ref={canvasRef} />
        </div>
        <div className="be-side" style={{ width: SIDEBAR }}>
          <div className="be-head">
            <span>Background</span>
            <button className={`switch${state.on ? ' on' : ''}`} data-tip={state.on ? 'On' : 'Off'} onClick={() => onChange({ ...state, on: !state.on })}>
              <span />
            </button>
          </div>

          <div className="be-section">Presets</div>
          <div className="be-grid">
            {presets.map((p) => (
              <button
                key={p.id}
                className={`be-swatch${!state.background && p.id === state.presetId ? ' active' : ''}`}
                title={p.name}
                onClick={() => onChange(stateFromPreset(p, true))}
              >
                <span style={{ background: cssBackground(p.background) }} />
              </button>
            ))}
          </div>

          <div className="be-section">Gradients</div>
          <div className="be-grid">
            {GRADIENTS.map(([from, to]) => {
              const b: BeautifyBackground = { type: 'gradient', from, to, angle: gradient?.angle ?? 135 }
              return (
                <button key={from + to} className={`be-swatch${same(bg, b) ? ' active' : ''}`} onClick={() => setBg(b)}>
                  <span style={{ background: cssBackground(b) }} />
                </button>
              )
            })}
          </div>
          {gradient && (
            <div className="be-gradient-edit">
              <div className="picker-anchor">
                <button className="be-color" title="From" onClick={() => setPicking(picking === 'from' ? null : 'from')}>
                  <span style={{ background: gradient.from }} />
                </button>
                {picking === 'from' && <ColorPicker color={gradient.from} onChange={(c) => setBg({ ...gradient, from: c })} onClose={() => setPicking(null)} />}
              </div>
              <div className="picker-anchor">
                <button className="be-color" title="To" onClick={() => setPicking(picking === 'to' ? null : 'to')}>
                  <span style={{ background: gradient.to }} />
                </button>
                {picking === 'to' && <ColorPicker color={gradient.to} onChange={(c) => setBg({ ...gradient, to: c })} onClose={() => setPicking(null)} />}
              </div>
              <label className="be-row be-angle">
                <span>Angle</span>
                <input
                  type="range"
                  min={0}
                  max={359}
                  value={gradient.angle}
                  onChange={(e) => setBg({ ...gradient, angle: Number(e.target.value) })}
                  onPointerUp={(e) => e.currentTarget.blur()}
                />
                <span className="be-value">{gradient.angle}°</span>
              </label>
            </div>
          )}

          <div className="be-section">Solid colors</div>
          <div className="be-grid">
            {SOLIDS.map((color) => {
              const b: BeautifyBackground = { type: 'solid', color }
              return (
                <button key={color} className={`be-swatch${same(bg, b) ? ' active' : ''}`} title={color} onClick={() => setBg(b)}>
                  <span style={{ background: color }} />
                </button>
              )
            })}
            <div className="picker-anchor">
              <button
                className={`be-swatch custom${bg?.type === 'solid' && !SOLIDS.includes(bg.color) ? ' active' : ''}`}
                title="Custom color"
                onClick={() => setPicking(picking === 'solid' ? null : 'solid')}
              >
                <span style={bg?.type === 'solid' && !SOLIDS.includes(bg.color) ? { background: bg.color } : undefined} />
              </button>
              {picking === 'solid' && (
                <ColorPicker color={bg?.type === 'solid' ? bg.color : '#ffffff'} onChange={(c) => setBg({ type: 'solid', color: c })} onClose={() => setPicking(null)} />
              )}
            </div>
          </div>

          <div className="be-section">Layout</div>
          {slider('Padding', 'padding', 200, 1)}
          {slider('Corners', 'radius', 48, 1)}
          {slider('Shadow', 'shadow', 1, 0.01, (v) => `${Math.round(v * 100)}%`)}

          <div className="be-actions">
            <button className="be-btn" onClick={onSave}>
              <Save size={15} /> Save
            </button>
            <button className="be-btn" onClick={onCopy}>
              <Copy size={15} /> Copy
            </button>
            <button className="be-btn primary" onClick={onClose}>
              Done
            </button>
          </div>
        </div>
        <button className="be-close" title="Close (Esc)" onClick={onClose}>
          <X size={16} />
        </button>
      </div>
    </div>
  )
}
