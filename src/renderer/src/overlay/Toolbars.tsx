import {
  ArrowUpRight, Circle, Copy, Droplets, Frame, Hash, Highlighter, Palette, Pencil, Pin, Save, Slash, Square, Type, Undo2, X,
  type LucideIcon
} from 'lucide-react'
import type { FeatureDef } from '@shared/features'
import { visibleFeatures, type Settings } from '@shared/settings'
import { placeToolbars, type Rect, type Size } from './layout'

const ICONS: Record<string, LucideIcon> = {
  pen: Pencil, line: Slash, arrow: ArrowUpRight, rect: Square, ellipse: Circle, highlighter: Highlighter, text: Type,
  step: Hash, blur: Droplets, color: Palette, undo: Undo2, beautify: Frame, pin: Pin, save: Save, copy: Copy, close: X
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
  onAction(id: string): void
}

export function Toolbars({ selection, screen, settings, onAction }: Props) {
  const actions = visibleFeatures(settings, 'action')
  const tools = visibleFeatures(settings, 'tool')
  const aSize = { w: barLength(actions.length), h: BAR_THICK }
  const tSize = tools.length ? { w: BAR_THICK, h: barLength(tools.length) } : { w: 0, h: 0 }
  const layout = placeToolbars(selection, screen, aSize, tSize)

  const button = (f: FeatureDef) => {
    const Icon = ICONS[f.id] ?? Square
    const title = f.implemented ? `${f.label}${f.hint ? `  (${f.hint})` : ''}` : `${f.label} — coming soon`
    return (
      <button key={f.id} title={title} disabled={!f.implemented} className={f.id === 'copy' ? 'primary' : ''} onClick={() => onAction(f.id)}>
        <Icon size={17} strokeWidth={2} />
      </button>
    )
  }

  // Stop mouse-downs on the bars from starting a new selection underneath.
  const stop = (e: React.PointerEvent) => e.stopPropagation()

  return (
    <>
      {tools.length > 0 && (
        <div className="toolbar vertical" style={{ left: layout.tools.x, top: layout.tools.y }} onPointerDown={stop}>
          {tools.map(button)}
        </div>
      )}
      {actions.length > 0 && (
        <div className="toolbar" style={{ left: layout.actions.x, top: layout.actions.y }} onPointerDown={stop}>
          {actions.map(button)}
        </div>
      )}
    </>
  )
}
