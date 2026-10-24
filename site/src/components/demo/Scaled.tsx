// A fixed-size drawing (w × h px) scaled down to its box's width. The scale is measured, since
// CSS-only ways of turning a width into a number don't work in every browser (iOS Safari).
import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'

interface Props {
  w: number
  h: number
  className?: string
  innerClassName?: string
  style?: CSSProperties
  innerStyle?: CSSProperties
  children: ReactNode
}

export default function Scaled({ w, h, className = '', innerClassName = '', style, innerStyle, children }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState<number | null>(null)

  useLayoutEffect(() => {
    const el = ref.current!
    const fit = () => setScale(el.clientWidth / w)
    fit()
    const ro = new ResizeObserver(fit)
    ro.observe(el)
    return () => ro.disconnect()
  }, [w])

  return (
    <div ref={ref} className={`scaled ${className}`} style={{ aspectRatio: `${w} / ${h}`, ...style }}>
      <div
        className={`scaled-in ${innerClassName}`}
        style={{ width: w, height: h, transform: `scale(${scale ?? 0})`, visibility: scale === null ? 'hidden' : undefined, ...innerStyle }}
      >
        {children}
      </div>
    </div>
  )
}
