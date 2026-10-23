import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { hexToHsv, hsvToHex, parseHex, type Hsv } from './color'

/**
 * Saturation/brightness square, hue slider and hex field. Place it inside a
 * `.picker-anchor`; it opens above or below that, wherever there's room.
 */
export function ColorPicker({ color, onChange, onClose }: { color: string; onChange(c: string): void; onClose(): void }) {
  const ref = useRef<HTMLDivElement>(null)
  const [hsv, setHsv] = useState<Hsv>(() => hexToHsv(color))
  const [hex, setHex] = useState(color)
  const [up, setUp] = useState(true)

  useLayoutEffect(() => {
    const bar = ref.current?.parentElement?.getBoundingClientRect()
    if (bar) setUp(bar.top > 240)
  }, [])

  // Close on a click anywhere outside the picker.
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      const anchor = ref.current?.parentElement
      if (anchor && !anchor.contains(e.target as Node)) onClose()
    }
    window.addEventListener('pointerdown', onDown, true)
    return () => window.removeEventListener('pointerdown', onDown, true)
  }, [onClose])

  const set = (next: Hsv) => {
    setHsv(next)
    const c = hsvToHex(next)
    setHex(c)
    onChange(c)
  }

  const dragSquare = (e: React.PointerEvent<HTMLDivElement>) => {
    const el = e.currentTarget
    el.setPointerCapture(e.pointerId)
    const apply = (ev: { clientX: number; clientY: number }) => {
      const r = el.getBoundingClientRect()
      const s = Math.min(1, Math.max(0, (ev.clientX - r.left) / r.width))
      const v = 1 - Math.min(1, Math.max(0, (ev.clientY - r.top) / r.height))
      set({ ...hsvRef.current, s, v })
    }
    apply(e)
    const move = (ev: PointerEvent) => apply(ev)
    const up = () => {
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
    }
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
  }
  const hsvRef = useRef(hsv)
  hsvRef.current = hsv

  return (
    <div ref={ref} className={`color-picker ${up ? 'up' : 'down'}`}>
      <div className="sv" style={{ background: `hsl(${hsv.h} 100% 50%)` }} onPointerDown={dragSquare}>
        <div className="sv-white" />
        <div className="sv-black" />
        <div className="sv-dot" style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%`, background: hsvToHex(hsv) }} />
      </div>
      <input className="hue" type="range" min={0} max={359} value={Math.round(hsv.h)} onChange={(e) => set({ ...hsv, h: Number(e.target.value) })} />
      <div className="hex-row">
        <span className="preview" style={{ background: hsvToHex(hsv) }} />
        <input
          className="hex"
          value={hex}
          spellCheck={false}
          maxLength={7}
          onChange={(e) => {
            setHex(e.target.value)
            const c = parseHex(e.target.value)
            if (c) {
              setHsv(hexToHsv(c))
              onChange(c)
            }
          }}
          onKeyDown={(e) => {
            e.stopPropagation()
            if (e.key === 'Enter' || e.key === 'Escape') onClose()
          }}
        />
      </div>
    </div>
  )
}
