import { Copy, Move, PencilLine, Pin, X } from 'lucide-react'
import { OcrIcon } from '../icons'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
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

  /** Copy text: shows "Reading…", then how many lines were copied (or that there's none). */
  const [textState, setTextState] = useState<string | null>(null)
  const copyText = async () => {
    setTextState('Reading…')
    const n = await api.pinCopyText()
    setTextState(n > 0 ? `Copied ${n} line${n === 1 ? '' : 's'}` : n === 0 ? 'No text' : "Couldn't read")
    setTimeout(() => setTextState(null), 1500)
  }

  const copy = () => {
    api.pinCopy()
    setCopied(true)
    setTimeout(() => setCopied(false), 1000)
  }

  // Tooltips like the toolbar's (.tip), kept inside this small window.
  const [tip, setTip] = useState<HTMLElement | null>(null)
  const onMouseOver = (e: React.MouseEvent) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>('[data-tip]')
    if (el !== tip) setTip(el)
  }

  return (
    <div
      className="thumb"
      onMouseOver={onMouseOver}
      onMouseLeave={() => setTip(null)}
      onPointerDown={() => setTip(null)}
      // Double-clicking the image edits it; a quick double click on a button is just two clicks.
      onDoubleClick={(e) => !(e.target as HTMLElement).closest('button') && api.thumbEdit()}
      onContextMenu={(e) => e.preventDefault()}
    >
      {/* A strip or tall capture sits in a standard 16:9 preview (shared/thumb.ts): a blurred copy fills the rest. */}
      {src && <img className="thumb-backdrop" src={src} alt="" aria-hidden draggable={false} />}
      {src && (
        <img
          className="thumb-image"
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
        {/* Labels show when they fit (styles.css); Text is an icon so all three fit a 240 px preview. */}
        <button className="thumb-btn" aria-label="Copy" data-tip={copied ? 'Copied' : 'Copy'} onClick={copy}>
          <Copy size={14} /> <span className="thumb-label">{copied ? 'Copied' : 'Copy'}</span>
        </button>
        <button className="thumb-btn" aria-label="Edit" data-tip="Edit" data-sub="Or double-click the image" onClick={() => api.thumbEdit()}>
          <PencilLine size={14} /> <span className="thumb-label">Edit</span>
        </button>
        <button className="thumb-btn thumb-btn-icon" aria-label="Capture Text (OCR)" data-tip="Capture Text (OCR)" onClick={() => void copyText()}>
          <OcrIcon size={14} />
        </button>
      </div>
      {textState && <div className="thumb-status">{textState}</div>}
      <button className="thumb-icon thumb-pin" aria-label="Pin to screen" data-tip="Pin to screen" onClick={() => api.thumbPin()}>
        <Pin size={13} />
      </button>
      <button className="thumb-icon thumb-move" aria-label="Move" data-tip="Drag to move" data-sub="Drag the image into an app to drop it" onPointerDown={move}>
        <Move size={13} />
      </button>
      <button className="thumb-icon thumb-close" aria-label="Close" data-tip="Close" data-hint="Esc" onClick={() => api.pinClose()}>
        <X size={13} />
      </button>
      {tip && tip.isConnected && <Tip el={tip} />}
    </div>
  )
}

/** Below the button, or above it when there's no room, moved in to stay inside the window. */
function Tip({ el }: { el: HTMLElement }) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)
  useLayoutEffect(() => {
    const t = ref.current
    if (!t) return
    const r = el.getBoundingClientRect()
    const GAP = 6, EDGE = 4
    const below = r.bottom + GAP + t.offsetHeight <= innerHeight - EDGE
    const top = below ? r.bottom + GAP : Math.max(EDGE, r.top - GAP - t.offsetHeight)
    const left = Math.min(Math.max(r.left + r.width / 2 - t.offsetWidth / 2, EDGE), innerWidth - EDGE - t.offsetWidth)
    setPos({ left, top })
  }, [el])
  const { tip, hint, sub } = el.dataset
  return (
    <div ref={ref} className="tip thumb-tip" style={pos ?? { visibility: 'hidden', left: 0, top: 0 }}>
      <div className="tip-row">
        {tip}
        {hint && <kbd>{hint}</kbd>}
      </div>
      {sub && <div className="tip-sub">{sub}</div>}
    </div>
  )
}
