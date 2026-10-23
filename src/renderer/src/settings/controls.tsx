import { useEffect, useState, type ReactNode } from 'react'
import { parseHex } from '../overlay/annotate/color'
import { ColorPicker } from '../overlay/annotate/ColorPicker'
import { Slider } from '../overlay/Slider'

/** A titled group of rows, like a card in System Settings. */
export function Group({ title, note, children }: { title?: string; note?: string; children: ReactNode }) {
  return (
    <section className="st-group">
      {title && <h3>{title}</h3>}
      <div className="st-card">{children}</div>
      {note && <p className="st-note">{note}</p>}
    </section>
  )
}

/** One setting: label (and an optional description) on the left, its control on the right. */
export function Row({ label, desc, children, disabled }: { label: string; desc?: string; children?: ReactNode; disabled?: boolean }) {
  return (
    <div className={`st-row${disabled ? ' disabled' : ''}`}>
      <div className="st-label">
        <span>{label}</span>
        {desc && <small>{desc}</small>}
      </div>
      <div className="st-control">{children}</div>
    </div>
  )
}

export function Toggle({ value, onChange, label, disabled }: { value: boolean; onChange(v: boolean): void; label: string; disabled?: boolean }) {
  return (
    <button
      role="switch"
      aria-checked={value}
      aria-label={label}
      disabled={disabled}
      className={`switch${value ? ' on' : ''}`}
      onClick={() => onChange(!value)}
    >
      <span />
    </button>
  )
}

export function Segmented<T extends string>(props: { value: T; options: { value: T; label: string }[]; onChange(v: T): void; label: string }) {
  const { value, options, onChange, label } = props
  return (
    <div className="st-seg" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} role="radio" aria-checked={o.value === value} className={o.value === value ? 'active' : ''} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

/** Swatch that opens the color picker, plus the hex value. */
export function ColorField({ value, onChange, label }: { value: string; onChange(c: string): void; label: string }) {
  const [open, setOpen] = useState(false)
  const [text, setText] = useState(value)
  useEffect(() => setText(value), [value])
  return (
    <div className="st-color">
      <div className="picker-anchor">
        <button className="st-swatch" aria-label={`${label}: pick a color`} onClick={() => setOpen(!open)}>
          <span style={{ background: value }} />
        </button>
        {open && <ColorPicker color={value} onChange={onChange} onClose={() => setOpen(false)} />}
      </div>
      <input
        className="st-input mono"
        aria-label={label}
        value={text.toUpperCase()}
        maxLength={7}
        spellCheck={false}
        onChange={(e) => {
          setText(e.target.value)
          const c = parseHex(e.target.value)
          if (c) onChange(c)
        }}
        onBlur={() => setText(value)}
      />
    </div>
  )
}

export function NumberField(props: { value: number; min: number; max: number; step?: number; onChange(v: number): void; label: string; unit?: string }) {
  const { value, min, max, step = 1, onChange, label, unit } = props
  const [text, setText] = useState(String(value))
  useEffect(() => setText(String(value)), [value])
  return (
    <span className="st-number">
      <input
        className="st-input"
        type="number"
        aria-label={label}
        min={min}
        max={max}
        step={step}
        value={text}
        onChange={(e) => {
          setText(e.target.value)
          const v = Number(e.target.value)
          if (e.target.value !== '' && v >= min && v <= max) onChange(v)
        }}
        onBlur={() => setText(String(value))}
      />
      {unit && <span className="st-unit">{unit}</span>}
    </span>
  )
}

/** Slider with its value shown next to it. */
export function SliderField(props: { value: number; min: number; max: number; step?: number; onChange(v: number): void; label: string; format?(v: number): string }) {
  const { value, min, max, step = 1, onChange, label, format = String } = props
  return (
    <span className="st-slider">
      <Slider label={label} min={min} max={max} step={step} value={value} onChange={onChange} />
      <span className="st-value">{format(value)}</span>
    </span>
  )
}

// ---- hotkeys -----------------------------------------------------------------

const isMac = window.snapkit.platform === 'darwin'

/** Accelerator key name for a key code, layout-independent ('KeyA' -> 'A'). */
function keyName(code: string): string | null {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3)
  if (/^Digit[0-9]$/.test(code)) return code.slice(5)
  if (/^F([1-9]|1[0-9]|2[0-4])$/.test(code)) return code
  const named: Record<string, string> = {
    Space: 'Space', Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Backslash: '\\', Semicolon: ';',
    Quote: "'", Comma: ',', Period: '.', Slash: '/', Backquote: '`', ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right'
  }
  return named[code] ?? null
}

/** '⌘⇧2' on macOS, 'Ctrl+Shift+2' elsewhere. */
export function formatAccelerator(acc: string) {
  const parts = acc.split('+')
  if (!isMac) return parts.map((p) => (p === 'CommandOrControl' || p === 'Command' ? 'Ctrl' : p)).join('+')
  const sym: Record<string, string> = { CommandOrControl: '⌘', Command: '⌘', Control: '⌃', Ctrl: '⌃', Alt: '⌥', Option: '⌥', Shift: '⇧' }
  return parts.map((p) => sym[p] ?? p).join('')
}

/** Click, then press the new shortcut. Esc cancels. Needs a modifier (except F-keys). */
export function HotkeyField({ value, onChange }: { value: string; onChange(acc: string): Promise<string | null> }) {
  const [recording, setRecording] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    if (!recording) return
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault()
      e.stopPropagation()
      if (e.key === 'Escape') return setRecording(false)
      const key = keyName(e.code)
      if (!key) return // a modifier on its own: keep waiting
      const mods = [
        (isMac ? e.metaKey : e.ctrlKey) && 'CommandOrControl',
        isMac && e.ctrlKey && 'Control',
        e.altKey && 'Alt',
        e.shiftKey && 'Shift'
      ].filter(Boolean) as string[]
      if (!mods.length && !/^F\d+$/.test(key)) return setError('Add ⌘, ⌥, ⌃ or ⇧ (or use an F-key).')
      setRecording(false)
      void onChange([...mods, key].join('+')).then(setError)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [recording, onChange])
  return (
    <span className="st-hotkey-wrap">
      <button className={`st-hotkey${recording ? ' recording' : ''}`} onClick={() => (setError(null), setRecording(!recording))}>
        {recording ? 'Press the new shortcut…' : value ? formatAccelerator(value) : 'None'}
      </button>
      {error && <small className="st-error">{error}</small>}
    </span>
  )
}
