// The capture-mode toolbars, drawn like the app's (same icons, sizes and dark theme).
import { Copy, Droplets, Hash, Highlighter, Pencil, Pin, Save, Square, Type, Undo2, WandSparkles, X, type LucideIcon } from 'lucide-react'
import type { CSSProperties } from 'react'

/** Long diagonal arrow with an open head (the app's arrow icon). */
export function ArrowIcon({ size = 17 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 19 L19 5" />
      <path d="M11 5 H19 V13" />
    </svg>
  )
}

/** Background: two stacked layers (the app's background icon). */
export function BackgroundIcon({ size = 17 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M13 19.24a2 2 0 0 1-2 0L2.5 14.37a1 1 0 0 1 0-1.74L11 7.76a2 2 0 0 1 2 0l8.5 4.87a1 1 0 0 1 0 1.74Z" fill="currentColor" fillOpacity={0.35} stroke="none" />
      <path d="m16.02 12 5.48 3.13a1 1 0 0 1 0 1.74L13 21.74a2 2 0 0 1-2 0l-8.5-4.87a1 1 0 0 1 0-1.74L7.98 12" />
      <path d="M13 13.74a2 2 0 0 1-2 0L2.5 8.87a1 1 0 0 1 0-1.74L11 2.26a2 2 0 0 1 2 0l8.5 4.87a1 1 0 0 1 0 1.74Z" />
    </svg>
  )
}

type Item = { id: string; label: string; key?: string; Icon?: LucideIcon; custom?: 'arrow' | 'background' | 'color' }

export const TOOLS: Item[] = [
  { id: 'pen', label: 'Pencil', key: 'P', Icon: Pencil },
  { id: 'arrow', label: 'Arrow', key: 'A', custom: 'arrow' },
  { id: 'rect', label: 'Rectangle', key: 'R', Icon: Square },
  { id: 'highlighter', label: 'Highlighter', key: 'H', Icon: Highlighter },
  { id: 'text', label: 'Text', key: 'T', Icon: Type },
  { id: 'step', label: 'Numbered step', key: 'N', Icon: Hash },
  { id: 'blur', label: 'Blur', key: 'B', Icon: Droplets },
  { id: 'color', label: 'Color', custom: 'color' },
  { id: 'undo', label: 'Undo', key: '⌘Z', Icon: Undo2 }
]

export const ACTIONS: Item[] = [
  { id: 'beautify', label: 'Background', custom: 'background' },
  { id: 'beautifyEdit', label: 'Edit background', Icon: WandSparkles },
  { id: 'pin', label: 'Floating preview', Icon: Pin },
  { id: 'save', label: 'Save', key: '⌘S', Icon: Save },
  { id: 'copy', label: 'Copy', key: '⌘C', Icon: Copy },
  { id: 'close', label: 'Close', key: 'Esc', Icon: X }
]

export function ItemIcon({ item, size = 17, color = '#ff3b30' }: { item: Item; size?: number; color?: string }) {
  if (item.custom === 'arrow') return <ArrowIcon size={size} />
  if (item.custom === 'background') return <BackgroundIcon size={size} />
  if (item.custom === 'color') return <span className="tb-color" style={{ background: color }} />
  const Icon = item.Icon!
  return <Icon size={size} strokeWidth={2} />
}

interface Props {
  items: Item[]
  vertical?: boolean
  /** Ids drawn as selected, per item id. */
  active?: string[]
  /** Ids with the small green "on" dot. */
  on?: string[]
  className?: string
  style?: CSSProperties
  /** Adds data-tool attributes so a script can light tools up. */
  tagged?: boolean
}

export default function Toolbar({ items, vertical, active = [], on = [], className = '', style, tagged }: Props) {
  return (
    <div className={`tb ${vertical ? 'tb-v' : ''} ${className}`} style={style} aria-hidden="true">
      {items.map((it) => (
        <span key={it.id} className={`tb-btn ${active.includes(it.id) ? 'is-active' : ''}`} data-tool={tagged ? it.id : undefined} title={it.label}>
          <ItemIcon item={it} />
          {on.includes(it.id) && <i className="tb-dot" />}
        </span>
      ))}
    </div>
  )
}
