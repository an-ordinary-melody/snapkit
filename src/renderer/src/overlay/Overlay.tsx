import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { FEATURES } from '@shared/features'
import type { CaptureDoc } from '@shared/ipc'
import { visibleFeatures, type Settings } from '@shared/settings'
import { AnnotationLayer, handledEvents, type AnnotationLayerHandle } from './annotate/AnnotationLayer'
import { commit, emptyHistory, moveShape, redo, remove, undo, upsert, type History, type Shape, type Style, type ToolId } from './annotate/model'
import { hasStyleOptions, StyleBar, type StyleTarget } from './annotate/StyleBar'
import { BackgroundEditor } from './beautify/BackgroundEditor'
import { backgroundOf, stateFromPreset, type BeautifyState } from './beautify/layout'
import { renderBeautified } from './beautify/render'
import { moveRect, rectFromPoints, resizeRect, type Handle, type Point, type Rect } from './layout'
import { applyTheme } from '../theme'
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
  /** Image px per overlay px. */
  scale: number
  settings: Settings
  /** Editing a floating preview or a history entry: the editor is all there is. */
  edit: boolean
  /** Editing a history entry: outputs update it. */
  historyId?: string
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

/** Style and tool variant choices survive between captures (until Snapkit quits). */
let lastStyle: Style | null = null
let lastVariants: Record<string, string> = {}
/** Beautify preset and tweaks; whether it's on resets to the setting each capture. */
let lastBeautify: BeautifyState | null = null
/** Settings the remembered picks above were made under; when they change, the picks reset. */
let lastDefaults = ''

function initialBeautify(s: Settings): BeautifyState {
  const presets = s.beautify.presets
  const on = s.beautify.applyOnCopy
  if (lastBeautify && presets.some((p) => p.id === lastBeautify!.presetId)) return { ...lastBeautify, on }
  const preset = presets.find((p) => p.id === s.beautify.preset) ?? presets[0]
  return preset ? stateFromPreset(preset, on) : { on: false, presetId: '', padding: 0, radius: 0, shadow: 0 }
}

function initialStyle(s: Settings): Style {
  const a = s.annotate
  return {
    color: a.palette[0] ?? '#ef4444',
    textColor: a.palette[0] ?? '#ef4444',
    highlighterColor: a.highlighterColor,
    stepColor: a.stepColor,
    widthIndex: a.strokeWidth,
    blurMode: a.blurMode,
    blurStrength: a.blurStrength,
    fontSize: a.text.fontSize,
    fontFamily: a.text.fontFamily,
    shadow: a.text.shadow,
    textBackground: a.text.style === 'background' ? a.text.background : '',
    textStroke: a.text.style === 'stroke' ? a.text.strokeColor : '',
    textStrokeColor: a.text.strokeColor,
    textBgColor: a.text.background || '#ffffff',
    textStrokeWidth: a.text.strokeWidth
  }
}

/** What the style bar shows for a selected shape: its own values over the current style. */
function styleOf(s: Shape, base: Style, widths: number[]): Style {
  const widthIndex = (w: number) => widths.reduce((best, v, i) => (Math.abs(v - w) < Math.abs(widths[best] - w) ? i : best), 0)
  switch (s.type) {
    case 'pen':
    case 'line':
    case 'arrow':
    case 'rect':
    case 'ellipse':
      return { ...base, color: s.color, widthIndex: widthIndex(s.width) }
    case 'highlighter':
      return { ...base, highlighterColor: s.color }
    case 'step':
      return { ...base, stepColor: s.color }
    case 'text':
      return { ...base, textColor: s.color, fontSize: s.fontSize, textBackground: s.background, textStroke: s.stroke ?? '', shadow: Number(s.shadow) }
    case 'blur':
      return { ...base, blurMode: s.mode, blurStrength: s.strength ?? base.blurStrength }
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
      return { ...s, color: patch.stepColor ?? s.color }
    case 'highlighter':
      return { ...s, color: patch.highlighterColor ?? s.color }
    case 'text':
      return {
        ...s,
        color: patch.textColor ?? s.color,
        fontSize: patch.fontSize ?? s.fontSize,
        shadow: patch.shadow ?? s.shadow,
        background: patch.textBackground ?? s.background,
        stroke: patch.textStroke ?? s.stroke
      }
    case 'blur':
      return { ...s, mode: patch.blurMode ?? s.mode, strength: patch.blurStrength ?? s.strength }
    default:
      return s
  }
}

