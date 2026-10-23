import { Copy, Save, WandSparkles, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { BeautifyBackground, BeautifyPreset } from '@shared/settings'
import { hexToHsv, hsvToHex, parseHex } from '../annotate/color'
import { ColorPicker } from '../annotate/ColorPicker'
import { Slider } from '../Slider'
import { backgroundOf, beautifyLayout, FRAMES, PLAIN, type BeautifyState, type Frame } from './layout'
import { drawBeautified, loadBackgroundImage } from './render'

/** A pleasant random gradient / color for the magic-wand button. */
function randomGradient(angle: number): BeautifyBackground {
  const h = Math.random() * 360
  const from = hsvToHex({ h, s: 0.45 + Math.random() * 0.3, v: 0.9 + Math.random() * 0.1 })
  const to = hsvToHex({ h: (h + 30 + Math.random() * 60) % 360, s: 0.6 + Math.random() * 0.3, v: 0.65 + Math.random() * 0.3 })
  return { type: 'gradient', from, to, angle }
}
const randomColor = (): BeautifyBackground => ({ type: 'solid', color: hsvToHex({ h: Math.random() * 360, s: 0.35 + Math.random() * 0.5, v: 0.6 + Math.random() * 0.4 }) })

/** Rotate a color's hue by `deg`. */
const shiftHue = (hex: string, deg: number) => {
  const c = hexToHsv(hex)
  return hsvToHex({ ...c, h: (c.h + deg + 360) % 360 })
}

const SIDEBAR = 300
/** Room above the preview for the docked tools and style bar. */
const TOOLBAR_ROOM = 112

interface Props {
  presets: BeautifyPreset[]
  /** The gradient and color libraries (from settings). */
  gradients: [string, string][]
  solids: string[]
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
  /** Esc: return true if something smaller was undone first (e.g. a shape deselected), so the editor stays. */
  onEscape(): boolean
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
  const { presets, gradients, solids, state, onChange, selection, exportScale, compose, annotations, toolbar, onClose, onEscape, onCopy, onSave } = props
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

  // Esc steps back one level: typing, then a selected shape, then the editor
  // itself. It never closes the capture.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || picking || e.target instanceof HTMLTextAreaElement) return
      e.preventDefault()
      e.stopImmediatePropagation()
      if (!onEscape()) onClose()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose, onEscape, picking])

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
  const tab = bg?.type ?? 'gradient'
  /** Switching tabs carries the color over, so the preview changes right away. */
  const switchTab = (t: 'gradient' | 'solid' | 'image') => {
    if (t === tab || t === 'image') return
    if (t === 'solid') setBg({ type: 'solid', color: gradient?.from ?? '#ffffff' })
    else if (bg?.type === 'solid') setBg({ type: 'gradient', from: bg.color, to: shiftHue(bg.color, 40), angle: 135 })
    else setBg(randomGradient(135))
  }

  /** Swatch (opens the picker) + editable hex value. */
  const colorField = (which: 'solid' | 'from' | 'to', label: string, color: string, apply: (c: string) => void) => (
    <div className="be-field">
      <div className="picker-anchor">
        <button className="be-color" aria-label={`${label}: pick`} onClick={() => setPicking(picking === which ? null : which)}>
          <span style={{ background: color }} />
        </button>
        {picker(which, color, apply)}
      </div>
      <HexInput label={label} value={color} onChange={apply} />
    </div>
  )
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
    <div
      className="be-backdrop"
      onPointerDown={(e) => e.stopPropagation()}
      // A right-click in the editor must not cancel the capture behind it.
      onContextMenu={(e) => {
        e.preventDefault()
        e.stopPropagation()
      }}
    >
      <div className="be-card">
        <div ref={stageRef} className="be-stage">
          <div className="be-dock">{toolbar}</div>
          <div className="be-canvas" style={{ marginTop: TOOLBAR_ROOM }}>
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

          <div className="be-tabs" role="tablist">
            {(['gradient', 'solid', 'image'] as const).map((t) => (
              <button
                key={t}
                role="tab"
                aria-selected={tab === t}
                className={`be-tab${tab === t ? ' active' : ''}`}
                disabled={t === 'image'}
                title={t === 'image' ? 'Coming later' : undefined}
                onClick={() => switchTab(t)}
              >
                {t === 'gradient' ? 'Gradient' : t === 'solid' ? 'Color' : 'Image'}
              </button>
            ))}
          </div>

          {tab === 'gradient' && gradient && (
            <>
              <div className="be-current">
                {colorField('from', 'Start color', gradient.from, (c) => setBg({ ...gradient, from: c }))}
                {colorField('to', 'End color', gradient.to, (c) => setBg({ ...gradient, to: c }))}
                <button className="be-wand" title="Random gradient" onClick={() => setBg(randomGradient(gradient.angle))}>
                  <WandSparkles size={16} />
                </button>
              </div>
              <div className="be-row">
                <span>Hue</span>
                <Slider
                  className="hue"
                  label="Gradient hue"
                  min={0}
                  max={359}
                  value={Math.round(hexToHsv(gradient.from).h)}
                  onChange={(h) => {
                    const d = h - hexToHsv(gradient.from).h
                    setBg({ ...gradient, from: shiftHue(gradient.from, d), to: shiftHue(gradient.to, d) })
                  }}
                />
                <span className="be-value">{Math.round(hexToHsv(gradient.from).h)}°</span>
              </div>
              <div className="be-row">
                <span>Angle</span>
                <Slider label="Gradient angle" min={0} max={359} value={gradient.angle} onChange={(angle) => setBg({ ...gradient, angle })} />
                <span className="be-value">{gradient.angle}°</span>
              </div>
              <div className="be-grid">
                {gradients.map(([from, to]) => (
                  <button
                    key={from + to}
                    className={`be-swatch${sameGradient(bg, [from, to]) ? ' active' : ''}`}
                    aria-label={`Gradient ${from} to ${to}`}
                    onClick={() => setBg({ type: 'gradient', from, to, angle: gradient.angle })}
                  >
                    <span style={{ background: `linear-gradient(${gradient.angle + 90}deg, ${from}, ${to})` }} />
                  </button>
                ))}
              </div>
            </>
          )}

          {tab === 'solid' && bg?.type === 'solid' && (
            <>
              <div className="be-current">
                {colorField('solid', 'Color', bg.color, (c) => setBg({ type: 'solid', color: c }))}
                <button className="be-wand" title="Random color" onClick={() => setBg(randomColor())}>
                  <WandSparkles size={16} />
                </button>
              </div>
              <div className="be-grid">
                {solids.map((color) => (
                  <button
                    key={color}
                    className={`be-swatch${bg.color.toLowerCase() === color ? ' active' : ''}`}
                    aria-label={`Color ${color}`}
                    onClick={() => setBg({ type: 'solid', color })}
                  >
                    <span style={{ background: color }} />
                  </button>
                ))}
              </div>
            </>
          )}

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

/** Hex text field: applies valid values as you type, tidies up on blur. */
function HexInput({ label, value, onChange }: { label: string; value: string; onChange(c: string): void }) {
  const [text, setText] = useState(value)
  useEffect(() => setText(value), [value])
  return (
    <input
      className="be-hex"
      aria-label={label}
      value={text.toUpperCase()}
      maxLength={7}
      spellCheck={false}
      onChange={(e) => {
        setText(e.target.value)
        const c = parseHex(e.target.value)
        if (c) onChange(c)
      }}
      onBlur={() => setText(value)}
      onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
    />
  )
}
