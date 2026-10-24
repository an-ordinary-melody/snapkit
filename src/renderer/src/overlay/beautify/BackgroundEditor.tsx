import { Copy, Save, WandSparkles, X } from 'lucide-react'
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { EDITOR_ZOOM_EVENT } from '../annotate/AnnotationLayer'
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
/** Room above the preview for the docked tools and style bar (more when they wrap on a narrow screen). */
const TOOLBAR_ROOM = 112
/** Ctrl / ⌘ + scroll zooms the preview; the image is redrawn sharp this long after the last step. */
const ZOOM_SETTLE_MS = 120
const isMac = /Mac/.test(navigator.platform)


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

  // The docked bars wrap onto more rows when the stage is narrow (small or scaled screens).
  const dockRef = useRef<HTMLDivElement>(null)
  const [dockH, setDockH] = useState(0)
  useEffect(() => {
    const el = stageRef.current
    const dock = dockRef.current
    if (!el) return
    const ro = new ResizeObserver(() => {
      setArea({ w: el.clientWidth, h: el.clientHeight })
      if (dock) setDockH(dock.offsetHeight)
    })
    ro.observe(el)
    if (dock) ro.observe(dock)
    return () => ro.disconnect()
  }, [])
  const room = Math.max(TOOLBAR_ROOM, dockH + 30)

  // Esc steps back one level: typing, then a selected shape, then the editor
  // itself. It never closes the capture.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLInputElement
      // Ctrl / ⌘ + 0 fits the preview again; + and - zoom in and out.
      if ((e.ctrlKey || e.metaKey) && !typing && ['0', '=', '+', '-'].includes(e.key)) {
        e.preventDefault()
        e.stopImmediatePropagation()
        if (e.key === '0') zoomTo(1)
        else zoomTo(zoomRef.current * (e.key === '-' ? 0.8 : 1.25))
        return
      }
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
  const fitCss = area.w ? Math.min(1, (area.w - 48) / (full.width / exportScale), (area.h - room - 24) / (full.height / exportScale)) : 0

  // Zoom: 1 = fit. Ctrl / ⌘ + scroll (or a trackpad pinch) zooms around the pointer, Ctrl / ⌘ + 0 fits again.
  // `zoom` follows the wheel at once (a CSS scale); `drawnZoom` is redrawn sharp once it settles.
  // Up to 2 output pixels per screen pixel, so a zoomed preview never needs a huge canvas.
  const maxZoom = fitCss > 0 ? Math.max(1, Math.min(8, (2 * exportScale) / (fitCss * dpr))) : 1
  const [zoom, setZoom] = useState(1)
  const [drawnZoom, setDrawnZoom] = useState(1)
  const zoomRef = useRef(1)
  zoomRef.current = zoom
  const maxZoomRef = useRef(maxZoom)
  maxZoomRef.current = maxZoom
  const scrollRef = useRef<HTMLDivElement>(null)
  const zoomerRef = useRef<HTMLDivElement>(null)
  /** The point under the pointer (as a fraction of the preview) stays under it while zooming. */
  const anchor = useRef<{ u: number; v: number; x: number; y: number } | null>(null)
  const zoomTo = (z: number, at?: { x: number; y: number }) => {
    const next = Math.min(maxZoomRef.current, Math.max(1, z))
    const r = zoomerRef.current?.getBoundingClientRect()
    if (r && r.width) {
      const x = at?.x ?? r.left + r.width / 2
      const y = at?.y ?? r.top + r.height / 2
      anchor.current = { u: Math.min(1, Math.max(0, (x - r.left) / r.width)), v: Math.min(1, Math.max(0, (y - r.top) / r.height)), x, y }
    }
    zoomRef.current = next // several wheel events can arrive before the next render: each builds on the last
    setZoom(next)
  }
  useEffect(() => {
    const t = setTimeout(() => setDrawnZoom(zoom), ZOOM_SETTLE_MS)
    return () => clearTimeout(t)
  }, [zoom])
  useEffect(() => {
    const el = stageRef.current
    if (!el) return
    // A trackpad pinch arrives as a wheel event with ctrlKey set although Control isn't held:
    // track the real key to tell the two apart.
    let ctrlHeld = false
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Control') ctrlHeld = e.type === 'keydown'
    }
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return
      e.preventDefault()
      const pinch = e.ctrlKey && !ctrlHeld && !e.metaKey
      // Zoom in when scrolling up. On a Mac (natural scrolling) scrolling up sends a positive delta,
      // on Windows a negative one; a pinch is negative when spreading, on both.
      const up = isMac && !pinch ? e.deltaY : -e.deltaY
      // A mouse wheel notch (±100) is about 20%; trackpads send many small steps.
      zoomTo(zoomRef.current * Math.min(1.25, Math.max(0.8, Math.exp(up * 0.002))), { x: e.clientX, y: e.clientY })
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('keyup', onKey, true)
    return () => {
      el.removeEventListener('wheel', onWheel)
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('keyup', onKey, true)
    }
  }, [])

  const scale = fitCss * drawnZoom * dpr // preview image px per screen px
  const source = useMemo(() => (scale > 0 ? compose(scale) : null), [compose, scale])
  const layout = source ? beautifyLayout(source.width, source.height, shown, scale, scale / exportScale) : null

  // Hold Space for the hand: drag to move around the zoomed preview (like Photoshop). Typing keeps its spaces.
  const [hand, setHand] = useState(false)
  const [grabbing, setGrabbing] = useState(false)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== 'Space') return
      const typing = e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLInputElement
      if (typing && e.type === 'keydown') return
      e.preventDefault() // no page scroll, no button press
      e.stopImmediatePropagation()
      setHand(e.type === 'keydown')
    }
    const off = () => setHand(false)
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('keyup', onKey, true)
    window.addEventListener('blur', off)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('keyup', onKey, true)
      window.removeEventListener('blur', off)
    }
  }, [])
  const pan = (e: React.PointerEvent<HTMLDivElement>) => {
    const sc = scrollRef.current
    if (!sc || e.button !== 0) return
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    const start = { x: e.clientX, y: e.clientY, left: sc.scrollLeft, top: sc.scrollTop }
    setGrabbing(true)
    const el = e.currentTarget
    const move = (ev: PointerEvent) => {
      sc.scrollLeft = start.left - (ev.clientX - start.x)
      sc.scrollTop = start.top - (ev.clientY - start.y)
    }
    const up = () => {
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
      el.removeEventListener('pointercancel', up)
      setGrabbing(false)
    }
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
    el.addEventListener('pointercancel', up)
  }

  // A layout effect: the canvas has its new size before the zoom anchor below measures it.
  useLayoutEffect(() => {
    const out = canvasRef.current
    if (!out || !source || !bg) return
    drawBeautified(source, bg, shown, scale, image, out, scale / exportScale)
    out.style.width = `${out.width / dpr}px`
    out.style.height = `${out.height / dpr}px`
  }, [source, bg, shown, scale, image, dpr, exportScale])

  // Once the sharp redraw is in, scroll so the anchored point is back under the pointer.
  useLayoutEffect(() => {
    const a = anchor.current
    const sc = scrollRef.current
    const r = zoomerRef.current?.getBoundingClientRect()
    if (!a || !sc || !r || zoom !== drawnZoom) return
    sc.scrollLeft += r.left + a.u * r.width - a.x
    sc.scrollTop += r.top + a.v * r.height - a.y
    anchor.current = null
    window.dispatchEvent(new Event(EDITOR_ZOOM_EVENT))
  }, [drawnZoom, zoom])
  // Leaving the editor: the drawing layer goes back to its normal resolution.
  useEffect(() => () => void setTimeout(() => window.dispatchEvent(new Event(EDITOR_ZOOM_EVENT)), 0), [])

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
          <div ref={dockRef} className="be-dock">{toolbar}</div>
          <div ref={scrollRef} className="be-scroll">
            <div className="be-canvas" style={{ marginTop: room }}>
              <div
                ref={zoomerRef}
                className="be-zoomer"
                // Between wheel steps and the sharp redraw: scale what's drawn, around the pointer.
                style={
                  zoom !== drawnZoom
                    ? { transform: `scale(${zoom / drawnZoom})`, transformOrigin: anchor.current ? `${anchor.current.u * 100}% ${anchor.current.v * 100}%` : '50% 0' }
                    : undefined
                }
              >
                <canvas ref={canvasRef} />
                {layout && annotations({ left: layout.x / dpr, top: layout.y / dpr, k: layout.drawW / dpr / selection.w })}
              </div>
            </div>
          </div>
          {/* Space held: a hand over the preview (below the tool bars) instead of the drawing tools. */}
          {hand && <div className={`be-pan${grabbing ? ' grabbing' : ''}`} onPointerDown={pan} />}
          {zoom > 1 && (
            <button className="be-zoom" title="Fit to the window (Ctrl+0 / ⌘0)" onClick={() => zoomTo(1)}>
              {Math.round(zoom * 100)}% · Fit
            </button>
          )}
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
