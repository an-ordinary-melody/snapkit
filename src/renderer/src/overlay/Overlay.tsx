import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { FEATURES } from '@shared/features'
import { visibleFeatures, type Settings } from '@shared/settings'
import { AnnotationLayer, handledEvents, type AnnotationLayerHandle } from './annotate/AnnotationLayer'
import { commit, emptyHistory, moveShape, redo, remove, undo, upsert, type History, type Shape, type Style, type ToolId } from './annotate/model'
import { hasStyleOptions, StyleBar, type StyleTarget } from './annotate/StyleBar'
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

const DRAWING_TOOLS = new Set(FEATURES.filter((f) => f.drawing).map((f) => f.id))

/** Style choices survive between captures (until Snapkit quits). */
let lastStyle: Style | null = null

function initialStyle(s: Settings): Style {
  const a = s.annotate
  return {
    color: a.palette[0] ?? '#ef4444',
    widthIndex: a.strokeWidth,
    blurMode: a.blurMode,
    fontSize: a.text.fontSize,
    fontFamily: a.text.fontFamily,
    shadow: a.text.shadow,
    textBackground: a.text.background
  }
}

/** The parts of `patch` that apply to an existing shape. */
function restyle(s: Shape, patch: Partial<Style>, widths: number[]): Shape {
  switch (s.type) {
    case 'pen':
    case 'line':
    case 'arrow':
    case 'rect':
    case 'ellipse':
      return { ...s, color: patch.color ?? s.color, width: patch.widthIndex !== undefined ? widths[patch.widthIndex] : s.width }
    case 'step':
      return { ...s, color: patch.color ?? s.color }
    case 'text':
      return {
        ...s,
        color: patch.color ?? s.color,
        fontSize: patch.fontSize ?? s.fontSize,
        shadow: patch.shadow ?? s.shadow,
        background: patch.textBackground ?? s.background
      }
    case 'blur':
      return { ...s, mode: patch.blurMode ?? s.mode }
    default:
      return s
  }
}

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((r) => (resolve = r))
  return { promise, resolve }
}

