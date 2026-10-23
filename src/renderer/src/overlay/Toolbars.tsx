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
    const off = !f.implemented || unavailable.has(f.id)
    const cls = [f.id === 'copy' && 'primary', (f.id === activeTool || pressed.has(f.id)) && 'active', off && 'off'].filter(Boolean).join(' ')
    // Not `disabled`: disabled buttons get no hover events, so no tooltip.
    return (
      <button
        key={f.id}
        data-tip={f.implemented ? f.label : `${f.label} (coming soon)`}
        data-hint={f.implemented ? f.hint : undefined}
        aria-disabled={off}
        className={cls}
        onClick={() => !off && onAction(f.id)}
      >
        <Icon size={17} strokeWidth={2} />
        {f.id === 'color' && <span className="color-dot" style={{ background: color }} />}
      </button>
    )
  }

  // Stop mouse-downs on the bars from starting a new selection underneath, and
  // (except on inputs like the blur slider) from taking focus away from a text
  // box being typed in.
  const stop = (e: React.PointerEvent | React.MouseEvent) => {
    e.stopPropagation()
    if (!(e.target instanceof HTMLInputElement)) e.preventDefault()
  }

  // ---- tooltips ----
  const [tip, setTip] = useState<{ text: string; hint?: string; el: HTMLElement; vertical: boolean } | null>(null)
  const tipHandlers = (vertical: boolean) => ({
    onMouseOver: (e: React.MouseEvent) => {
      const el = (e.target as HTMLElement).closest<HTMLElement>('[data-tip]')
      if (el && el !== tip?.el) setTip({ text: el.dataset.tip!, hint: el.dataset.hint, el, vertical })
      else if (!el && tip) setTip(null)
    },
    onMouseLeave: () => setTip(null)
  })

  return (
    <>
      {tools.length > 0 && (
        <div className="toolbar vertical" style={{ left: layout.tools.x, top: layout.tools.y }} onPointerDown={stop} onMouseDown={stop} {...tipHandlers(true)}>
          {tools.map(button)}
        </div>
      )}
      {actions.length > 0 && (
        <div className="toolbar" style={{ left: layout.actions.x, top: layout.actions.y }} onPointerDown={stop} onMouseDown={stop} {...tipHandlers(false)}>
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
          {...tipHandlers(false)}
        >
          {styleBar}
        </div>
      )}
      {tip && tip.el.isConnected && <Tooltip {...tip} screen={screen} />}
    </>
  )
}

/** Tooltip beside a vertical bar, or below/above a horizontal one, kept on screen. */
function Tooltip({ text, hint, el, vertical, screen }: { text: string; hint?: string; el: HTMLElement; vertical: boolean; screen: Size }) {
  const r = el.getBoundingClientRect()
  const GAP = 8
  const style: React.CSSProperties = {}
  if (vertical) {
    const right = r.right + GAP + 200 < screen.w
    style.top = r.top + r.height / 2
    style.left = right ? r.right + GAP : r.left - GAP
    style.transform = right ? 'translateY(-50%)' : 'translate(-100%, -50%)'
  } else {
    const below = r.bottom + GAP + 30 < screen.h
    style.left = Math.min(Math.max(r.left + r.width / 2, 100), screen.w - 100)
    style.top = below ? r.bottom + GAP : r.top - GAP
    style.transform = below ? 'translateX(-50%)' : 'translate(-50%, -100%)'
  }
  return (
    <div className="tip" style={style}>
      {text}
      {hint && <kbd>{hint}</kbd>}
    </div>
  )
}
