import { useEffect, useRef, useState } from 'react'
import type { BeautifyBackground, BeautifyPreset } from '@shared/settings'
import { stateFromPreset, type BeautifyState } from './layout'
import { drawBeautified, loadBackgroundImage } from './render'

interface Props {
  presets: BeautifyPreset[]
  state: BeautifyState
  onChange(next: BeautifyState): void
  /**
   * Small composite of the selection (with annotations) for the preview, and
   * its scale in image px per screen px.
   */
  preview(): { canvas: HTMLCanvasElement; scale: number } | null
}

const PREVIEW_W = 252
const PREVIEW_H = 150

/** CSS for a preset chip. */
function swatch(bg: BeautifyBackground): React.CSSProperties {
  if (bg.type === 'solid') return { background: bg.color }
  if (bg.type === 'gradient') return { background: `linear-gradient(${bg.angle + 90}deg, ${bg.from}, ${bg.to})` }
  return { background: '#9ca3af' }
}

export function BeautifyPanel({ presets, state, onChange, preview }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const preset = presets.find((p) => p.id === state.presetId) ?? presets[0]
  // Built once: the selection and drawing can't change while the panel is open.
  const [source, setSource] = useState<ReturnType<Props['preview']>>(null)
  useEffect(() => setSource(preview()), []) // eslint-disable-line react-hooks/exhaustive-deps
  const [image, setImage] = useState<HTMLImageElement | null>(null)

  useEffect(() => {
    if (preset?.background.type === 'image') void loadBackgroundImage(preset.background.path).then(setImage)
    else setImage(null)
  }, [preset])

  // Redraw the preview whenever anything changes.
  useEffect(() => {
    const out = canvasRef.current
    if (!out || !source || !preset) return
    const shown = state.on ? drawBeautified(source.canvas, preset.background, state, source.scale, image) : source.canvas
    const dpr = window.devicePixelRatio || 1
    out.width = PREVIEW_W * dpr
    out.height = PREVIEW_H * dpr
    const ctx = out.getContext('2d')!
    const fit = Math.min(out.width / shown.width, out.height / shown.height)
    const w = shown.width * fit
    const h = shown.height * fit
    ctx.clearRect(0, 0, out.width, out.height)
    ctx.drawImage(shown, (out.width - w) / 2, (out.height - h) / 2, w, h)
  }, [source, preset, state, image])

  if (!preset) return null
  const set = (patch: Partial<BeautifyState>) => onChange({ ...state, ...patch, on: true })
  const slider = (label: string, key: 'padding' | 'radius' | 'shadow', max: number, step = 1, fmt = (v: number) => String(v)) => (
    <label className="bp-row">
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
      <span className="bp-value">{fmt(state[key])}</span>
    </label>
  )

  return (
    <div className="beautify-panel">
      <div className="bp-head">
        <span>Background &amp; padding</span>
        <button
          className={`switch${state.on ? ' on' : ''}`}
          data-tip={state.on ? 'On for this capture' : 'Off for this capture'}
          onClick={() => onChange({ ...state, on: !state.on })}
        >
          <span />
        </button>
      </div>
      <canvas ref={canvasRef} className="bp-preview" style={{ width: PREVIEW_W, height: PREVIEW_H }} />
      <div className="bp-presets">
        {presets.map((p) => (
          <button
            key={p.id}
            className={`bp-preset${p.id === state.presetId && state.on ? ' active' : ''}`}
            data-tip={p.name}
            onClick={() => onChange(stateFromPreset(p, true))}
          >
            <span style={swatch(p.background)} />
          </button>
        ))}
      </div>
      {slider('Padding', 'padding', 160)}
      {slider('Corners', 'radius', 40)}
      {slider('Shadow', 'shadow', 1, 0.05, (v) => `${Math.round(v * 100)}%`)}
      <div className="bp-note">{state.on ? 'Copy and save include this background.' : 'Off: copy and save use the plain screenshot.'}</div>
    </div>
  )
}
