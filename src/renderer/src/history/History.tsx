import { Copy, FolderOpen, X, PencilLine, Pin, Save, Settings2, Star, Trash2 } from 'lucide-react'
import { OcrIcon } from '../icons'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { HistoryItem } from '@shared/ipc'
import { applyTheme } from '../theme'

const api = window.snapkit
const isMac = /Mac/.test(navigator.userAgent)
type Action = 'copy' | 'edit' | 'pin' | 'save' | 'delete' | 'star' | 'unstar'

/** Thumbnail URLs by entry id, loaded once (lazily, as cards scroll into view). */
const thumbs = new Map<string, Promise<string | null>>()
function thumbUrl(id: string) {
  let p = thumbs.get(id)
  if (!p) {
    p = api.historyThumb(id).then((b) => (b ? URL.createObjectURL(new Blob([b as BlobPart], { type: 'image/jpeg' })) : null))
    thumbs.set(id, p)
  }
  return p
}

function ago(t: number) {
  const s = Math.round((Date.now() - t) / 1000)
  if (s < 60) return 'Just now'
  if (s < 3600) return `${Math.floor(s / 60)} min ago`
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`
  return new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

const mb = (b: number) => (b < 1024 * 1024 ? `${Math.max(1, Math.round(b / 1024))} KB` : `${(b / 1024 / 1024).toFixed(1)} MB`)

/**
 * History panel: past captures, newest first. Click (or Enter) copies; hover
 * for edit / pin / save / star / delete. Arrows move, Esc closes.
 */
export function History() {
  const [items, setItems] = useState<HistoryItem[]>([])
  const [recording, setRecording] = useState(true)
  /** The Clear menu: closed, open, or waiting for a second click to clear everything. */
  const [clearing, setClearing] = useState<null | 'menu' | 'confirm-all'>(null)
  const [sel, setSel] = useState(0)
  const itemsRef = useRef(items)
  itemsRef.current = items
  const selRef = useRef(sel)
  selRef.current = sel

  useEffect(() => {
    document.documentElement.classList.add('history-page')
    const theme = () =>
      void api.settingsGet().then((s) => {
        applyTheme(s.settings.appearance)
        setRecording(!s.settings.history.paused)
      })
    theme()
    void api.historyList().then(setItems)
    api.onHistoryChanged((next) => {
      setItems(next)
      setSel(0) // opened again (or changed): start at the newest
      theme()
    })
  }, [])

  const act = useCallback((a: Action, id = itemsRef.current[selRef.current]?.id) => id && api.historyAction(id, a), [])
  /** Copy text: the panel closes when text is copied; otherwise the footer says why. */
  const [note, setNote] = useState<string | null>(null)
  const copyText = useCallback((id = itemsRef.current[selRef.current]?.id) => {
    if (!id) return
    setNote('Reading text…')
    void api.historyCopyText(id).then((n) => {
      setNote(n > 0 ? null : n === 0 ? 'No text found' : "Couldn't read the text")
      if (n <= 0) setTimeout(() => setNote(null), 1800)
    })
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const n = itemsRef.current.length
      // As many columns as fit the window's width.
      const grid = document.querySelector('.hist-grid')
      const cols = grid ? getComputedStyle(grid).gridTemplateColumns.split(' ').length : 4
      const k = e.key
      if (k === 'Escape') return api.historyClose()
      if (!n) return
      const s = selRef.current
      if (k === 'ArrowRight') setSel(Math.min(n - 1, s + 1))
      else if (k === 'ArrowLeft') setSel(Math.max(0, s - 1))
      else if (k === 'ArrowDown') setSel(Math.min(n - 1, s + cols))
      else if (k === 'ArrowUp') setSel(Math.max(0, s - cols))
      else if (k === 'Enter' || ((e.metaKey || e.ctrlKey) && k.toLowerCase() === 'c')) act('copy')
      else if (k.toLowerCase() === 'e') act('edit')
      else if (k.toLowerCase() === 't') copyText()
      else if (k.toLowerCase() === 'p') act('pin')
      else if (k.toLowerCase() === 's') act('save')
      else if (k.toLowerCase() === 'f') act(itemsRef.current[s].starred ? 'unstar' : 'star')
      else if (k === 'Backspace' || k === 'Delete') act('delete')
      else return
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [act, copyText])

  const total = items.reduce((n, i) => n + i.bytes, 0)
  return (
    <div className="hist">
      <header className={`hist-head${isMac ? '' : ' no-traffic-lights'}`}>
        <span className="hist-title">History</span>
        <span className="hist-meta">{items.length ? `${items.length} · ${mb(total)}` : ''}</span>
        <label className="hist-record" title="Record new copies, saves and pins">
          <button
            role="switch"
            aria-checked={recording}
            aria-label="Record history"
            className={`switch${recording ? ' on' : ''}`}
            onClick={() => {
              setRecording(!recording)
              void api.settingsUpdate({ history: { paused: recording } })
            }}
          >
            <span />
          </button>
          {recording ? 'Recording' : 'Paused'}
        </label>
        <span className="hist-tools">
          <span className="hist-clear-anchor">
            <button className="hist-clear" aria-label="Clear history" disabled={!items.length} onClick={() => setClearing(clearing ? null : 'menu')}>
              <Trash2 size={14} /> Clear History
            </button>
            {clearing && (
              <div className="hist-clear-menu" role="menu">
                <button
                  role="menuitem"
                  disabled={!items.some((i) => !i.starred)}
                  onClick={() => void api.historyClear(true).then(() => setClearing(null))}
                >
                  Clear, keep starred
                </button>
                <button
                  role="menuitem"
                  className="danger"
                  onClick={() => (clearing === 'confirm-all' ? void api.historyClear(false).then(() => setClearing(null)) : setClearing('confirm-all'))}
                >
                  {clearing === 'confirm-all' ? 'Click again to delete all' : 'Clear all…'}
                </button>
              </div>
            )}
          </span>
          <button aria-label="Show the history folder" title="Show the history folder" onClick={() => api.historyReveal()}>
            <FolderOpen size={15} />
          </button>
          <button aria-label="History settings" title="Settings" onClick={() => api.openSettings()}>
            <Settings2 size={15} />
          </button>
          {/* macOS has the window's own close button; Windows gets one here. */}
          {!isMac && (
            <button aria-label="Close history" title="Close (Esc)" onClick={() => api.historyClose()}>
              <X size={16} />
            </button>
          )}
        </span>
      </header>
      {items.length === 0 ? (
        <div className="hist-empty">
          <p>No captures yet.</p>
          <p className="hist-hint">Copies and saves show up here to reuse.</p>
        </div>
      ) : (
        <div className="hist-grid" role="listbox" aria-label="Past captures">
          {items.map((it, i) => (
            <Card key={it.id} item={it} selected={i === sel} onSelect={() => setSel(i)} act={(a) => act(a, it.id)} copyText={() => copyText(it.id)} />
          ))}
        </div>
      )}
      <footer className="hist-foot">
        {note ?? (
          <>
            <kbd>↵</kbd> copy <kbd>T</kbd> text <kbd>E</kbd> edit <kbd>P</kbd> pin <kbd>S</kbd> save <kbd>F</kbd> star <kbd>⌫</kbd> delete <kbd>Esc</kbd> close
          </>
        )}
      </footer>
    </div>
  )
}

function Card({ item, selected, onSelect, act, copyText }: { item: HistoryItem; selected: boolean; onSelect(): void; act(a: Action): void; copyText(): void }) {
  const ref = useRef<HTMLDivElement>(null)
  const [src, setSrc] = useState<string | null>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const io = new IntersectionObserver((e) => {
      if (e[0].isIntersecting) {
        void thumbUrl(item.id).then(setSrc)
        io.disconnect()
      }
    })
    io.observe(el)
    return () => io.disconnect()
  }, [item.id, item.updatedAt])
  useEffect(() => {
    if (selected) ref.current?.scrollIntoView({ block: 'nearest' })
  }, [selected])
  // An updated entry (re-edited) has a new thumbnail.
  useEffect(() => () => void thumbs.delete(item.id), [item.updatedAt, item.id])

  return (
    <div
      ref={ref}
      role="option"
      aria-selected={selected}
      className={`hist-card${selected ? ' selected' : ''}`}
      onMouseEnter={onSelect}
      onClick={() => act('copy')}
      title="Click to copy, or drag into another app"
    >
      <div className="hist-thumb">
        {src && (
          <img
            src={src}
            alt=""
            draggable
            onDragStart={(e) => {
              e.preventDefault()
              api.historyDragOut(item.id)
            }}
          />
        )}
      </div>
      <div className="hist-info">
        <span>{ago(item.updatedAt)}</span>
        <span className="hist-size">
          {item.width} × {item.height}
        </span>
      </div>
      <button
        className={`hist-star${item.starred ? ' on' : ''}`}
        aria-label={item.starred ? 'Unstar' : 'Star to keep'}
        title={item.starred ? 'Starred: kept' : 'Star to keep'}
        onClick={(e) => {
          e.stopPropagation()
          act(item.starred ? 'unstar' : 'star')
        }}
      >
        <Star size={13} fill={item.starred ? 'currentColor' : 'none'} />
      </button>
      <div className="hist-actions" onClick={(e) => e.stopPropagation()}>
        <button aria-label="Copy" title="Copy (↵)" onClick={() => act('copy')}>
          <Copy size={14} />
        </button>
        <button
          aria-label="Copy text"
          title="Copy text (T)"
          onClick={copyText}
        >
          <OcrIcon size={14} />
        </button>
        <button aria-label="Edit" title="Edit (E)" onClick={() => act('edit')}>
          <PencilLine size={14} />
        </button>
        <button aria-label="Pin" title="Pin (P)" onClick={() => act('pin')}>
          <Pin size={14} />
        </button>
        <button aria-label="Save" title="Save (S)" onClick={() => act('save')}>
          <Save size={14} />
        </button>
        <button aria-label="Delete" title="Delete (⌫)" onClick={() => act('delete')}>
          <Trash2 size={14} />
        </button>
      </div>
    </div>
  )
}
