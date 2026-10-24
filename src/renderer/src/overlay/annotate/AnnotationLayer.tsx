import Konva from 'konva'
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { Arrow, Circle, Ellipse, Group, Image as KImage, Label, Layer, Line, Rect as KRect, Stage, Tag, Text, Transformer } from 'react-konva'
import type { Rect } from '../layout'
import {
  boxFromDrag, isMeaningful, moveShape, newId, openArrowHead, remove, snap45, snapBox, stepNumbers, upsert,
  type BlurShape, type Guide, type LineShape, type Shape, type Style, type TextShape, type ToolId
} from './model'
import { readableOn } from './color'
import { obscure } from './obscure'

/**
 * Pointer-downs the annotation layer handled itself. The overlay checks this so
 * it doesn't also start moving or replacing the selection.
 */
export const handledEvents = new WeakSet<Event>()

export interface AnnotationLayerHandle {
  /** Annotations over the selection at image resolution, or null if there are none. */
  exportCanvas(scale: number): HTMLCanvasElement | null
  /** Commit any text being typed. */
  finishEditing(): void
  /** Text is being typed right now. */
  isEditing(): boolean
}

interface Props {
  sel: Rect
  shapes: Shape[]
  tool: ToolId | null
  /** Chosen variant of the active tool (e.g. 'ellipse-filled' for the rectangle tool). */
  variant: string | null
  style: Style
  strokeWidths: [number, number, number]
  highlighter: { width: number }
  stepSize: number
  /** Number color on step badges; '' = black or white, whichever reads better. */
  stepTextColor: string
  selectedId: string | null
  onSelect(id: string | null): void
  onCommit(next: Shape[], mergeKey?: string): void
  /** Frozen screenshot, the source for blur. */
  source: () => HTMLCanvasElement | null
  /** Image px per overlay px. */
  scale: number
}

/** Push-pin cursor for the numbered-step tool; the hot spot is the pin's point. */
const STEP_CURSOR = `url("data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="#fff" stroke="#111" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M12 17v5" fill="none"/>' +
    '<path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"/>' +
    '</svg>'
)}") 14 26, copy`

const TEXT_PAD = 6
/** Extra grab margin around text, in px. */
const TEXT_GRAB = 8
/** Width of the draggable frame around the text box while typing. */
const TEXT_FRAME = 7
const LINE_HEIGHT = 1.2
const textPad = (s: TextShape) => (s.background ? TEXT_PAD : 0)

