import { Copy, GripVertical, Minus, Plus, Save, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { PinState } from '@shared/ipc'
import { Slider } from '../overlay/Slider'

const api = window.snapkit

/**
 * A pinned screenshot. Drag to move, scroll to zoom, ⌥+scroll for opacity,
 * ⌥+drag (or the grip) to drag the image into another app, right-click for
 * the menu, Esc to close.
 */
export function Pin() {
  const [src, setSrc] = useState<string | null>(null)
  const [state, setState] = useState<PinState>({ zoom: 1, opacity: 1 })
  const [hud, setHud] = useState<string | null>(null)
  const [alt, setAlt] = useState(false)
  const stateRef = useRef(state)
  stateRef.current = state
  const hudTimer = useRef<number>()

  useEffect(() => {
    api.onPinImage(({ png }) => setSrc(URL.createObjectURL(new Blob([png as BlobPart], { type: 'image/png' }))))
    api.onPinState(setState)
    api.pinReady()
  }, [])

  const flash = (text: string) => {
    setHud(text)
    clearTimeout(hudTimer.current)
    hudTimer.current = window.setTimeout(() => setHud(null), 900)
  }
  const zoomTo = (z: number, ax = 0.5, ay = 0.5) => {
    api.pinZoom(z, ax, ay)
    flash(`${Math.round(Math.min(5, Math.max(0.1, z)) * 100)}%`)
  }
  const opacityTo = (o: number) => {
    api.pinOpacity(o)
    flash(`Opacity ${Math.round(Math.min(1, Math.max(0.15, o)) * 100)}%`)
  }

  // Keyboard: Esc closes, ⌘C / ⌘S, ⌘+ / ⌘- / ⌘0 zoom. ⌥ held = drag out instead of move.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      setAlt(e.altKey)
      if (e.type !== 'keydown') return
      const mod = e.metaKey || e.ctrlKey
      const z = stateRef.current.zoom
      if (e.key === 'Escape') api.pinClose()
      else if (mod && e.key.toLowerCase() === 'c') api.pinCopy()
      else if (mod && e.key.toLowerCase() === 's') api.pinSave()
      else if (mod && (e.key === '=' || e.key === '+')) zoomTo(z * 1.25)
      else if (mod && e.key === '-') zoomTo(z / 1.25)
      else if (mod && e.key === '0') zoomTo(1)
      else return
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('keyup', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('keyup', onKey)
    }
  }, [])

  const onWheel = (e: React.WheelEvent) => {
    const { zoom, opacity } = stateRef.current
    const step = Math.exp(-e.deltaY * 0.0025)
    if (e.altKey) opacityTo(opacity * step)
    else zoomTo(zoom * step, e.clientX / window.innerWidth, e.clientY / window.innerHeight)
  }

  // Drag anywhere to move the pin (⌥ held: drag the image out instead).
  const onPointerDown = (e: React.PointerEvent) => {
    setAlt(e.altKey)
    if (e.button !== 0 || e.altKey || (e.target as HTMLElement).closest('.pin-bar, .pin-close')) return
    e.preventDefault()
    const el = e.currentTarget as HTMLElement
    el.setPointerCapture(e.pointerId)
    let last = { x: e.screenX, y: e.screenY }
    const move = (ev: PointerEvent) => {
      const dx = ev.screenX - last.x
      const dy = ev.screenY - last.y
      if (!dx && !dy) return
      last = { x: ev.screenX, y: ev.screenY }
      api.pinMoveBy(dx, dy)
    }
    const up = () => {
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
    }
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
  }

  const dragOut = (e: React.DragEvent) => {
    e.preventDefault()
    api.pinDragOut()
  }

  return (
    <div
      className={`pin${alt ? ' alt' : ''}`}
      onPointerDown={onPointerDown}
      onWheel={onWheel}
      onMouseMove={(e) => setAlt(e.altKey)}
      onContextMenu={(e) => {
        e.preventDefault()
        api.pinMenu()
      }}
    >
      {src && <img src={src} alt="Pinned screenshot" draggable={alt} onDragStart={dragOut} />}
      {hud && <div className="pin-hud">{hud}</div>}
      <button className="pin-close" aria-label="Close pin" title="Close (Esc)" onClick={() => api.pinClose()}>
        <X size={13} />
      </button>
      <div className="pin-bar">
        <div className="pin-grip" draggable onDragStart={dragOut} title="Drag into another app (or ⌥-drag the image)">
          <GripVertical size={15} />
        </div>
        <button aria-label="Zoom out" title="Zoom out (scroll)" onClick={() => zoomTo(state.zoom / 1.25)}>
          <Minus size={14} />
        </button>
        <button className="pin-zoom" title="Reset to 100%" onClick={() => zoomTo(1)}>
          {Math.round(state.zoom * 100)}%
        </button>
        <button aria-label="Zoom in" title="Zoom in (scroll)" onClick={() => zoomTo(state.zoom * 1.25)}>
          <Plus size={14} />
        </button>
        <span className="pin-sep" />
        <span className="pin-opacity" title="Opacity (⌥ + scroll)">
          <Slider label="Opacity" min={15} max={100} value={Math.round(state.opacity * 100)} onChange={(v) => opacityTo(v / 100)} />
        </span>
        <span className="pin-sep" />
        <button aria-label="Copy" title="Copy (⌘C)" onClick={() => api.pinCopy()}>
          <Copy size={14} />
        </button>
        <button aria-label="Save" title="Save (⌘S)" onClick={() => api.pinSave()}>
          <Save size={14} />
        </button>
      </div>
    </div>
  )
}