export function Overlay() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [cap, setCap] = useState<Capture | null>(null)
  const [sel, setSel] = useState<Rect | null>(null)
  const [drag, setDrag] = useState<Drag | null>(null)
  const [screen, setScreen] = useState({ w: window.innerWidth, h: window.innerHeight })
  const busy = useRef(false)
  const painted = useRef(deferred())

  // Annotations
  const annRef = useRef<AnnotationLayerHandle>(null)
  const [history, setHistory] = useState<History>(emptyHistory)
  const shapes = history.present
  const [tool, setTool] = useState<ToolId | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [style, setStyle] = useState<Style | null>(null)
  const [styleOpen, setStyleOpen] = useState(true)
  const onCommit = useCallback((next: Shape[]) => setHistory((h) => commit(h, next)), [])
  const source = useCallback(() => canvasRef.current, [])

  // ---- lifecycle from main process -------------------------------------
  useEffect(() => {
    api.onArm((p) => {
      busy.current = false
      painted.current = deferred()
      // Commit the dim to the DOM before telling main to show the window.
      flushSync(() => {
        setScreen({ w: window.innerWidth, h: window.innerHeight })
        setSel(null)
        setDrag(null)
        setCap({ session: p.session, width: p.width, height: p.height, settings: p.settings })
        setHistory(emptyHistory())
        setTool(null)
        setSelectedId(null)
        setStyle(lastStyle ?? initialStyle(p.settings))
      })
      api.armed(p.session)
    })
    api.onPixels((p) => {
      const canvas = canvasRef.current!
      canvas.width = p.width
      canvas.height = p.height
      const pixels = new Uint8ClampedArray(p.pixels.buffer as ArrayBuffer, p.pixels.byteOffset, p.pixels.byteLength)
      canvas.getContext('2d')!.putImageData(new ImageData(pixels, p.width, p.height), 0, 0)
      painted.current.resolve()
      requestAnimationFrame(() => api.painted(p.session))
    })
    api.onClearSelection(() => {
      setSel(null)
      setDrag(null)
    })
    api.onReset(() => {
      setCap(null)
      setSel(null)
      setDrag(null)
      setHistory(emptyHistory())
      setTool(null)
      setSelectedId(null)
      const c = canvasRef.current
      if (c) {
        c.width = 1 // release the screenshot's memory (and leave a transparent frame)
        c.height = 1
      }
      requestAnimationFrame(() => requestAnimationFrame(() => api.cleared()))
    })
    const onResize = () => setScreen({ w: window.innerWidth, h: window.innerHeight })
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  // ---- output -------------------------------------------------------------
  const cropToPng = useCallback(async (r: Rect): Promise<ArrayBuffer> => {
    await painted.current.promise // the frozen image may still be arriving
    const src = canvasRef.current!
    const scale = src.width / window.innerWidth
    const sx = Math.round(r.x * scale)
    const sy = Math.round(r.y * scale)
    const sw = Math.max(1, Math.round(r.w * scale))
    const sh = Math.max(1, Math.round(r.h * scale))
    const out = document.createElement('canvas')
    out.width = sw
    out.height = sh
    const ctx = out.getContext('2d')!
    ctx.drawImage(src, sx, sy, sw, sh, 0, 0, sw, sh)
    const ann = annRef.current?.exportCanvas(scale)
    if (ann) ctx.drawImage(ann, 0, 0, sw, sh)
    const blob = await new Promise<Blob>((res, rej) => out.toBlob((b) => (b ? res(b) : rej(new Error('encode failed'))), 'image/png'))
    return blob.arrayBuffer()
  }, [])

  const runAction = useCallback(
    async (id: string) => {
      if (!cap || busy.current) return
      if (id === 'close') return api.cancel(cap.session)
      if (DRAWING_TOOLS.has(id)) {
        annRef.current?.finishEditing()
        setSelectedId(null)
        setTool((t) => (t === id ? null : (id as ToolId)))
        return
      }
      if (id === 'color') return setStyleOpen((o) => !o)
      if (id === 'undo' || id === 'redo') {
        annRef.current?.finishEditing()
        setSelectedId(null)
        setHistory((h) => (id === 'undo' ? undo(h) : redo(h)))
        return
      }
      if (!sel) return
      if (id === 'copy' || id === 'save') {
        busy.current = true
        flushSync(() => setSelectedId(null))
        const png = await cropToPng(sel)
        if (id === 'copy') api.copy(cap.session, png)
        else api.save(cap.session, png)
      }
    },
    [cap, sel, cropToPng]
  )

  /** Letter -> drawing tool, for the tools that are switched on. */
  const toolKeys = useMemo(() => {
    const m = new Map<string, string>()
    if (cap) for (const f of visibleFeatures(cap.settings, 'tool')) if (f.drawing && f.hint) m.set(f.hint.toLowerCase(), f.id)
    return m
  }, [cap])

  // ---- keyboard -------------------------------------------------------------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!cap || e.target instanceof HTMLTextAreaElement) return
      const mod = e.metaKey || e.ctrlKey
      const key = e.key.toLowerCase()
      const selectedShape = shapes.find((x) => x.id === selectedId)
      if (e.key === 'Escape') {
        e.preventDefault()
        if (selectedShape) setSelectedId(null)
        else api.cancel(cap.session)
      } else if (mod && key === 'z') {
        e.preventDefault()
        void runAction(e.shiftKey ? 'redo' : 'undo')
      } else if (mod && key === 'y') {
        e.preventDefault()
        void runAction('redo')
      } else if (selectedShape && (e.key === 'Backspace' || e.key === 'Delete')) {
        e.preventDefault()
        onCommit(remove(shapes, selectedShape.id))
        setSelectedId(null)
      } else if (selectedShape && e.key.startsWith('Arrow')) {
        e.preventDefault()
        const step = e.shiftKey ? 10 : 1
        const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0
        const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0
        onCommit(upsert(shapes, moveShape(selectedShape, dx, dy)))
      } else if (!mod && !e.altKey && sel && toolKeys.has(key)) {
        e.preventDefault()
        void runAction(toolKeys.get(key)!)
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
  }, [cap, sel, screen, runAction, shapes, selectedId, toolKeys, onCommit])

  // ---- mouse ----------------------------------------------------------------
  const point = (e: React.PointerEvent): Point => ({ x: e.clientX, y: e.clientY })
  const inside = (p: Point, r: Rect) => p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h

  const onPointerDown = (e: React.PointerEvent) => {
    if (!cap || e.button !== 0 || handledEvents.has(e.nativeEvent)) return
    const p = point(e)
    const handle = (e.target as HTMLElement).dataset.handle as Handle | undefined
    // Once something is drawn, a click outside keeps the selection (and the drawing).
    if (sel && !handle && !inside(p, sel) && shapes.length) return
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    setSelectedId(null)
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

  const onStyleChange = useCallback(
    (patch: Partial<Style>) => {
      if (!style || !cap) return
      const next = { ...style, ...patch }
      setStyle(next)
      lastStyle = next
      const target = shapes.find((x) => x.id === selectedId)
      if (target) onCommit(upsert(shapes, restyle(target, patch, cap.settings.annotate.strokeWidths)))
    },
    [style, cap, shapes, selectedId, onCommit]
  )

  // ---- render ---------------------------------------------------------------
  const s = cap?.settings
  const dim = `rgba(0,0,0,${s?.capture.dimOpacity ?? 0.45})`
  const accent = s?.capture.accentColor ?? '#3b82f6'
  const scale = cap ? cap.width / screen.w : 1
  const hasSel = !!(cap && sel && sel.w >= MIN_SIZE && sel.h >= MIN_SIZE)
  const showToolbars = hasSel && !drag

  const selectedShape = shapes.find((x) => x.id === selectedId)
  const styleTarget: StyleTarget | null = selectedShape?.type ?? tool
  const styleBar =
    cap && style && styleOpen && styleTarget && hasStyleOptions(styleTarget) && s?.features.color !== false ? (
      <StyleBar target={styleTarget} style={style} palette={cap.settings.annotate.palette} onChange={onStyleChange} />
    ) : null
  const unavailable = new Set<string>()
  if (!history.past.length) unavailable.add('undo')
  if (!history.future.length) unavailable.add('redo')
  const pressed = new Set<string>(styleOpen ? ['color'] : [])

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
          style={{ left: sel.x, top: sel.y, width: sel.w, height: sel.h, boxShadow: `0 0 0 1px ${accent}, 0 0 0 99999px ${dim}` }}
        />
      )}

      {hasSel && sel && style && cap && (
        <AnnotationLayer
          ref={annRef}
          sel={sel}
          shapes={shapes}
          tool={tool}
          style={style}
          strokeWidths={cap.settings.annotate.strokeWidths}
          highlighter={{ color: cap.settings.annotate.highlighterColor, width: cap.settings.annotate.highlighterWidth }}
          stepSize={cap.settings.annotate.stepSize}
          selectedId={selectedId}
          onSelect={setSelectedId}
          onCommit={onCommit}
          source={source}
          scale={scale}
        />
      )}

      {cap && sel && !drag && (
        <div className="handles" style={{ left: sel.x, top: sel.y, width: sel.w, height: sel.h }}>
          {HANDLES.map((h) => (
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

      {showToolbars && sel && cap && style && (
        <Toolbars
          selection={sel}
          screen={screen}
          settings={cap.settings}
          activeTool={tool}
          color={style.color}
          pressed={pressed}
          unavailable={unavailable}
          styleBar={styleBar}
          onAction={(id) => void runAction(id)}
        />
      )}
    </div>
  )
}
