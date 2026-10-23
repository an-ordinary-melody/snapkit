import { useCallback, useEffect, useRef, useState } from 'react'
import type { Settings } from '@shared/settings'
import { moveRect, rectFromPoints, resizeRect, type Handle, type Point, type Rect } from './layout'
import { Toolbars } from './Toolbars'

const api = window.snapkit

type Drag =
  | { kind: 'create'; origin: Point }
  | { kind: 'move'; origin: Point; start: Rect }
  | { kind: 'resize'; origin: Point; start: Rect; handle: Handle }

interface Capture {
  session: number
  width: number // image pixels
  height: number
  settings: Settings
}

const HANDLES: { id: Handle; x: number; y: number; cursor: string }[] = [
  { id: 'nw', x: 0, y: 0, cursor: 'nwse-resize' },
  { id: 'n', x: 0.5, y: 0, cursor: 'ns-resize' },
  { id: 'ne', x: 1, y: 0, cursor: 'nesw-resize' },
  { id: 'e', x: 1, y: 0.5, cursor: 'ew-resize' },
  { id: 'se', x: 1, y: 1, cursor: 'nwse-resize' },
  { id: 's', x: 0.5, y: 1, cursor: 'ns-resize' },
  { id: 'sw', x: 0, y: 1, cursor: 'nesw-resize' },
  { id: 'w', x: 0, y: 0.5, cursor: 'ew-resize' }
]

const MIN_SIZE = 4

