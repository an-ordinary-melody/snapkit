import {
  Check, Circle, Copy, Droplets, Hash, Highlighter, Pencil, Pin, Redo2, Save, Slash, Square, Type, Undo2, WandSparkles, X,
  type LucideIcon
} from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import type { FeatureDef, FeatureVariant } from '@shared/features'
import { visibleFeatures, type Settings } from '@shared/settings'
import { placeStyleBar, placeToolbars, type Rect, type Size } from './layout'

const ICONS: Record<string, LucideIcon> = {
  pen: Pencil, line: Slash, rect: Square, ellipse: Circle, highlighter: Highlighter, text: Type,
  step: Hash, blur: Droplets, undo: Undo2, redo: Redo2, beautifyEdit: WandSparkles, pin: Pin, save: Save, copy: Copy, close: X
}

/** Icon for a tool variant: the base shape, outlined or filled. */
const VARIANT_ICONS: Record<string, { Icon: LucideIcon; filled: boolean }> = {
  rect: { Icon: Square, filled: false },
  'rect-filled': { Icon: Square, filled: true },
  ellipse: { Icon: Circle, filled: false },
  'ellipse-filled': { Icon: Circle, filled: true },
  line: { Icon: Slash, filled: false }
}

/** Long diagonal arrow, with a solid or an open head. */
function ArrowIcon({ size, open }: { size: number; open: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d={open ? 'M4 20 L19 5' : 'M4 20 L15.5 8.5'} />
      {open ? <path d="M10 5 H19 V14" /> : <path d="M20 4 L11 6.5 L17.5 13 Z" fill="currentColor" />}
    </svg>
  )
}

/** Background: two stacked layers (classic layers icon, rounded); the lower one faintly filled. */
function BackgroundIcon({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M13 19.24a2 2 0 0 1-2 0L2.5 14.37a1 1 0 0 1 0-1.74L11 7.76a2 2 0 0 1 2 0l8.5 4.87a1 1 0 0 1 0 1.74Z" fill="currentColor" fillOpacity={0.35} stroke="none" />
      <path d="m16.02 12 5.48 3.13a1 1 0 0 1 0 1.74L13 21.74a2 2 0 0 1-2 0l-8.5-4.87a1 1 0 0 1 0-1.74L7.98 12" />
      <path d="M13 13.74a2 2 0 0 1-2 0L2.5 8.87a1 1 0 0 1 0-1.74L11 2.26a2 2 0 0 1 2 0l8.5 4.87a1 1 0 0 1 0 1.74Z" />
    </svg>
  )
}

function FeatureIcon({ id, size = 17 }: { id: string; size?: number }) {
  if (id === 'arrow' || id === 'arrow-open') return <ArrowIcon size={size} open={id === 'arrow-open'} />
  if (id === 'beautify') return <BackgroundIcon size={size} />
  const v = VARIANT_ICONS[id]
  const Icon = v?.Icon ?? ICONS[id] ?? Square
  return <Icon size={size} strokeWidth={2} fill={v?.filled ? 'currentColor' : 'none'} />
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
  /** Feature id -> chosen variant id, for tools with variants. */
  variants: Record<string, string>
  onAction(id: string): void
  /** Pick a variant from a tool's right-click menu (also selects the tool). */
  onVariant(featureId: string, variantId: string): void
  /** Ids of buttons showing an "on" dot (e.g. background on). */
  lit: Set<string>
  /** Tooltip text for buttons whose tip depends on state. */
  tips: Record<string, { text: string; sub?: string }>
  /**
   * Docked in the background editor: the drawing tools in a horizontal row
   * with the style bar under it, in normal flow; no action bar.
   */
  docked?: boolean
}