function toBlob(canvas: HTMLCanvasElement, type: string, quality?: number) {
  return new Promise<Blob>((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('encode failed'))), type, quality))
}

/** A copy at most 320 px wide (or 240 px tall) for the history panel. */
function thumbnail(src: HTMLCanvasElement) {
  const k = Math.min(1, 320 / src.width, 240 / src.height)
  const c = document.createElement('canvas')
  c.width = Math.max(1, Math.round(src.width * k))
  c.height = Math.max(1, Math.round(src.height * k))
  const ctx = c.getContext('2d')!
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(src, 0, 0, c.width, c.height)
  return c
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
  /** Bumped by the color button: the style bar opens its color picker. */
  const [pickerRequest, setPickerRequest] = useState(0)
  const [variants, setVariants] = useState<Record<string, string>>(lastVariants)
  const [beautify, setBeautify] = useState<BeautifyState | null>(null)
  const [editorOpen, setEditorOpen] = useState(false)
  /** Floating preview after copy, for this capture (the pin button). */
  const [floating, setFloating] = useState(false)
  const capRef = useRef(cap)
  capRef.current = cap
  /** Bumped when the frozen image is painted, so anything built from it redraws. */
  const [paintedVersion, setPaintedVersion] = useState(0)
  const beautifyRef = useRef(beautify)
  beautifyRef.current = beautify
  const historyRef = useRef(history)
  historyRef.current = history
  const onCommit = useCallback((next: Shape[], mergeKey?: string) => setHistory((h) => commit(h, next, mergeKey)), [])
  const source = useCallback(() => canvasRef.current, [])

  // ---- lifecycle from main process -------------------------------------
  useEffect(() => {
    api.onArm((p) => {
      busy.current = false
      painted.current = deferred()
      // Commit the dim to the DOM before telling main to show the window.
      applyTheme(p.settings.appearance)
      const defaults = JSON.stringify([p.settings.annotate, p.settings.beautify, p.settings.toolVariants])
      if (defaults !== lastDefaults) {
        // New defaults from the settings window win over this session's picks.
        lastDefaults = defaults
        lastStyle = null
        lastBeautify = null
        lastVariants = {}
      }
      const doc = p.edit
      const scale = doc ? doc.scale : p.width / window.innerWidth
      flushSync(() => {
        setScreen({ w: window.innerWidth, h: window.innerHeight })
        // Editing: the stored crop becomes the whole "screen", selected.
        setSel(doc ? { x: 0, y: 0, w: doc.width / scale, h: doc.height / scale } : null)
        setDrag(null)
        setCap({ session: p.session, width: p.width, height: p.height, scale, settings: p.settings, edit: !!doc, historyId: doc?.historyId })
        setHistory(doc ? { past: [], present: doc.shapes as Shape[], future: [] } : emptyHistory())
        setTool(null)
        setSelectedId(null)
        setStyle(lastStyle ?? initialStyle(p.settings))
        setBeautify(doc ? (doc.beautify as BeautifyState) : initialBeautify(p.settings))
        setFloating(doc ? true : p.settings.pin.afterCopy)
        // Default shape/arrow styles from settings; picks made this session win.
        setVariants({ ...p.settings.toolVariants, ...lastVariants })
        setEditorOpen(!!doc)
      })
      if (doc) {
        // No pixels step: paint the stored crop ourselves.
        void createImageBitmap(new Blob([doc.png as BlobPart], { type: 'image/png' })).then((bmp) => {
          const canvas = canvasRef.current!
          canvas.width = bmp.width
          canvas.height = bmp.height
          canvas.getContext('2d')!.drawImage(bmp, 0, 0)
          bmp.close()
          painted.current.resolve()
          setPaintedVersion((v) => v + 1)
        })
      }
      api.armed(p.session)
    })
    api.onPixels((p) => {
      const canvas = canvasRef.current!
      canvas.width = p.width
      canvas.height = p.height
      const pixels = new Uint8ClampedArray(p.pixels.buffer as ArrayBuffer, p.pixels.byteOffset, p.pixels.byteLength)
      canvas.getContext('2d')!.putImageData(new ImageData(pixels, p.width, p.height), 0, 0)
      painted.current.resolve()
      setPaintedVersion((v) => v + 1)
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
      setEditorOpen(false)
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
  /** The selection with its annotations, at `scale` image px per screen px. */
  const composeSelection = useCallback((r: Rect, scale: number, withAnnotations = true): HTMLCanvasElement => {
    const src = canvasRef.current!
    const srcScale = capRef.current?.scale ?? src.width / window.innerWidth
    const out = document.createElement('canvas')
    out.width = Math.max(1, Math.round(r.w * scale))
    out.height = Math.max(1, Math.round(r.h * scale))
    const ctx = out.getContext('2d')!
    ctx.drawImage(src, r.x * srcScale, r.y * srcScale, r.w * srcScale, r.h * srcScale, 0, 0, out.width, out.height)
    const ann = withAnnotations && annRef.current?.exportCanvas(scale)
    if (ann) ctx.drawImage(ann, 0, 0, out.width, out.height)
    return out
  }, [])

  /** The capture as a reopenable document: plain crop + drawings (relative to it) + background. */
  /**
   * Everything needed to reopen this capture later, taken synchronously (the
   * session's canvas is cleared soon after an output); encoding happens later.
   */
  const snapshotDoc = useCallback(
    (r: Rect) => ({
      plain: composeSelection(r, capRef.current!.scale, false),
      scale: capRef.current!.scale,
      shapes: historyRef.current.present.map((sh) => moveShape(sh, -r.x, -r.y)),
      beautify: beautifyRef.current,
      historyId: capRef.current!.historyId
    }),
    [composeSelection]
  )
  const encodeDoc = async (snap: ReturnType<typeof snapshotDoc>): Promise<CaptureDoc> => ({
    png: new Uint8Array(await (await toBlob(snap.plain, 'image/png')).arrayBuffer()),
    width: snap.plain.width,
    height: snap.plain.height,
    scale: snap.scale,
    shapes: snap.shapes,
    beautify: snap.beautify,
    historyId: snap.historyId
  })

  /** The output (drawings and background baked in) as a canvas and PNG. */
  const renderOutput = useCallback(
    async (r: Rect): Promise<{ canvas: HTMLCanvasElement; png: ArrayBuffer }> => {
      await painted.current.promise // the frozen image may still be arriving
      const scale = cap!.scale
      let out = composeSelection(r, scale)
      const b = beautifyRef.current
      const bg = b?.on && cap ? backgroundOf(b, cap.settings.beautify.presets) : null
      if (b && bg) {
        out = await renderBeautified(out, bg, b, scale)
        // "Remember the last background used": this one becomes the default.
        const set = cap!.settings.beautify
        if (set.rememberLast) {
          const look = { background: bg, padding: b.padding, radius: b.radius, shadow: b.shadow }
          void api.settingsUpdate({ beautify: { presets: set.presets.map((p) => (p.id === set.preset ? { ...p, ...look } : p)) } })
        }
      }
      return { canvas: out, png: await (await toBlob(out, 'image/png')).arrayBuffer() }
    },
    [composeSelection, cap]
  )

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
      if (id === 'color') return setPickerRequest((n) => n + 1)
      if (id === 'beautify') return setBeautify((b) => b && (lastBeautify = { ...b, on: !b.on }))
      if (id === 'beautifyEdit') {
        annRef.current?.finishEditing()
        setSelectedId(null)
        setBeautify((b) => b && (lastBeautify = { ...b, on: true }))
        return setEditorOpen(true)
      }
      if (id === 'undo' || id === 'redo') {
        annRef.current?.finishEditing()
        setSelectedId(null)
        setHistory((h) => (id === 'undo' ? undo(h) : redo(h)))
        return
      }
      if (id === 'pin') return setFloating((f) => !f)
      if (!sel) return
      if (id === 'copy' || id === 'save' || id === 'editDone') {
        busy.current = true
        try {
          flushSync(() => setSelectedId(null))
          const { canvas, png } = await renderOutput(sel)
          const history = cap.settings.history
          const toHistory = !history.paused && history.maxCount > 0
          // Taken now: main clears this session's canvas right after the output.
          const snap = snapshotDoc(sel)
          const thumb = toHistory ? thumbnail(canvas) : null
          // The floating preview (and edits of it) need the document with the output itself.
          const doc = floating || cap.edit ? await encodeDoc(snap) : null
          if (id === 'copy') api.copy(cap.session, png, doc ? { doc, rect: sel } : undefined)
          else if (id === 'editDone') api.editDone(cap.session, png, doc!)
          else api.save(cap.session, png)
          // History after the output, so the copy is never held up by it.
          if (thumb) {
            const [full, small] = await Promise.all([doc ?? encodeDoc(snap), toBlob(thumb, 'image/jpeg', 0.8)])
            api.historyAdd({ session: cap.session, final: new Uint8Array(png), doc: full, thumb: new Uint8Array(await small.arrayBuffer()) })
          }
        } catch (err) {
          console.error(`${id} failed:`, err instanceof Error ? err.stack : err) // shows up in main.log
          busy.current = false // let the user try again (or Esc)
        }
      }
    },
    [cap, sel, renderOutput, floating, snapshotDoc]
  )

  /** Letter -> drawing tool, for the tools that are switched on. */
  const toolKeys = useMemo(() => {
    const m = new Map<string, string>()
    if (cap)
      for (const f of visibleFeatures(cap.settings, 'tool')) {
        const key = cap.settings.toolKeys[f.id] ?? f.hint
        if (f.drawing && key) m.set(key.toLowerCase(), f.id)
      }
    return m
  }, [cap])

  // ---- keyboard -------------------------------------------------------------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Typing fields keep their keys; anything else (e.g. a slider that still
      // has focus) must not swallow ⌘C / Esc.
      const typing = e.target instanceof HTMLTextAreaElement || (e.target instanceof HTMLInputElement && (e.target.type === 'text' || e.target.type === 'number'))
      // Text being typed keeps every key, even if its box lost focus for a moment.
      if (!cap || e.defaultPrevented || typing) return
      if (annRef.current?.isEditing()) {
        if (e.key === 'Escape') annRef.current.finishEditing()
        return
      }
      if (e.target instanceof HTMLInputElement) e.target.blur()
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
      } else if (mod && e.key === ',') {
        e.preventDefault()
        api.openSettings()
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
      } else if (sel && !editorOpen && e.key.startsWith('Arrow')) {
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
  }, [cap, sel, screen, runAction, shapes, selectedId, toolKeys, onCommit, editorOpen])

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
    (patch: Partial<Style>, continuous?: boolean) => {
      if (!style || !cap) return
      const next = { ...style, ...patch }
      setStyle(next)
      lastStyle = next
      const target = shapes.find((x) => x.id === selectedId)
      // A slider or picker drag is one undo step.
      const key = continuous && target ? `style:${target.id}:${Object.keys(patch).join()}` : undefined
      if (target) onCommit(upsert(shapes, restyle(target, patch, cap.settings.annotate.strokeWidths)), key)
    },
    [style, cap, shapes, selectedId, onCommit]
  )

  const onVariant = useCallback((featureId: string, variantId: string) => {
    annRef.current?.finishEditing()
    setSelectedId(null)
    setTool(featureId as ToolId)
    setVariants((v) => (lastVariants = { ...v, [featureId]: variantId }))
  }, [])

  // ---- render ---------------------------------------------------------------
  const s = cap?.settings
  const dim = `rgba(0,0,0,${s?.capture.dimOpacity ?? 0.6})`
  const accent = s?.capture.accentColor ?? '#3b82f6'
  const scale = cap?.scale ?? 1
  const hasSel = !!(cap && sel && sel.w >= MIN_SIZE && sel.h >= MIN_SIZE)
  const showToolbars = hasSel && !drag

  const selectedShape = shapes.find((x) => x.id === selectedId)
  const styleTarget: StyleTarget | null = selectedShape?.type ?? tool
  const toolVariant = tool ? (variants[tool] ?? null) : null
  const filled = selectedShape ? 'filled' in selectedShape && !!selectedShape.filled : !!toolVariant?.endsWith('-filled')
  const styleBar =
    cap && style && styleTarget && hasStyleOptions(styleTarget) ? (
      <StyleBar
        pickerRequest={pickerRequest}
        highlighterPalette={cap.settings.annotate.highlighterPalette}
        target={styleTarget}
        filled={filled}
        // A selected shape shows its own color, size and look.
        style={selectedShape ? styleOf(selectedShape, style, cap.settings.annotate.strokeWidths) : style}
        palette={cap.settings.annotate.palette}
        onChange={onStyleChange}
      />
    ) : null
  const unavailable = new Set<string>()
  if (!history.past.length) unavailable.add('undo')
  if (!history.future.length) unavailable.add('redo')
  const pressed = new Set<string>()
  const lit = new Set<string>(beautify?.on ? ['beautify'] : [])
  if (beautify?.on) pressed.add('beautify') // highlighted like an active tool, plus the dot
  if (floating) {
    lit.add('pin')
    pressed.add('pin')
  }
  const tips = {
    pin: {
      text: floating ? 'Floating preview: on' : 'Floating preview: off',
      sub: 'After copying, keep it in the corner to copy again, edit or pin'
    },
    beautify: { text: beautify?.on ? 'Background: on' : 'Background: off', sub: 'Click to turn it ' + (beautify?.on ? 'off' : 'on') + ' for copy & save' }
  }
  // Editing a floating preview: leaving the editor keeps the edits there and ends the session.
  const closeEditor = useCallback(() => (cap?.edit ? void runAction('editDone') : setEditorOpen(false)), [cap, runAction])
  const escapeInEditor = useCallback(() => {
    if (annRef.current?.isEditing()) {
      annRef.current.finishEditing()
      return true
    }
    if (selectedId) {
      setSelectedId(null)
      return true
    }
    return false
  }, [selectedId])
  // eslint-disable-next-line react-hooks/exhaustive-deps -- paintedVersion: rebuild once the image has arrived
  const composeForEditor = useCallback((scale: number) => composeSelection(sel!, scale, false), [composeSelection, sel, paintedVersion])

  // One drawing layer: in capture mode over the selection, or inside the background editor.
  const annotationLayer = sel && style && cap && (
    <AnnotationLayer
      ref={annRef}
      sel={sel}
      shapes={shapes}
      tool={tool}
      variant={toolVariant}
      style={style}
      strokeWidths={cap.settings.annotate.strokeWidths}
      highlighter={{ width: cap.settings.annotate.highlighterWidth }}
      stepSize={cap.settings.annotate.stepSize}
      stepTextColor={cap.settings.annotate.stepTextColor}
      selectedId={selectedId}
      onSelect={setSelectedId}
      onCommit={onCommit}
      source={source}
      scale={scale}
    />
  )
  const toolbars = (docked: boolean) =>
    sel && cap && style ? (
      <Toolbars
        selection={sel}
        screen={screen}
        settings={cap.settings}
        activeTool={tool}
        color={
          tool === 'text' || selectedShape?.type === 'text'
            ? style.textColor
            : tool === 'highlighter' || selectedShape?.type === 'highlighter'
              ? style.highlighterColor
              : tool === 'step' || selectedShape?.type === 'step'
                ? style.stepColor
                : style.color
        }
        pressed={pressed}
        unavailable={unavailable}
        styleBar={styleBar}
        variants={variants}
        onAction={(id) => void runAction(id)}
        onVariant={onVariant}
        lit={lit}
        tips={tips}
        docked={docked}
      />
    ) : null

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
      <canvas ref={canvasRef} className="frozen" width={1} height={1} style={cap?.edit ? { visibility: 'hidden' } : undefined} />

      {cap && (!sel || cap.edit) && <div className="dim-full" style={{ background: dim }} />}

      {cap && sel && !cap.edit && (
        <div
          className="selection"
          style={{ left: sel.x, top: sel.y, width: sel.w, height: sel.h, boxShadow: `0 0 0 1px ${accent}, 0 0 0 99999px ${dim}` }}
        />
      )}

      {hasSel && !editorOpen && annotationLayer}

      {cap && sel && !drag && !cap.edit && (
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

      {cap && sel && !cap.edit && s?.capture.showSizeLabel && (
        <div className="size-label" style={{ left: sel.x, top: sel.y >= 26 ? sel.y - 24 : sel.y + 6 }}>
          {Math.round(sel.w * scale)} × {Math.round(sel.h * scale)}
        </div>
      )}

      {editorOpen && sel && cap && beautify && (
        <BackgroundEditor
          presets={cap.settings.beautify.presets}
          gradients={cap.settings.beautify.gradients}
          solids={cap.settings.beautify.solids}
          state={beautify}
          onChange={(next) => {
            setBeautify(next)
            lastBeautify = next
          }}
          selection={sel}
          exportScale={scale}
          compose={composeForEditor}
          annotations={(place) => (
            // Overlay coordinates, scaled onto the preview.
            <div className="be-ann" style={{ left: place.left, top: place.top, width: sel.w, height: sel.h, transform: `scale(${place.k})` }}>
              <div style={{ position: 'absolute', left: -sel.x, top: -sel.y }}>{annotationLayer}</div>
            </div>
          )}
          toolbar={toolbars(true)}
          onClose={closeEditor}
          onEscape={escapeInEditor}
          onCopy={() => void runAction('copy')}
          onSave={() => void runAction('save')}
        />
      )}

      {showToolbars && !editorOpen && toolbars(false)}
    </div>
  )
}