export function Overlay() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [cap, setCap] = useState<Capture | null>(null)
  const [sel, setSel] = useState<Rect | null>(null)
  const [drag, setDrag] = useState<Drag | null>(null)
  const [screen, setScreen] = useState({ w: window.innerWidth, h: window.innerHeight })
  const busy = useRef(false)

  // ---- lifecycle from main process -------------------------------------
  useEffect(() => {
    api.onCaptureStart((p) => {
      const canvas = canvasRef.current!
      canvas.width = p.width
      canvas.height = p.height
      const ctx = canvas.getContext('2d')!
      const pixels = new Uint8ClampedArray(p.pixels.buffer as ArrayBuffer, p.pixels.byteOffset, p.pixels.byteLength)
      ctx.putImageData(new ImageData(pixels, p.width, p.height), 0, 0)
      busy.current = false
      setScreen({ w: window.innerWidth, h: window.innerHeight })
      setSel(null)
      setDrag(null)
      setCap({ session: p.session, width: p.width, height: p.height, settings: p.settings })
      setTimeout(() => api.ready(p.session), 16)
    })
    api.onClearSelection(() => {
      setSel(null)
      setDrag(null)
    })
    api.onReset(() => {
      setCap(null)
      setSel(null)
      setDrag(null)
      const c = canvasRef.current
      if (c) {
        c.width = 1 // release the screenshot's memory
        c.height = 1
      }
    })
    const onResize = () => setScreen({ w: window.innerWidth, h: window.innerHeight })
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  // ---- output -------------------------------------------------------------
  const cropToPng = useCallback(async (r: Rect): Promise<ArrayBuffer> => {
    const src = canvasRef.current!
    const scale = src.width / window.innerWidth
    const sx = Math.round(r.x * scale)
    const sy = Math.round(r.y * scale)
    const sw = Math.max(1, Math.round(r.w * scale))
    const sh = Math.max(1, Math.round(r.h * scale))
    const out = document.createElement('canvas')
    out.width = sw
    out.height = sh
    out.getContext('2d')!.drawImage(src, sx, sy, sw, sh, 0, 0, sw, sh)
    const blob = await new Promise<Blob>((res, rej) => out.toBlob((b) => (b ? res(b) : rej(new Error('encode failed'))), 'image/png'))
    return blob.arrayBuffer()
  }, [])

  const runAction = useCallback(
    async (id: string) => {
      if (!cap || busy.current) return
      if (id === 'close') return api.cancel(cap.session)
      if (!sel) return
      if (id === 'copy' || id === 'save') {
        busy.current = true
        const png = await cropToPng(sel)
        if (id === 'copy') api.copy(cap.session, png)
        else api.save(cap.session, png)
      }
    },
    [cap, sel, cropToPng]
  )

  // ---- keyboard -------------------------------------------------------------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!cap) return
      const mod = e.metaKey || e.ctrlKey
      const key = e.key.toLowerCase()
      if (e.key === 'Escape') {
        e.preventDefault()
        api.cancel(cap.session)
      } else if (mod && key === 'c') {
        e.preventDefault()
        void runAction('copy')
      } else if (mod && key === 's') {
        e.preventDefault()
        void runAction('save')
      } else if (e.key === 'Enter') {
        e.preventDefault()
        void runAction('copy')
      } else if (sel && e.key.startsWith('Arrow')) {
        // Arrows nudge the selection; Shift = 10px; Alt = resize instead of move.
        e.preventDefault()
        const step = e.shiftKey ? 10 : 1
        const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0
        const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0
        setSel(e.altKey ? resizeRect(sel, 'se', dx, dy, screen) : moveRect(sel, dx, dy, screen))
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [cap, sel, screen, runAction])

  // ---- mouse ----------------------------------------------------------------
  const point = (e: React.PointerEvent): Point => ({ x: e.clientX, y: e.clientY })
  const inside = (p: Point, r: Rect) => p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h

  const onPointerDown = (e: React.PointerEvent) => {
    if (!cap || e.button !== 0) return
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    const p = point(e)
    const handle = (e.target as HTMLElement).dataset.handle as Handle | undefined
    if (sel && handle) setDrag({ kind: 'resize', origin: p, start: sel, handle })
    else if (sel && inside(p, sel)) setDrag({ kind: 'move', origin: p, start: sel })
    else {
      setDrag({ kind: 'create', origin: p })
      setSel({ x: p.x, y: p.y, w: 0, h: 0 })
      api.selectionStarted(cap.session)
    }
  }

  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag) return
    const p = point(e)
    const dx = p.x - drag.origin.x
    const dy = p.y - drag.origin.y
    if (drag.kind === 'create') setSel(rectFromPoints(drag.origin, p, screen))
    else if (drag.kind === 'move') setSel(moveRect(drag.start, dx, dy, screen))
    else setSel(resizeRect(drag.start, drag.handle, dx, dy, screen))
  }

  const onPointerUp = () => {
    if (drag?.kind === 'create' && sel && (sel.w < MIN_SIZE || sel.h < MIN_SIZE)) setSel(null)
    setDrag(null)
  }

  const onContextMenu = (e: React.MouseEvent) => {
    e.preventDefault()
    if (cap) api.cancel(cap.session)
  }

  // ---- render ---------------------------------------------------------------
  const s = cap?.settings
  const dim = `rgba(0,0,0,${s?.capture.dimOpacity ?? 0.45})`
  const accent = s?.capture.accentColor ?? '#3b82f6'
  const scale = cap ? cap.width / screen.w : 1
  const showToolbars = cap && sel && !drag && sel.w >= MIN_SIZE && sel.h >= MIN_SIZE

  let cursor = 'crosshair'
  if (drag?.kind === 'move') cursor = 'move'

  return (
    <div
      className="overlay"
      style={{ cursor }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onContextMenu={onContextMenu}
    >
      <canvas ref={canvasRef} className="frozen" width={1} height={1} />

      {cap && !sel && <div className="dim-full" style={{ background: dim }} />}

      {cap && sel && (
        <div
          className="selection"
          style={{
            left: sel.x,
            top: sel.y,
            width: sel.w,
            height: sel.h,
            boxShadow: `0 0 0 1px ${accent}, 0 0 0 99999px ${dim}`,
            cursor: 'move',
            pointerEvents: drag ? 'none' : 'auto'
          }}
        >
          {!drag &&
            HANDLES.map((h) => (
              <div
                key={h.id}
                data-handle={h.id}
                className="handle"
                style={{ left: `${h.x * 100}%`, top: `${h.y * 100}%`, cursor: h.cursor }}
              />
            ))}
        </div>
      )}

      {cap && sel && s?.capture.showSizeLabel && (
        <div className="size-label" style={{ left: sel.x, top: sel.y >= 26 ? sel.y - 24 : sel.y + 6 }}>
          {Math.round(sel.w * scale)} × {Math.round(sel.h * scale)}
        </div>
      )}

      {showToolbars && <Toolbars selection={sel} screen={screen} settings={cap.settings} onAction={(id) => void runAction(id)} />}
    </div>
  )
}
