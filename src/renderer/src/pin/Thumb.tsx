import { Copy, Move, PencilLine, Pin, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { applyTheme } from '../theme'

const api = window.snapkit

/**
 * Floating preview left in the corner after a copy. Drag the image into
 * another app; drag the move handle to move the preview; hover for copy /
 * edit / pin / close; double-click to edit.
 */
export function Thumb() {
  const [src, setSrc] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    api.onPinImage(({ png, appearance }) =>
      setSrc((old) => {
        applyTheme(appearance)
        if (old) URL.revokeObjectURL(old)
        return URL.createObjectURL(new Blob([png as BlobPart], { type: 'image/png' }))
      })
    )
    api.pinReady()
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && api.pinClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // The move handle moves the window; dragging the image itself drops it into other apps.
  const move = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()
    const el = e.currentTarget
    el.setPointerCapture(e.pointerId)
    let last = { x: e.screenX, y: e.screenY }
    const onMove = (ev: PointerEvent) => {
      api.pinMoveBy(ev.screenX - last.x, ev.screenY - last.y)
      last = { x: ev.screenX, y: ev.screenY }
    }
    const onUp = () => {
      el.removeEventListener('pointermove', onMove)
      el.removeEventListener('pointerup', onUp)
    }
    el.addEventListener('pointermove', onMove)
    el.addEventListener('pointerup', onUp)
  }

  const copy = () => {
    api.pinCopy()
    setCopied(true)
    setTimeout(() => setCopied(false), 1000)
  }

  return (
    <div className="thumb" onDoubleClick={() => api.thumbEdit()} onContextMenu={(e) => e.preventDefault()}>
      {src && (
        <img
          src={src}
          alt="Last capture"
          draggable
          onDragStart={(e) => {
            e.preventDefault()
            api.pinDragOut()
          }}
        />
      )}
      <div className="thumb-actions">
        <button className="thumb-btn" onClick={copy}>
          <Copy size={14} /> {copied ? 'Copied' : 'Copy'}
        </button>
        <button className="thumb-btn" onClick={() => api.thumbEdit()}>
          <PencilLine size={14} /> Edit
        </button>
      </div>
      <button className="thumb-icon thumb-pin" aria-label="Pin to screen" title="Pin to screen" onClick={() => api.thumbPin()}>
        <Pin size={13} />
      </button>
      <button className="thumb-icon thumb-move" aria-label="Move" title="Drag to move. Drag the image into an app to drop it." onPointerDown={move}>
        <Move size={13} />
      </button>
      <button className="thumb-icon thumb-close" aria-label="Close" title="Close (Esc)" onClick={() => api.pinClose()}>
        <X size={13} />
      </button>
    </div>
  )
}
