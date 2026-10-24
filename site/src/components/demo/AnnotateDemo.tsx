// Signature 2: the tools take turns on the plan card. The blur clears while hovered.
import { Hash, Highlighter, Square, Type, Droplets } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { PlanCard } from './Shot'
import { ArrowIcon } from './Toolbar'

const STEPS: { tool: string; key: string; label: string; icon: ReactNode }[] = [
  { tool: 'rect', key: 'R', label: 'Rectangle', icon: <Square size={16} /> },
  { tool: 'highlighter', key: 'H', label: 'Highlighter', icon: <Highlighter size={16} /> },
  { tool: 'arrow', key: 'A', label: 'Arrow', icon: <ArrowIcon size={16} /> },
  { tool: 'text', key: 'T', label: 'Text', icon: <Type size={16} /> },
  { tool: 'step', key: 'N', label: 'Steps', icon: <Hash size={16} /> },
  { tool: 'blur', key: 'B', label: 'Blur', icon: <Droplets size={16} /> }
]
// One beat per drawing; the step tool drops two numbers.
const BEATS = ['rect', 'highlighter', 'arrow', 'text', 'step', 'step', 'blur']

export default function AnnotateDemo() {
  const [beat, setBeat] = useState(0)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setBeat(BEATS.length)
      return
    }
    let timer = 0
    const tick = () => {
      setBeat((b) => (b >= BEATS.length + 3 ? 0 : b + 1))
      timer = window.setTimeout(tick, 850)
    }
    const io = new IntersectionObserver(([e]) => {
      window.clearTimeout(timer)
      if (e.isIntersecting) timer = window.setTimeout(tick, 400)
    })
    io.observe(ref.current!)
    return () => {
      io.disconnect()
      window.clearTimeout(timer)
    }
  }, [])

  const shown = (n: number) => beat > n
  const current = BEATS[Math.min(beat, BEATS.length) - 1]

  return (
    <div className="an" ref={ref}>
      <div className="scaled an-shot" style={{ ['--w' as string]: '520px', aspectRatio: '520 / 310' }}>
        <div className="scaled-in" style={{ width: 520, height: 310 }}>
          <PlanCard style={{ position: 'absolute', left: 24, top: 24 }} />
          <svg className="an-svg" viewBox="0 0 520 310" width="520" height="310" aria-hidden="true">
            <rect className={`an-rect ${shown(0) ? 'on' : ''}`} x="36" y="122" width="190" height="78" rx="4" pathLength="1" />
            <rect className={`an-hl ${shown(1) ? 'on' : ''}`} x="40" y="82" width="176" height="36" rx="3" />
            <g className={`an-arrow ${shown(2) ? 'on' : ''}`}>
              <path d="M468 108 L428 202" pathLength="1" />
              <path className="head" d="M-15 -8 L0 0 L-15 8" transform="translate(428 202) rotate(113)" />
            </g>
          </svg>
          <span className={`an-text ${shown(3) ? 'on' : ''}`} style={{ left: 300, top: 118 }}>
            Best value!
          </span>
          <span className={`step-badge an-pop ${shown(4) ? 'on' : ''}`} style={{ left: 218, top: 42 }}>
            1
          </span>
          <span className={`step-badge an-pop ${shown(5) ? 'on' : ''}`} style={{ left: 312, top: 200 }}>
            2
          </span>
          <div className={`blur-box an-blur ${shown(6) ? 'on' : ''}`} style={{ left: 46, top: 212, width: 264, height: 44 }} title="Hover to peek" />
        </div>
      </div>
      <div className="an-tools" role="list" aria-label="Annotation tools and their keys">
        {STEPS.map((s) => (
          <span key={s.tool} role="listitem" className={`an-tool ${current === s.tool ? 'is-active' : ''}`}>
            <span className="an-ic">{s.icon}</span>
            <kbd>{s.key}</kbd>
            <span className="an-name">{s.label}</span>
          </span>
        ))}
      </div>
    </div>
  )
}
