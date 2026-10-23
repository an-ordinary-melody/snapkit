import { Copy, PencilLine, Pin, X } from 'lucide-react'
import { useEffect, useState } from 'react'

const api = window.snapkit

/**
 * Floating preview left in the corner after a copy. Drag it into another app;
 * hover for copy / edit / pin / close; double-click to edit.
 */
export function Thumb() {
  const [src, setSrc] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    api.onPinImage(({ png }) =>
      setSrc((old) => {
        if (old) URL.revokeObjectURL(old)
        return URL.createObjectURL(new Blob([png as BlobPart], { type: 'image/png' }))
      })
    )
    api.pinReady()
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && api.pinClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

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
      <button className="thumb-icon thumb-pin" aria-label="Pin to screen" title="Pin to screen (full size, always on top)" onClick={() => api.thumbPin()}>
        <Pin size={13} />
      </button>
      <button className="thumb-icon thumb-close" aria-label="Close" title="Close (Esc)" onClick={() => api.pinClose()}>
        <X size={13} />
      </button>
    </div>
  )
}
