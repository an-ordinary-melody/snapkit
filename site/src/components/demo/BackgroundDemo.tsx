// Signature 3: the app's own background presets and gradients, with padding, corners, shadow and output size.
import { Shuffle } from 'lucide-react'
import { useState } from 'react'
import data from '../../data/backgrounds.json'
import { CARD, PlanCard } from './Shot'

type Bg = { type: 'gradient'; from: string; to: string; angle: number } | { type: 'solid'; color: string }
type Preset = { id: string; name: string; background: Bg; padding: number; radius: number; shadow: number }

const PRESETS = data.presets as Preset[]
const GRADIENTS = data.gradients as [string, string][]
const SIZES = [
  { id: 'auto', label: 'Auto', ratio: 0 },
  { id: '1:1', label: '1:1', ratio: 1 },
  { id: '4:3', label: '4:3', ratio: 4 / 3 },
  { id: '16:9', label: '16:9', ratio: 16 / 9 }
]

const css = (bg: Bg) => (bg.type === 'solid' ? bg.color : `linear-gradient(${bg.angle}deg, ${bg.from}, ${bg.to})`)

export default function BackgroundDemo() {
  const first = PRESETS[0]
  const [bg, setBg] = useState<Bg>(first.background)
  const [pad, setPad] = useState(first.padding)
  const [radius, setRadius] = useState(first.radius)
  const [shadow, setShadow] = useState(first.shadow)
  const [size, setSize] = useState(SIZES[0])

  const usePreset = (p: Preset) => {
    setBg(p.background)
    setPad(p.padding)
    setRadius(p.radius)
    setShadow(p.shadow)
  }
  const random = () => {
    const [from, to] = GRADIENTS[Math.floor(Math.random() * GRADIENTS.length)]
    setBg({ type: 'gradient', from, to, angle: 135 })
  }

  // Output size in the drawing's own pixels: the card plus padding, widened or heightened to the ratio.
  const innerW = CARD.w + pad * 2
  const innerH = CARD.h + pad * 2
  const r = size.ratio
  const W = r ? Math.max(innerW, innerH * r) : innerW
  const H = r ? W / r : innerH
  const same = (g: [string, string]) => bg.type === 'gradient' && bg.from === g[0] && bg.to === g[1]

  return (
    <div className="bgd">
      <div className="bgd-view">
        <div className="scaled" style={{ ['--w' as string]: `${W}px`, aspectRatio: `${W} / ${H}`, maxWidth: r === 1 ? 420 : undefined, margin: '0 auto' }}>
          <div className="scaled-in bgd-frame" style={{ width: W, height: H, background: css(bg) }}>
            <PlanCard
              style={{
                position: 'absolute',
                left: (W - CARD.w) / 2,
                top: (H - CARD.h) / 2,
                borderRadius: radius,
                boxShadow: `0 ${8 + shadow * 24}px ${16 + shadow * 60}px rgba(0,0,0,${shadow * 0.9})`
              }}
            />
          </div>
        </div>
        <span className="bgd-size">
          {Math.round(W * 2)} × {Math.round(H * 2)}
        </span>
      </div>

      <div className="bgd-controls">
        <div className="bgd-presets" role="group" aria-label="Presets">
          {PRESETS.map((p) => (
            <button key={p.id} type="button" onClick={() => usePreset(p)} className="bgd-preset">
              <i style={{ background: css(p.background) }} />
              {p.name}
            </button>
          ))}
        </div>
        <div className="bgd-swatches" role="group" aria-label="Gradients">
          {GRADIENTS.slice(0, 15).map((g) => (
            <button
              key={g.join()}
              type="button"
              aria-label={`Gradient ${g[0]} to ${g[1]}`}
              aria-pressed={same(g)}
              className="bgd-swatch"
              style={{ background: `linear-gradient(135deg, ${g[0]}, ${g[1]})` }}
              onClick={() => setBg({ type: 'gradient', from: g[0], to: g[1], angle: 135 })}
            />
          ))}
          <button type="button" className="bgd-swatch bgd-random" aria-label="Random gradient" onClick={random}>
            <Shuffle size={14} />
          </button>
        </div>
        <div className="bgd-sliders">
          <label>
            Padding <output>{pad}</output>
            <input type="range" min={0} max={96} value={pad} onChange={(e) => setPad(+e.target.value)} />
          </label>
          <label>
            Corners <output>{radius}</output>
            <input type="range" min={0} max={32} value={radius} onChange={(e) => setRadius(+e.target.value)} />
          </label>
          <label>
            Shadow <output>{Math.round(shadow * 100)}%</output>
            <input type="range" min={0} max={100} value={Math.round(shadow * 100)} onChange={(e) => setShadow(+e.target.value / 100)} />
          </label>
        </div>
        <div className="bgd-sizes" role="group" aria-label="Output size">
          {SIZES.map((s) => (
            <button key={s.id} type="button" aria-pressed={size.id === s.id} onClick={() => setSize(s)}>
              {s.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
