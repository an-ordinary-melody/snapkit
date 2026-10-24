// Signature 4: the History panel. Click or use the keys like in the app: ↵ copy, E edit, P pin, S save, F star, ⌫ delete.
import { Copy, PencilLine, Pin, RotateCcw, Save, Star, Trash2 } from 'lucide-react'
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import data from '../../data/backgrounds.json'

const GRADIENTS = data.gradients as [string, string][]

type Item = { id: number; g: [string, string]; kind: 'card' | 'chart' | 'chat' | 'code'; marks: 'arrow' | 'steps' | 'blur' | 'none'; ago: string; starred: boolean }

const START: Item[] = [
  { id: 1, g: GRADIENTS[9], kind: 'card', marks: 'arrow', ago: 'Just now', starred: false },
  { id: 2, g: GRADIENTS[17], kind: 'chart', marks: 'steps', ago: '5 min ago', starred: true },
  { id: 3, g: GRADIENTS[12], kind: 'chat', marks: 'blur', ago: '1 h ago', starred: false },
  { id: 4, g: GRADIENTS[18], kind: 'code', marks: 'none', ago: 'Yesterday', starred: false },
  { id: 5, g: GRADIENTS[3], kind: 'card', marks: 'steps', ago: 'Yesterday', starred: true },
  { id: 6, g: GRADIENTS[20], kind: 'chart', marks: 'arrow', ago: '3 days ago', starred: false }
]

/** A tiny made-up capture: a white window with some content and the drawings on it. */
function Thumb({ item }: { item: Item }) {
  return (
    <div className="hs-thumb" style={{ background: `linear-gradient(135deg, ${item.g[0]}, ${item.g[1]})` }}>
      <div className={`hs-win hs-${item.kind}`}>
        <i /><i /><i /><i />
        {item.marks === 'blur' && <span className="hs-blur" />}
      </div>
      {item.marks === 'arrow' && (
        <svg className="hs-arrow" viewBox="0 0 100 70" aria-hidden="true">
          <path d="M86 12 L66 44" />
          <path d="M-7 -4 L0 0 L-7 4" transform="translate(66 44) rotate(122)" />
        </svg>
      )}
      {item.marks === 'steps' && (
        <>
          <span className="hs-step" style={{ left: '22%', top: '24%' }}>1</span>
          <span className="hs-step" style={{ left: '62%', top: '58%' }}>2</span>
        </>
      )}
    </div>
  )
}

const ACTIONS: { key: string; label: string; icon: ReactNode; msg: string }[] = [
  { key: '↵', label: 'Copy', icon: <Copy size={14} />, msg: 'Copied to the clipboard again' },
  { key: 'E', label: 'Edit', icon: <PencilLine size={14} />, msg: 'Opened in the editor, drawings still editable' },
  { key: 'P', label: 'Pin', icon: <Pin size={14} />, msg: 'Pinned on top of every window' },
  { key: 'S', label: 'Save', icon: <Save size={14} />, msg: 'Saved to Pictures/Snapkit' },
  { key: 'F', label: 'Star', icon: <Star size={14} />, msg: '' },
  { key: '⌫', label: 'Delete', icon: <Trash2 size={14} />, msg: 'Deleted' }
]

export default function HistoryDemo() {
  const [items, setItems] = useState(START)
  const [sel, setSel] = useState(0)
  const [toast, setToast] = useState<{ text: string; n: number } | null>(null)
  const timer = useRef(0)
  useEffect(() => () => window.clearTimeout(timer.current), [])

  const say = (text: string) => {
    window.clearTimeout(timer.current)
    setToast((t) => ({ text, n: (t?.n ?? 0) + 1 }))
    timer.current = window.setTimeout(() => setToast(null), 1800)
  }

  const run = (label: string, index = sel) => {
    const item = items[index]
    if (!item) return
    if (label === 'Star') {
      setItems((list) => list.map((x, i) => (i === index ? { ...x, starred: !x.starred } : x)))
      say(item.starred ? 'Unstarred' : 'Starred: the limits never remove it')
      return
    }
    if (label === 'Delete') {
      const next = items.filter((_, i) => i !== index)
      setItems(next)
      setSel(Math.min(index, next.length - 1))
      say('Deleted for good')
      return
    }
    say(ACTIONS.find((a) => a.label === label)!.msg)
  }

  const onKey = (e: KeyboardEvent) => {
    const cols = window.matchMedia('(max-width: 480px)').matches ? 2 : 3
    const move: Record<string, number> = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: cols, ArrowUp: -cols }
    if (e.key in move) {
      e.preventDefault()
      setSel((s) => Math.max(0, Math.min(items.length - 1, s + move[e.key])))
      return
    }
    const byKey: Record<string, string> = { Enter: 'Copy', e: 'Edit', p: 'Pin', s: 'Save', f: 'Star', Delete: 'Delete', Backspace: 'Delete' }
    const label = byKey[e.key.length === 1 ? e.key.toLowerCase() : e.key]
    if (label) {
      e.preventDefault()
      run(label)
    }
  }

  return (
    <div className="hs">
      <div className="hs-panel" tabIndex={0} onKeyDown={onKey} aria-label="History panel demo. Arrow keys pick a capture; Enter, E, P, S, F and Delete act on it.">
        <div className="hs-head">
          <b>History</b>
          <span className="hs-count">{items.length} of 10 kept</span>
          <span className="hs-keys">
            <kbd>⌘</kbd>
            <kbd>⇧</kbd>
            <kbd>1</kbd>
          </span>
        </div>
        {items.length ? (
          <div className="hs-grid" role="listbox" aria-label="Recent captures">
            {items.map((it, i) => (
              <button
                key={it.id}
                type="button"
                role="option"
                aria-selected={i === sel}
                className="hs-item"
                onClick={() => setSel(i)}
                onDoubleClick={() => run('Copy', i)}
              >
                <Thumb item={it} />
                <span className="hs-meta">
                  {it.ago}
                  {it.starred && <Star size={12} fill="#facc15" stroke="#facc15" aria-label="Starred" />}
                </span>
              </button>
            ))}
          </div>
        ) : (
          <div className="hs-empty">
            <p>Everything you copy or save shows up here.</p>
            <button
              type="button"
              onClick={() => {
                setItems(START)
                setSel(0)
              }}
            >
              <RotateCcw size={14} /> Bring the demo back
            </button>
          </div>
        )}
        <div className="hs-actions">
          {ACTIONS.map((a) => (
            <button key={a.label} type="button" onClick={() => run(a.label)} disabled={!items.length}>
              {a.icon}
              <span>{a.label}</span>
              <kbd>{a.key}</kbd>
            </button>
          ))}
        </div>
        {toast && (
          <div className="hs-toast" key={toast.n} role="status">
            {toast.text}
          </div>
        )}
      </div>
    </div>
  )
}
