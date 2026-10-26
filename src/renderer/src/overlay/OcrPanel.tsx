import { X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { OcrLine } from '@shared/ipc'
import type { Rect, Size } from './layout'

const PANEL_W = 300
const PANEL_H = 200

/** Outlines over the lines of text found in the selection. */
export function OcrHighlights({ lines, sel }: { lines: OcrLine[]; sel: Rect }) {
  return (
    <>
      {lines.map((l, i) => (
        <div key={i} className="ocr-hit" style={{ left: sel.x + l.x * sel.w - 2, top: sel.y + l.y * sel.h - 1, width: l.w * sel.w + 4, height: l.h * sel.h + 2 }} />
      ))}
    </>
  )
}

/** Where the panel fits: right of the selection, else left of it, else below it, kept on screen. */
function placePanel(sel: Rect, screen: Size) {
  const gap = 10
  let x = sel.x + sel.w + gap
  if (x + PANEL_W > screen.w - 8) x = sel.x - gap - PANEL_W
  let y = sel.y
  if (x < 8) {
    x = sel.x
    y = sel.y + sel.h + gap
  }
  return { left: Math.max(8, Math.min(x, screen.w - PANEL_W - 8)), top: Math.max(8, Math.min(y, screen.h - PANEL_H - 8)) }
}

/** The recognized text, editable, to check before copying. */
export function OcrPanel(props: { lines: OcrLine[]; ms: number; sel: Rect; screen: Size; onCopy(text: string): void; onClose(): void }) {
  const { lines, ms, sel, screen, onCopy, onClose } = props
  const [text, setText] = useState(() => lines.map((l) => l.text).join('\n'))
  const ref = useRef<HTMLTextAreaElement>(null)
  useEffect(() => ref.current?.focus(), [])
  const count = text.trim() ? text.trim().split('\n').length : 0
  return (
    <div className="ocr-panel" style={{ ...placePanel(sel, screen), width: PANEL_W, height: PANEL_H }} onPointerDown={(e) => e.stopPropagation()}>
      <div className="ocr-head">
        <span>
          {count} line{count === 1 ? '' : 's'} · {(ms / 1000).toFixed(1)} s
        </span>
        <button title="Close (Esc)" aria-label="Close" onClick={onClose}>
          <X size={14} />
        </button>
      </div>
      <textarea
        ref={ref}
        value={text}
        spellCheck={false}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault()
            onClose()
          } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault()
            onCopy(text)
          }
        }}
      />
      <div className="ocr-actions">
        <button title="Join the lines into one" onClick={() => setText((t) => t.split('\n').map((l) => l.trim()).filter(Boolean).join(' '))}>
          One line
        </button>
        <button className="primary" title="Copy text (⌘↩)" onClick={() => onCopy(text)}>
          Copy text
        </button>
      </div>
    </div>
  )
}
