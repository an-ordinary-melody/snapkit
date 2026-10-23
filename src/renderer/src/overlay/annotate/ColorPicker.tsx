import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Slider } from '../Slider'
import { hexToHsv, hsvToHex, parseHex, type Hsv } from './color'

/**
 * Saturation/brightness square, hue slider and hex field. Place it inside a
 * `.picker-anchor`; it opens below or above that, wherever there's room, and
 * is rendered at the top of the page (a portal, position: fixed) so no
 * scrolling, clipped or blurred parent can cut it off.
 */
export function ColorPicker({ color, onChange, onClose }: { color: string; onChange(c: string): void; onClose(): void }) {
  const ref = useRef<HTMLDivElement>(null)
  const markRef = useRef<HTMLSpanElement>(null) // sits in the anchor, so we know where that is
  const [hsv, setHsv] = useState<Hsv>(() => hexToHsv(color))
  const [hex, setHex] = useState(color)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)

  useLayoutEffect(() => {
    const anchor = markRef.current?.parentElement?.getBoundingClientRect()
    const me = ref.current?.getBoundingClientRect()
    if (!anchor || !me) return
    const GAP = 10
    const M = 8
    const below = anchor.bottom + GAP + me.height <= window.innerHeight - M
    const top = below ? anchor.bottom + GAP : Math.max(M, anchor.top - GAP - me.height)
    const left = Math.min(Math.max(M, anchor.left + anchor.width / 2 - me.width / 2), window.innerWidth - me.width - M)
    setPos({ left, top })
  }, [])

  // Close on a click anywhere outside the picker.
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node
      const anchor = markRef.current?.parentElement
      if (anchor && !anchor.contains(t) && !ref.current?.contains(t)) onClose()
    }
    // Esc closes the picker only, never the capture (or the editor) behind it.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      e.stopImmediatePropagation()
      onClose()
    }
    window.addEventListener('pointerdown', onDown, true)
    window.addEventListener('keydown', onKey, true)
    return () => {
      window.removeEventListener('pointerdown', onDown, true)
      window.removeEventListener('keydown', onKey, true)
    }
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

  const panel = (
    <div ref={ref} className="color-picker" style={pos ?? { left: 0, top: 0, visibility: 'hidden' }}>
      <div className="sv" style={{ background: `hsl(${hsv.h} 100% 50%)` }} onPointerDown={dragSquare}>
        <div className="sv-white" />
        <div className="sv-black" />
        <div className="sv-dot" style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%`, background: hsvToHex(hsv) }} />
      </div>
      <Slider className="hue" label="Hue" min={0} max={359} value={Math.round(hsv.h)} onChange={(h) => set({ ...hsv, h })} />
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
            if (e.key === 'Enter') onClose()
          }}
        />
      </div>
    </div>
  )
  return (
    <>
      <span ref={markRef} hidden />
      {createPortal(panel, document.body)}
    </>
  )
}