export const AnnotationLayer = forwardRef<AnnotationLayerHandle, Props>(function AnnotationLayer(props, ref) {
  const { sel, shapes, tool, style, selectedId, onSelect, onCommit, scale } = props
  const stageRef = useRef<Konva.Stage>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  /**
   * Screen point -> overlay coordinates. The layer may be shown scaled (in
   * the background editor), so go through its on-screen box.
   */
  const zoom = () => {
    const r = containerRef.current?.getBoundingClientRect()
    return r && sel.w ? r.width / sel.w : 1
  }
  const toLocal = (cx: number, cy: number): [number, number] => {
    const r = containerRef.current?.getBoundingClientRect()
    if (!r) return [cx, cy]
    const k = zoom()
    return [sel.x + (cx - r.left) / k, sel.y + (cy - r.top) / k]
  }
  const uiRef = useRef<Konva.Layer>(null)
  const trRef = useRef<Konva.Transformer>(null)
  const [draft, setDraft] = useState<Shape | null>(null)
  const [editing, setEditing] = useState<TextShape | null>(null)
  const editingRef = useRef(editing)
  editingRef.current = editing
  const shapesRef = useRef(shapes)
  shapesRef.current = shapes

  const steps = useMemo(() => stepNumbers(draft ? [...shapes, draft] : shapes), [shapes, draft])
  const strokeWidth = props.strokeWidths[style.widthIndex] ?? props.strokeWidths[1]

  // ---- text editing ----------------------------------------------------------
  const finishEditing = () => {
    const t = editingRef.current
    if (!t) return
    editingRef.current = null
    setEditing(null)
    const list = shapesRef.current
    if (isMeaningful(t)) {
      onCommit(upsert(list, t))
      onSelect(t.id) // stays selected, ready to move or restyle
    } else if (list.some((s) => s.id === t.id)) onCommit(remove(list, t.id))
  }

  useImperativeHandle(ref, () => ({
    finishEditing: () => flushSync(finishEditing),
    isEditing: () => !!editingRef.current,
    exportCanvas(pixelRatio) {
      if (editingRef.current) flushSync(finishEditing)
      const stage = stageRef.current
      if (!stage || !shapesRef.current.length) return null
      uiRef.current?.hide()
      const canvas = stage.toCanvas({ pixelRatio })
      uiRef.current?.show()
      return canvas
    }
  }))

  // Style bar changes apply to the text being typed.
  const prevStyle = useRef(style)
  useEffect(() => {
    if (prevStyle.current === style) return
    prevStyle.current = style
    const t = editingRef.current
    if (t) setEditing({ ...t, color: style.textColor, fontSize: style.fontSize, shadow: style.shadow, background: style.textBackground, stroke: style.textStroke })
  }, [style])

  // ---- selection handles -----------------------------------------------------
  const selected = shapes.find((s) => s.id === selectedId) ?? null
  useEffect(() => {
    const tr = trRef.current
    const stage = stageRef.current
    if (!tr || !stage) return
    const node = selected && !editing ? stage.findOne('#' + selected.id) : null
    tr.nodes(node ? [node] : [])
    tr.getLayer()?.batchDraw()
  }, [selected, editing, shapes])

  // ---- drawing ---------------------------------------------------------------
  const startDraw = (evt: PointerEvent) => {
    if (!tool) return false
    const [x0, y0] = toLocal(evt.clientX, evt.clientY)
    const id = newId()

    if (tool === 'step') {
      // Zoomed out (the background editor): a somewhat bigger badge, so it isn't tiny on screen.
      const size = Math.round(props.stepSize / Math.sqrt(Math.min(1, zoom())))
      onCommit([...shapes, { id, type: 'step', x: x0, y: y0, size, color: style.stepColor }])
      return true
    }
    if (tool === 'text') {
      const fontSize = style.fontSize
      const pad = style.textBackground ? TEXT_PAD : 0
      // Click point = middle of the first line, so the caret lands where you clicked.
      setEditing({
        id, type: 'text', x: x0 - pad, y: y0 - (fontSize * LINE_HEIGHT) / 2 - pad, text: '', color: style.textColor,
        fontSize, fontFamily: style.fontFamily, shadow: style.shadow, background: style.textBackground,
        stroke: style.textStroke, strokeWidth: style.textStrokeWidth
      })
      onSelect(null)
      return true
    }

    // The rectangle tool's last variant draws a line.
    const kind: ToolId = tool === 'rect' && props.variant === 'line' ? 'line' : tool
    const make = (x: number, y: number, shift: boolean): Shape => {
      switch (kind) {
        case 'pen':
        case 'highlighter': {
          const base: Shape =
            kind === 'pen'
              ? { id, type: 'pen', points: [x0, y0, x, y], color: style.color, width: strokeWidth }
              : { id, type: 'highlighter', points: [x0, y0, x, y], color: style.highlighterColor, width: props.highlighter.width }
          // Shift: a straight stroke from where you started.
          if (shift) return base
          const d = draftRef.current
          return d && d.type === kind ? { ...d, points: [...d.points, x, y] } : base
        }
        case 'line':
        case 'arrow': {
          const [dx, dy] = shift ? snap45(x - x0, y - y0) : [x - x0, y - y0]
          // New arrows have an open head (filled heads only appear in older captures).
          const head = kind === 'arrow' ? 'open' : undefined
          return { id, type: kind, points: [x0, y0, x0 + dx, y0 + dy], color: style.color, width: strokeWidth, head }
        }
        case 'rect':
        case 'ellipse': {
          const v = props.variant ?? tool
          const type = v.startsWith('ellipse') ? 'ellipse' : 'rect'
          return { id, type, ...boxFromDrag(x0, y0, x, y, shift), color: style.color, width: strokeWidth, filled: v.endsWith('-filled') }
        }
        case 'blur':
          return { id, type: 'blur', ...boxFromDrag(x0, y0, x, y, shift), mode: style.blurMode, strength: style.blurStrength }
      }
    }

    const draftRef = { current: null as Shape | null }
    const move = (e: PointerEvent) => {
      draftRef.current = make(...toLocal(e.clientX, e.clientY), e.shiftKey)
      setDraft(draftRef.current)
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      const d = draftRef.current
      setDraft(null)
      if (d && isMeaningful(d)) onCommit([...shapesRef.current, d])
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    onSelect(null)
    return true
  }

  const onStagePointerDown = (e: Konva.KonvaEventObject<PointerEvent>) => {
    if (e.evt.button !== 0) return
    if (editingRef.current) {
      // A click away from the text box finishes it rather than starting something new.
      finishEditing()
      handledEvents.add(e.evt)
      return
    }
    if (e.target !== e.target.getStage()) {
      handledEvents.add(e.evt) // a shape, handle or the selection frame
      return
    }
    if (startDraw(e.evt)) handledEvents.add(e.evt)
    else onSelect(null) // no tool: deselect, and let the overlay move the selection
  }

  // ---- editing existing shapes -------------------------------------------------
  const commitShape = (s: Shape) => onCommit(upsert(shapesRef.current, s))
  const clickEdits = useRef(false)

  const groupProps = (s: Shape) => ({
    id: s.id,
    draggable: true,
    // Blur areas are large: only grab them when no other drawing tool is active.
    listening: s.type !== 'blur' || !tool || tool === 'blur',
    onPointerDown: (e: Konva.KonvaEventObject<PointerEvent>) => {
      if (e.evt.button !== 0) return
      handledEvents.add(e.evt)
      if (editingRef.current) return
      e.cancelBubble = true
      clickEdits.current = s.type === 'text' && (tool === 'text' || selectedId === s.id)
      onSelect(s.id)
    },
    // A click (not a drag) on text with the Text tool, or on text that's already selected, edits it.
    onClick: () => clickEdits.current && s.type === 'text' && startEditing(s),
    onDblClick: () => s.type === 'text' && startEditing(s),
    onMouseEnter: () => setCursor('move'),
    onMouseLeave: () => setCursor(null),
    onDragMove: (e: Konva.KonvaEventObject<DragEvent>) => {
      const g = e.target
      // Smart snap: line edges and centers up with other shapes and the capture area. Hold ⌘ to place freely.
      if (!e.evt.metaKey) {
        const layer = g.getLayer()!
        const stage = g.getStage()!
        const box = g.getClientRect({ relativeTo: layer, skipShadow: true })
        const others = shapesRef.current
          .filter((o) => o.id !== s.id)
          .map((o) => stage.findOne('#' + o.id)?.getClientRect({ relativeTo: layer, skipShadow: true }))
          .filter((b): b is NonNullable<typeof b> => !!b)
          .map((b) => ({ x: b.x, y: b.y, w: b.width, h: b.height }))
        const r = snapBox({ x: box.x, y: box.y, w: box.width, h: box.height }, [...others, sel], 6 / zoom())
        g.position({ x: g.x() + r.dx, y: g.y() + r.dy })
        setGuides(r.guides)
      } else setGuides([])
      // Blur areas re-render what's under them while being moved.
      if (s.type === 'blur') setLive({ id: s.id, rect: { x: s.x + g.x(), y: s.y + g.y(), w: s.w, h: s.h } })
    },
    onTransform: (e: Konva.KonvaEventObject<Event>) => {
      const g = e.target
      if (s.type === 'blur') setLive({ id: s.id, rect: transformShape(s, g.x(), g.y(), g.scaleX(), g.scaleY()) as BlurShape })
    },
    onDragEnd: (e: Konva.KonvaEventObject<DragEvent>) => {
      const g = e.target
      const dx = g.x()
      const dy = g.y()
      g.position({ x: 0, y: 0 })
      setLive(null)
      setGuides([])
      commitShape(moveShape(s, dx, dy))
    },
    onTransformEnd: (e: Konva.KonvaEventObject<Event>) => {
      const g = e.target
      const sx = g.scaleX()
      const sy = g.scaleY()
      const gx = g.x()
      const gy = g.y()
      g.setAttrs({ x: 0, y: 0, scaleX: 1, scaleY: 1 })
      setLive(null)
      commitShape(transformShape(s, gx, gy, sx, sy))
    }
  })

  const startEditing = (s: TextShape) => {
    onSelect(null)
    setEditing(s)
  }

  const [cursor, setCursor] = useState<string | null>(null)
  const [live, setLive] = useState<{ id: string; rect: Rect } | null>(null)
  const [guides, setGuides] = useState<Guide[]>([])

  // ---- render ------------------------------------------------------------------
  const renderShape = (s: Shape, isDraft = false) => {
    const hidden = editing?.id === s.id
    const body = (() => {
      switch (s.type) {
        case 'pen':
        case 'highlighter':
          return (
            <Line
              points={s.points}
              stroke={s.color}
              strokeWidth={s.width}
              lineCap="round"
              lineJoin="round"
              tension={s.type === 'pen' ? 0.4 : 0}
              opacity={s.type === 'highlighter' ? 0.45 : 1}
              hitStrokeWidth={Math.max(12, s.width)}
            />
          )
        case 'line':
          return <Line points={s.points} stroke={s.color} strokeWidth={s.width} lineCap="round" hitStrokeWidth={Math.max(12, s.width)} />
        case 'arrow': {
          const head = s.width * 2.5 + 8
          if (s.head === 'open') {
            const line = { stroke: s.color, strokeWidth: s.width, lineCap: 'round' as const, lineJoin: 'round' as const, hitStrokeWidth: Math.max(12, s.width) }
            return (
              <>
                <Line points={s.points} {...line} />
                <Line points={openArrowHead(s.points, head * 1.1)} {...line} />
              </>
            )
          }
          return (
            <Arrow
              points={s.points}
              stroke={s.color}
              fill={s.color}
              strokeWidth={s.width}
              pointerLength={head}
              pointerWidth={head}
              lineCap="round"
              lineJoin="round"
              hitStrokeWidth={Math.max(12, s.width)}
            />
          )
        }
        case 'rect':
        case 'ellipse': {
          const paint = s.filled
            ? { fill: s.color, strokeEnabled: false }
            : { stroke: s.color, strokeWidth: s.width, hitStrokeWidth: Math.max(12, s.width), fillEnabled: false }
          return s.type === 'rect' ? (
            <KRect x={s.x} y={s.y} width={s.w} height={s.h} cornerRadius={s.filled ? 4 : 2} {...paint} />
          ) : (
            <Ellipse x={s.x + s.w / 2} y={s.y + s.h / 2} radiusX={s.w / 2} radiusY={s.h / 2} {...paint} />
          )
        }
        case 'blur':
          return <BlurNode shape={s} live={live?.id === s.id ? live.rect : null} source={props.source} scale={scale} />
        case 'step': {
          const n = steps.get(s.id) ?? 0
          return (
            <Group x={s.x} y={s.y}>
              <Circle radius={s.size / 2} fill={s.color} stroke="#fff" strokeWidth={2} shadowColor="#000" shadowBlur={4} shadowOpacity={0.3} />
              <Text
                text={String(n)}
                width={s.size}
                height={s.size}
                offsetX={s.size / 2}
                offsetY={s.size / 2}
                align="center"
                verticalAlign="middle"
                fontSize={s.size * 0.5}
                fontStyle="bold"
                fill={props.stepTextColor || readableOn(s.color)}
              />
            </Group>
          )
        }
        case 'text':
          return <TextNode shape={s} />
      }
    })()
    return (
      <Group key={s.id} {...(isDraft ? { listening: false } : groupProps(s))} opacity={hidden ? 0 : 1}>
        {body}
      </Group>
    )
  }

  const lineSel = selected && (selected.type === 'line' || selected.type === 'arrow') && !editing ? selected : null
  const containerCursor = cursor ?? (tool === 'text' ? 'text' : tool === 'step' ? STEP_CURSOR : tool ? 'crosshair' : 'move')

  return (
    <>
      <div ref={containerRef} className="annotations" style={{ left: sel.x, top: sel.y, width: sel.w, height: sel.h, cursor: containerCursor }}>
        <Stage ref={stageRef} width={sel.w} height={sel.h} onPointerDown={onStagePointerDown}>
          <Layer x={-sel.x} y={-sel.y}>
            {shapes.map((s) => renderShape(s))}
            {draft && renderShape(draft, true)}
          </Layer>
          <Layer ref={uiRef} x={-sel.x} y={-sel.y}>
            <Transformer
              ref={trRef}
              rotateEnabled={false}
              flipEnabled={false}
              ignoreStroke
              resizeEnabled={!!selected && resizable(selected)}
              keepRatio={!!selected && (selected.type === 'text' || selected.type === 'step')}
              enabledAnchors={selected && (selected.type === 'text' || selected.type === 'step') ? ['top-left', 'top-right', 'bottom-left', 'bottom-right'] : undefined}
              borderStroke="#3b82f6"
              borderDash={[4, 3]}
              anchorStroke="#3b82f6"
              anchorSize={12}
              anchorCornerRadius={3}
              padding={6}
              shouldOverdrawWholeArea
              // The frame covers the selected shape, so a click on selected text lands here (not on a resize handle).
              onClick={(e) => selected?.type === 'text' && e.target.name() === 'back' && startEditing(selected)}
            />
            {lineSel && <LineEnds shape={lineSel} onCommit={commitShape} />}
            {guides.map((gd, i) => (
              <Line
                key={i}
                points={gd.dir === 'v' ? [gd.at, gd.from - 8, gd.at, gd.to + 8] : [gd.from - 8, gd.at, gd.to + 8, gd.at]}
                stroke="#ff2d95"
                strokeWidth={1}
                dash={[4, 3]}
                listening={false}
              />
            ))}
          </Layer>
        </Stage>
      </div>
      {editing && <TextEditor shape={editing} zoom={zoom} onChange={setEditing} onDone={finishEditing} />}
    </>
  )
})

const resizable = (s: Shape) => s.type === 'rect' || s.type === 'ellipse' || s.type === 'blur' || s.type === 'text' || s.type === 'step'

/** Apply a Transformer result (group moved by gx/gy and scaled by sx/sy) to the shape's own data. */
function transformShape(s: Shape, gx: number, gy: number, sx: number, sy: number): Shape {
  const px = (x: number) => gx + x * sx
  const py = (y: number) => gy + y * sy
  switch (s.type) {
    case 'rect':
    case 'ellipse':
    case 'blur':
      return { ...s, x: px(s.x), y: py(s.y), w: Math.max(4, s.w * sx), h: Math.max(4, s.h * sy) }
    case 'text':
      return { ...s, x: px(s.x), y: py(s.y), fontSize: Math.max(8, Math.round(s.fontSize * sy)) }
    case 'step':
      return { ...s, x: px(s.x), y: py(s.y), size: Math.max(14, Math.round(s.size * sy)) }
    default:
      return moveShape(s, gx, gy)
  }
}


/**
 * `live`: where the area is while it's being dragged or resized. The image is
 * still drawn at the shape's own rect (Konva applies the drag/scale on top),
 * but its content comes from the live position.
 */
function BlurNode({ shape, live, source, scale }: { shape: BlurShape; live: Rect | null; source: () => HTMLCanvasElement | null; scale: number }) {
  const { x, y, w, h, mode, strength } = shape
  const r = live ?? shape
  const image = useMemo(() => {
    const src = source()
    return src && src.width > 1 ? obscure(src, { x: r.x, y: r.y, w: r.w, h: r.h }, scale, mode, strength ?? 12) : undefined
  }, [r.x, r.y, r.w, r.h, mode, strength, scale, source])
  // `fill` makes the whole area clickable (images aren't hit-testable otherwise).
  return image ? (
    <KImage image={image} x={x} y={y} width={w} height={h} fill="transparent" />
  ) : (
    <KRect x={x} y={y} width={w} height={h} fill="rgba(128,128,128,.6)" />
  )
}

function TextNode({ shape: s }: { shape: TextShape }) {
  return (
    <Label x={s.x} y={s.y}>
      <Tag
        fill={s.background || 'transparent'}
        cornerRadius={s.background ? 6 : 0}
        // Easy to grab: the whole box plus a margin, not just the letters.
        hitFunc={(ctx, shape) => {
          ctx.beginPath()
          ctx.rect(-TEXT_GRAB, -TEXT_GRAB, shape.width() + TEXT_GRAB * 2, shape.height() + TEXT_GRAB * 2)
          ctx.closePath()
          ctx.fillStrokeShape(shape)
        }}
      />
      <Text
        text={s.text || ' '}
        fontSize={s.fontSize}
        fontFamily={s.fontFamily}
        lineHeight={LINE_HEIGHT}
        fill={s.color}
        padding={textPad(s)}
        // Outline outside the letters: stroke twice as wide, then fill over it.
        stroke={s.stroke || undefined}
        strokeWidth={s.stroke ? (s.strokeWidth ?? 3) * 2 : 0}
        fillAfterStrokeEnabled
        lineJoin="round"
        // Subtle shadow; its strength is a setting.
        shadowEnabled={Number(s.shadow) > 0}
        shadowColor="#000"
        shadowBlur={s.fontSize * 0.18}
        shadowOffset={{ x: 0, y: Math.max(1, s.fontSize * 0.06) }}
        shadowOpacity={Number(s.shadow)}
      />
    </Label>
  )
}

/** Draggable end points for a selected line or arrow. */
function LineEnds({ shape, onCommit }: { shape: LineShape; onCommit(s: Shape): void }) {
  const [pts, setPts] = useState(shape.points)
  useEffect(() => setPts(shape.points), [shape.points])
  const handle = (i: 0 | 2) => (
    <Circle
      x={pts[i]}
      y={pts[i + 1]}
      radius={7.5}
      fill="#fff"
      stroke="#3b82f6"
      strokeWidth={2}
      draggable
      onPointerDown={(e) => {
        handledEvents.add(e.evt)
        e.cancelBubble = true
      }}
      onDragMove={(e) => {
        const next = [...pts] as LineShape['points']
        next[i] = e.target.x()
        next[i + 1] = e.target.y()
        setPts(next)
      }}
      onDragEnd={() => onCommit({ ...shape, points: pts })}
    />
  )
  return (
    <>
      {/* Live preview of the line while an end is dragged. */}
      {pts !== shape.points && <Line points={pts} stroke={shape.color} strokeWidth={shape.width} opacity={0.5} listening={false} />}
      {handle(0)}
      {handle(2)}
    </>
  )
}

function TextEditor(props: { shape: TextShape; zoom(): number; onChange(s: TextShape): void; onDone(): void }) {
  const { shape: s, zoom, onChange, onDone } = props
  const ref = useRef<HTMLTextAreaElement>(null)
  const shapeRef = useRef(s)
  shapeRef.current = s
  useEffect(() => {
    // Focus once the click that created the box has finished: focusing during
    // it would be undone by its own mouse-down (and end the empty text box).
    const t = setTimeout(() => {
      const el = ref.current
      if (!el) return
      el.focus({ preventScroll: true })
      el.setSelectionRange(el.value.length, el.value.length) // existing text: carry on at the end
    }, 0)
    return () => clearTimeout(t)
  }, [])
  const pad = textPad(s)

  // Dragging the frame around the text box moves it while typing.
  const moveFrame = (e: React.PointerEvent<HTMLDivElement>) => {
    e.stopPropagation()
    if (e.target !== e.currentTarget || e.button !== 0) return
    e.preventDefault() // keep the caret in the text box
    const start = { x: e.clientX, y: e.clientY, sx: shapeRef.current.x, sy: shapeRef.current.y, k: zoom() }
    const move = (ev: PointerEvent) =>
      onChange({ ...shapeRef.current, x: start.sx + (ev.clientX - start.x) / start.k, y: start.sy + (ev.clientY - start.y) / start.k })
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  return (
    <div className="text-frame" style={{ left: s.x - TEXT_FRAME, top: s.y - TEXT_FRAME, padding: TEXT_FRAME }} onPointerDown={moveFrame}>
      <textarea
        ref={ref}
        className="text-editor"
        value={s.text}
        spellCheck={false}
        rows={1}
        style={{
          padding: pad,
          fontSize: s.fontSize,
          fontFamily: s.fontFamily,
          lineHeight: LINE_HEIGHT,
          color: s.color,
          background: s.background || 'transparent',
          borderRadius: s.background ? 6 : 0,
          textShadow: Number(s.shadow) > 0 ? `0 ${Math.max(1, s.fontSize * 0.06)}px ${s.fontSize * 0.18}px rgba(0,0,0,${Number(s.shadow)})` : 'none',
          WebkitTextStroke: s.stroke ? `${(s.strokeWidth ?? 3) * 2}px ${s.stroke}` : undefined,
          paintOrder: 'stroke fill',
          caretColor: s.color
        }}
        onChange={(e) => onChange({ ...s, text: e.target.value })}
        onPointerDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          // Keep every key here (Enter, Esc, ⌘C...) away from capture mode while typing.
          e.stopPropagation()
          e.nativeEvent.stopImmediatePropagation()
          // Enter adds a line; ⌘Enter / Ctrl+Enter or Esc finishes.
          if (e.key === 'Escape' || (e.key === 'Enter' && (e.metaKey || e.ctrlKey))) {
            e.preventDefault()
            onDone()
          }
        }}
        onBlur={onDone}
      />
    </div>
  )
}