export function Toolbars(props: Props) {
  const { selection, screen, settings, activeTool, color, pressed, unavailable, styleBar, variants, onAction, onVariant, lit, tips, docked } = props
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

  const [menu, setMenu] = useState<{ feature: FeatureDef; el: HTMLElement; vertical: boolean } | null>(null)

  const button = (f: FeatureDef, vertical: boolean) => {
    const off = !f.implemented || unavailable.has(f.id)
    const cls = [f.id === 'copy' && 'primary', (f.id === activeTool || pressed.has(f.id)) && 'active', off && 'off'].filter(Boolean).join(' ')
    const variant: FeatureVariant | undefined = f.variants?.find((v) => v.id === variants[f.id]) ?? f.variants?.[0]
    const label = tips[f.id]?.text ?? variant?.label ?? f.label
    // Not `disabled`: disabled buttons get no hover events, so no tooltip.
    return (
      <button
        key={f.id}
        data-id={f.id}
        data-tip={f.implemented ? label : `${label} (coming soon)`}
        data-hint={f.implemented ? f.hint : undefined}
        data-sub={
          tips[f.id]?.sub ??
          ([f.tipNote, f.variants && (f.variantsHint ?? 'Right-click for more options')].filter(Boolean).join(' · ') || undefined)
        }
        aria-disabled={off}
        className={cls}
        onClick={() => !off && onAction(f.id)}
        onContextMenu={(e) => {
          e.preventDefault()
          e.stopPropagation()
          if (f.variants && !off) {
            setTip(null)
            setMenu({ feature: f, el: e.currentTarget, vertical })
          }
        }}
      >
        {f.id === 'color' ? <span className="color-box" style={{ background: color }} /> : <FeatureIcon id={variant?.id ?? f.id} />}
        {f.variants && <span className="more-mark" />}
        {lit.has(f.id) && <span className="on-dot" />}
      </button>
    )
  }

  // Right-clicks anywhere on the bars must not cancel the capture.
  const noMenu = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
  }

  // Stop mouse-downs on the bars from starting a new selection underneath, and
  // (except on inputs like the blur slider) from taking focus away from a text
  // box being typed in.
  const stop = (e: React.PointerEvent | React.MouseEvent) => {
    e.stopPropagation()
    if (!(e.target instanceof HTMLInputElement)) e.preventDefault()
  }

  // ---- tooltips ----
  const [tip, setTip] = useState<{ text: string; hint?: string; sub?: string; el: HTMLElement; vertical: boolean } | null>(null)
  const tipHandlers = (vertical: boolean) => ({
    onMouseOver: (e: React.MouseEvent) => {
      if (menu) return
      const el = (e.target as HTMLElement).closest<HTMLElement>('[data-tip]')
      if (el && el !== tip?.el) setTip({ text: el.dataset.tip!, hint: el.dataset.hint, sub: el.dataset.sub, el, vertical })
      else if (!el && tip) setTip(null)
    },
    onMouseLeave: () => setTip(null),
    onContextMenu: noMenu
  })

  const overlays = (
    <>
      {tip && !menu && tip.el.isConnected && <Tooltip {...tip} screen={screen} />}
      {menu && menu.el.isConnected && (
        <VariantMenu
          {...menu}
          screen={screen}
          current={variants[menu.feature.id] ?? menu.feature.variants![0].id}
          onPick={(v) => {
            setMenu(null)
            onVariant(menu.feature.id, v)
          }}
          onClose={() => setMenu(null)}
        />
      )}
    </>
  )

  const copyFeature = actions.find((f) => f.id === 'copy')
  if (docked) {
    return (
      <>
        {tools.length > 0 && (
          <div className="toolbar docked" onPointerDown={stop} onMouseDown={stop} {...tipHandlers(false)}>
            {tools.map((f) => button(f, false))}
            {/* Copy is one click away while editing, too. */}
            {copyFeature && <span className="dock-sep" />}
            {copyFeature && button(copyFeature, false)}
          </div>
        )}
        {styleBar && (
          <div className="toolbar style-bar docked" onPointerDown={stop} onMouseDown={stop} {...tipHandlers(false)}>
            {styleBar}
          </div>
        )}
        {overlays}
      </>
    )
  }

  return (
    <>
      {tools.length > 0 && (
        <div className="toolbar vertical" style={{ left: layout.tools.x, top: layout.tools.y }} onPointerDown={stop} onMouseDown={stop} {...tipHandlers(true)}>
          {tools.map((f) => button(f, true))}
        </div>
      )}
      {actions.length > 0 && (
        <div className="toolbar" style={{ left: layout.actions.x, top: layout.actions.y }} onPointerDown={stop} onMouseDown={stop} {...tipHandlers(false)}>
          {actions.map((f) => button(f, false))}
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
      {overlays}
    </>
  )
}

/** Beside a vertical bar's button, or below/above a horizontal one's, kept on screen. */
function popoverStyle(el: HTMLElement, vertical: boolean, screen: Size, w: number, h: number): React.CSSProperties {
  const r = el.getBoundingClientRect()
  const GAP = 8
  if (vertical) {
    const right = r.right + GAP + w < screen.w
    return {
      top: Math.min(Math.max(r.top + r.height / 2, h / 2 + 6), screen.h - h / 2 - 6),
      left: right ? r.right + GAP : r.left - GAP,
      transform: right ? 'translateY(-50%)' : 'translate(-100%, -50%)'
    }
  }
  const below = r.bottom + GAP + h < screen.h
  return {
    left: Math.min(Math.max(r.left + r.width / 2, w / 2 + 6), screen.w - w / 2 - 6),
    top: below ? r.bottom + GAP : r.top - GAP,
    transform: below ? 'translateX(-50%)' : 'translate(-50%, -100%)'
  }
}

function VariantMenu(props: {
  feature: FeatureDef
  el: HTMLElement
  vertical: boolean
  screen: Size
  current: string
  onPick(id: string): void
  onClose(): void
}) {
  const { feature, el, vertical, screen, current, onPick, onClose } = props
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose()
    }
    // Esc closes the menu, not the capture.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      e.stopImmediatePropagation()
      onClose()
    }
    window.addEventListener('pointerdown', onDown, true)
    window.addEventListener('keydown', onKey, true)
    return () => {
      window.removeEventListener('pointerdown', onDown, true)
      window.removeEventListener('keydown', onKey, true)
    }
  }, [onClose])
  const items = feature.variants!
  return (
    <div
      ref={ref}
      className="variant-menu"
      style={popoverStyle(el, vertical, screen, 190, items.length * 32 + 8)}
      onPointerDown={(e) => {
        e.stopPropagation()
        e.preventDefault()
      }}
      onContextMenu={(e) => {
        e.preventDefault()
        e.stopPropagation()
      }}
    >
      {items.map((v) => (
        <button key={v.id} className={v.id === current ? 'current' : ''} onClick={() => onPick(v.id)}>
          <FeatureIcon id={v.id} size={16} />
          <span>{v.label}</span>
          {v.id === current && <Check size={14} className="check" />}
        </button>
      ))}
    </div>
  )
}

/** Tooltip beside a vertical bar, or below/above a horizontal one, kept on screen. */
function Tooltip({ text, hint, sub, el, vertical, screen }: { text: string; hint?: string; sub?: string; el: HTMLElement; vertical: boolean; screen: Size }) {
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
      <div className="tip-row">
        {text}
        {hint && <kbd>{hint}</kbd>}
      </div>
      {sub && <div className="tip-sub">{sub}</div>}
    </div>
  )
}
