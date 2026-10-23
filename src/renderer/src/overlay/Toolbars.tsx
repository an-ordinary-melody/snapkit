import {
  ArrowUpRight, Circle, Copy, Droplets, Frame, Hash, Highlighter, Palette, Pencil, Pin, Redo2, Save, Slash, Square, Type, Undo2, X,
  type LucideIcon
} from 'lucide-react'
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import type { FeatureDef } from '@shared/features'
import { visibleFeatures, type Settings } from '@shared/settings'
import { placeStyleBar, placeToolbars, type Rect, type Size } from './layout'

const ICONS: Record<string, LucideIcon> = {
  pen: Pencil, line: Slash, arrow: ArrowUpRight, rect: Square, ellipse: Circle, highlighter: Highlighter, text: Type,
  step: Hash, blur: Droplets, color: Palette, undo: Undo2, redo: Redo2, beautify: Frame, pin: Pin, save: Save, copy: Copy, close: X
}

const BTN = 32
const BTN_GAP = 2
const PAD = 4
const barLength = (n: number) => (n === 0 ? 0 : n * BTN + (n - 1) * BTN_GAP + PAD * 2)
const BAR_THICK = BTN + PAD * 2

interface Props {
  selection: Rect
  screen: Size
  settings: Settings
  /** Drawing tool currently selected. */
  activeTool: string | null
  /** Current annotation color, shown on the color button. */
  color: string
  /** Ids of buttons that are on (e.g. color while the style bar is open). */
  pressed: Set<string>
  /** Ids of buttons that can't be used right now (e.g. undo with nothing to undo). */
  unavailable: Set<string>
  /** Contents of the style bar, or null to hide it. */
  styleBar: ReactNode
  onAction(id: string): void
}

export function Toolbars({ selection, screen, settings, activeTool, color, pressed, unavailable, styleBar, onAction }: Props) {
  const actions = visibleFeatures(settings, 'action')
  const tools = visibleFeatures(settings, 'tool')
  const aSize = { w: barLength(actions.length), h: BAR_THICK }
  const tSize = tools.length ? { w: BAR_THICK, h: barLength(tools.length) } : { w: 0, h: 0 }
  const layout = placeToolbars(selection, screen, aSize, tSize)

  // The style bar's width depends on what it shows, so measure it.
  const styleRef = useRef<HTMLDivElement>(null)
  const [styleSize, setStyleSize] = useState<Size>({ w: 0, h: BAR_THICK })
  useLayoutEffect(() => {
    const el = styleRef.current
    if (el && (el.offsetWidth !== styleSize.w || el.offsetHeight !== styleSize.h)) setStyleSize({ w: el.offsetWidth, h: el.offsetHeight })
  })
  const stylePos = placeStyleBar({ ...layout.actions, ...aSize }, { ...layout.tools, ...tSize }, styleSize, screen)

  const button = (f: FeatureDef) => {
    const Icon = ICONS[f.id] ?? Square
    const title = f.implemented ? `${f.label}${f.hint ? `  (${f.hint})` : ''}` : `${f.label} — coming soon`
    const cls = [f.id === 'copy' && 'primary', (f.id === activeTool || pressed.has(f.id)) && 'active'].filter(Boolean).join(' ')
    return (
      <button key={f.id} title={title} disabled={!f.implemented || unavailable.has(f.id)} className={cls} onClick={() => onAction(f.id)}>
        <Icon size={17} strokeWidth={2} />
        {f.id === 'color' && <span className="color-dot" style={{ background: color }} />}
      </button>
    )
  }

  // Stop mouse-downs on the bars from starting a new selection underneath, and
  // from taking focus away from a text box being typed in.
  const stop = (e: React.PointerEvent | React.MouseEvent) => {
    e.stopPropagation()
    e.preventDefault()
  }

  return (
    <>
      {tools.length > 0 && (
        <div className="toolbar vertical" style={{ left: layout.tools.x, top: layout.tools.y }} onPointerDown={stop} onMouseDown={stop}>
          {tools.map(button)}
        </div>
      )}
      {actions.length > 0 && (
        <div className="toolbar" style={{ left: layout.actions.x, top: layout.actions.y }} onPointerDown={stop} onMouseDown={stop}>
          {actions.map(button)}
        </div>
      )}
      {styleBar && (
        <div
          ref={styleRef}
          className="toolbar style-bar"
          style={{ left: stylePos.x, top: stylePos.y, visibility: styleSize.w ? 'visible' : 'hidden' }}
          onPointerDown={stop}
          onMouseDown={stop}
        >
          {styleBar}
        </div>
      )}
    </>
  )
}
