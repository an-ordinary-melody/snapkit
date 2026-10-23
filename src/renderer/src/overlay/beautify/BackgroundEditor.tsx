import { Copy, Save, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { BeautifyBackground, BeautifyPreset } from '@shared/settings'
import { ColorPicker } from '../annotate/ColorPicker'
import { Slider } from '../Slider'
import { backgroundOf, beautifyLayout, FRAMES, PLAIN, stateFromPreset, type BeautifyState, type Frame } from './layout'
import { drawBeautified, loadBackgroundImage } from './render'

/** Built-in backgrounds offered in the editor: 11 each, then a custom slot. */
const GRADIENTS: [string, string][] = [
  ['#4f8cff', '#a855f7'], ['#fb923c', '#ec4899'], ['#34d399', '#06b6d4'], ['#fbc2eb', '#a6c1ee'],
  ['#fde68a', '#f59e0b'], ['#f97316', '#ef4444'], ['#7c3aed', '#db2777'], ['#38bdf8', '#6366f1'],
  ['#a3e635', '#16a34a'], ['#94a3b8', '#334155'], ['#0f172a', '#312e81']
]
const SOLIDS = ['#ffffff', '#e5e7eb', '#71717a', '#111111', '#ef4444', '#f97316', '#facc15', '#22c55e', '#14b8a6', '#3b82f6', '#a855f7']

const SIDEBAR = 300
/** Room above the preview for the drawing tools. */
const TOOLBAR_ROOM = 108

interface Props {
  presets: BeautifyPreset[]
  state: BeautifyState
  onChange(next: BeautifyState): void
  /** Selection size in screen px, and image px per screen px of the final output. */
  selection: { w: number; h: number }
  exportScale: number
  /** The selection without annotations (they're drawn live on top), at `scale` image px per screen px. */
  compose(scale: number): HTMLCanvasElement
  /** The live annotation layer, placed over the screenshot at `place` (CSS px, `k` = zoom). */
  annotations(place: { left: number; top: number; k: number }): ReactNode
  /** Drawing tools and style bar, docked above the preview. */
  toolbar: ReactNode
  onClose(): void
  onCopy(): void
  onSave(): void
}

export function cssBackground(bg: BeautifyBackground): string {
  if (bg.type === 'solid') return bg.color
  if (bg.type === 'gradient') return `linear-gradient(${bg.angle + 90}deg, ${bg.from}, ${bg.to})`
  return '#9ca3af'
}

const sameGradient = (bg: BeautifyBackground | null, [from, to]: [string, string]) =>
  bg?.type === 'gradient' && bg.from.toLowerCase() === from && bg.to.toLowerCase() === to
const sameFrame = (a: Frame | undefined, b: Frame) => JSON.stringify(a ?? { kind: 'auto' }) === JSON.stringify(b)

/** Full-screen editor: background, layout and output size, with the drawing tools at hand. */
export function BackgroundEditor(props: Props) {
  const { presets, state, onChange, selection, exportScale, compose, annotations, toolbar, onClose, onCopy, onSave } = props
  const stageRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [area, setArea] = useState({ w: 0, h: 0 })
  const [picking, setPicking] = useState<null | 'solid' | 'from' | 'to'>(null)
  const [image, setImage] = useState<HTMLImageElement | null>(null)
  const bg = backgroundOf(state, presets)
  const shown = useMemo(() => (state.on ? state : { ...state, ...PLAIN }), [state]) // the switch previews right here

  useEffect(() => {
    const el = stageRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setArea({ w: el.clientWidth, h: el.clientHeight }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Esc closes the editor (not the capture), unless a color picker is open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || picking || e.target instanceof HTMLTextAreaElement) return
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

  // Fit the whole output into the preview area, sharp on Retina.
  const dpr = window.devicePixelRatio || 1
  const full = beautifyLayout(selection.w * exportScale, selection.h * exportScale, shown, exportScale)
  const fitCss = area.w ? Math.min(1, (area.w - 48) / (full.width / exportScale), (area.h - TOOLBAR_ROOM - 24) / (full.height / exportScale)) : 0
  const scale = fitCss * dpr // preview image px per screen px
  const source = useMemo(() => (scale > 0 ? compose(scale) : null), [compose, scale])
  const layout = source ? beautifyLayout(source.width, source.height, shown, scale, scale / exportScale) : null

  useEffect(() => {
    const out = canvasRef.current
    if (!out || !source || !bg) return
    drawBeautified(source, bg, shown, scale, image, out, scale / exportScale)
    out.style.width = `${out.width / dpr}px`
    out.style.height = `${out.height / dpr}px`
  }, [source, bg, shown, scale, image, dpr, exportScale])

  const set = (patch: Partial<BeautifyState>) => onChange({ ...state, ...patch, on: true })
  const setBg = (b: BeautifyBackground) => set({ background: b })
  const gradient = bg?.type === 'gradient' ? bg : null
  const customGradient = gradient && !GRADIENTS.some((g) => sameGradient(bg, g))
  const customSolid = bg?.type === 'solid' && !SOLIDS.includes(bg.color.toLowerCase())
  const size = state.frame?.kind === 'size' ? state.frame : null

  const row = (label: string, key: 'padding' | 'radius' | 'shadow', max: number, step: number, fmt = (v: number) => String(v)) => (
    <div className="be-row">
      <span>{label}</span>
      <Slider label={label} min={0} max={max} step={step} value={state[key]} onChange={(v) => set({ [key]: v })} />
      <span className="be-value">{fmt(state[key])}</span>
    </div>
  )

  const picker = (which: 'solid' | 'from' | 'to', color: string, apply: (c: string) => void) =>
    picking === which && <ColorPicker color={color} onChange={apply} onClose={() => setPicking(null)} />

  return (
    <div className="be-backdrop" onPointerDown={(e) => e.stopPropagation()} onContextMenu={(e) => e.preventDefault()}>
      <div className="be-card">
        <div ref={stageRef} className="be-stage">
          <div className="be-dock">{toolbar}</div>
          <div className="be-canvas" style={{ marginTop: TOOLBAR_ROOM - 24 }}>
            <canvas ref={canvasRef} />
            {layout && annotations({ left: layout.x / dpr, top: layout.y / dpr, k: layout.drawW / dpr / selection.w })}
          </div>
        </div>

        <div className="be-side" style={{ width: SIDEBAR }}>
          <div className="be-head">
            <span>Background</span>
            <button className={`switch${state.on ? ' on' : ''}`} aria-label="Background on" aria-pressed={state.on} onClick={() => onChange({ ...state, on: !state.on })}>
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
                onClick={() => onChange(stateFromPreset(p, true, state.frame))}
              >
                <span style={{ background: cssBackground(p.background) }} />
              </button>
            ))}
          </div>

          <div className="be-section">Gradients</div>
          <div className="be-grid">
            {GRADIENTS.map(([from, to]) => (
              <button
                key={from + to}
                className={`be-swatch${sameGradient(bg, [from, to]) ? ' active' : ''}`}
                onClick={() => setBg({ type: 'gradient', from, to, angle: gradient?.angle ?? 135 })}
              >
                <span style={{ background: `linear-gradient(${(gradient?.angle ?? 135) + 90}deg, ${from}, ${to})` }} />
              </button>
            ))}
            <button
              className={`be-swatch custom${customGradient ? ' active' : ''}`}
              title="Custom gradient"
              onClick={() => !gradient && setBg({ type: 'gradient', from: '#ffffff', to: '#3b82f6', angle: 135 })}
            >
              <span style={customGradient && gradient ? { background: cssBackground(gradient) } : undefined} />
            </button>
          </div>
          {gradient && (
            <div className="be-gradient-edit">
              <div className="picker-anchor">
                <button className="be-color" title="Start color" onClick={() => setPicking(picking === 'from' ? null : 'from')}>
                  <span style={{ background: gradient.from }} />
                </button>
                {picker('from', gradient.from, (c) => setBg({ ...gradient, from: c }))}
              </div>
              <div className="picker-anchor">
                <button className="be-color" title="End color" onClick={() => setPicking(picking === 'to' ? null : 'to')}>
                  <span style={{ background: gradient.to }} />
                </button>
                {picker('to', gradient.to, (c) => setBg({ ...gradient, to: c }))}
              </div>
              <div className="be-row be-angle">
                <span>Angle</span>
                <Slider label="Gradient angle" min={0} max={359} value={gradient.angle} onChange={(angle) => setBg({ ...gradient, angle })} />
                <span className="be-value">{gradient.angle}°</span>
              </div>
            </div>
          )}

          <div className="be-section">Solid colors</div>
          <div className="be-grid">
            {SOLIDS.map((color) => (
              <button
                key={color}
                className={`be-swatch${bg?.type === 'solid' && bg.color.toLowerCase() === color ? ' active' : ''}`}
                title={color}
                onClick={() => setBg({ type: 'solid', color })}
              >
                <span style={{ background: color }} />
              </button>
            ))}
            <div className="picker-anchor">
              <button className={`be-swatch custom${customSolid ? ' active' : ''}`} title="Custom color" onClick={() => setPicking(picking === 'solid' ? null : 'solid')}>
                <span style={customSolid && bg?.type === 'solid' ? { background: bg.color } : undefined} />
              </button>
              {picker('solid', bg?.type === 'solid' ? bg.color : '#ffffff', (c) => setBg({ type: 'solid', color: c }))}
            </div>
          </div>

          <div className="be-section">Size</div>
          <div className="be-chips">
            {FRAMES.map((f) => (
              <button key={f.label} className={`be-chip${sameFrame(state.frame, f.frame) ? ' active' : ''}`} onClick={() => set({ frame: f.frame })}>
                {f.label}
              </button>
            ))}
            <button
              className={`be-chip${size ? ' active' : ''}`}
              onClick={() => !size && set({ frame: { kind: 'size', w: Math.round(full.width), h: Math.round(full.height) } })}
            >
              Custom
            </button>
          </div>
          {size && (
            <div className="be-size">
              <input
                type="number"
                aria-label="Width in pixels"
                min={16}
                value={size.w}
                onChange={(e) => set({ frame: { ...size, w: Math.max(16, Number(e.target.value) || 16) } })}
              />
              <span>×</span>
              <input
                type="number"
                aria-label="Height in pixels"
                min={16}
                value={size.h}
                onChange={(e) => set({ frame: { ...size, h: Math.max(16, Number(e.target.value) || 16) } })}
              />
              <span className="be-unit">px</span>
            </div>
          )}

          <div className="be-section">Layout</div>
          {row('Padding', 'padding', 200, 1)}
          {row('Corners', 'radius', 48, 1)}
          {row('Shadow', 'shadow', 1, 0.01, (v) => `${Math.round(v * 100)}%`)}
          <div className="be-output">
            Output: {Math.round(full.width)} × {Math.round(full.height)} px
          </div>

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
