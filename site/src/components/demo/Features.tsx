// "Everything in detail": tabs down the side, a small demo for each.
import {
  Circle, Copy, Crop, Droplets, Hash, Highlighter, Monitor, Palette, PencilLine, Pencil, Pin, Ruler, Slash, Square, Type,
  WandSparkles, Magnet, Shuffle, type LucideIcon
} from 'lucide-react'
import { useId, useState, type ReactNode } from 'react'
import data from '../../data/backgrounds.json'
import Scaled from './Scaled'
import { Desk, PlanCard } from './Shot'
import Toolbar, { ArrowIcon, TOOLS } from './Toolbar'

const GRADIENTS = data.gradients as [string, string][]
const grad = (g: [string, string], a = 135) => `linear-gradient(${a}deg, ${g[0]}, ${g[1]})`

type Tab = { id: string; label: string; Icon: LucideIcon; title: string; body: ReactNode; demo: () => ReactNode }

const K = ({ children }: { children: ReactNode }) => <kbd className="kbd">{children}</kbd>

/* ---------- demos ---------- */

function CaptureDemo() {
  return (
    <div className="fx-capture">
      <div className="fx-mini-screen" style={{ aspectRatio: '960 / 600' }}>
        <Scaled w={960} h={600}>
          <Desk />
        </Scaled>
        <div className="fx-nudge">
          <span className="size-label" style={{ left: 0, top: -24 }}>
            480 × 300
          </span>
        </div>
      </div>
      <div className="fx-modes">
        <div>
          <Crop size={16} /> <b>Area</b> <span className="fx-keys"><K>⌥</K><K>⇧</K><K>Z</K></span>
        </div>
        <div>
          <Monitor size={16} /> <b>Full screen</b> <span className="fx-keys"><K>⌘</K><K>⇧</K><K>9</K></span>
        </div>
        <div>
          <Ruler size={16} /> <b>Nudge</b> <span className="fx-keys"><K>←</K><K>→</K> <small>Shift ×10 · Alt resizes</small></span>
        </div>
      </div>
    </div>
  )
}

const ALL_TOOLS: { name: string; key: string; icon: ReactNode; note?: string }[] = [
  { name: 'Pencil', key: 'P', icon: <Pencil size={18} />, note: 'Shift for straight' },
  { name: 'Line', key: 'L', icon: <Slash size={18} /> },
  { name: 'Arrow', key: 'A', icon: <ArrowIcon size={18} />, note: 'Right-click: two-way' },
  { name: 'Rectangle', key: 'R', icon: <Square size={18} />, note: 'Right-click: filled' },
  { name: 'Ellipse', key: 'E', icon: <Circle size={18} /> },
  { name: 'Highlighter', key: 'H', icon: <Highlighter size={18} /> },
  { name: 'Text', key: 'T', icon: <Type size={18} />, note: '4 styles' },
  { name: 'Numbered step', key: 'N', icon: <Hash size={18} />, note: 'Counts itself' },
  { name: 'Blur', key: 'B', icon: <Droplets size={18} />, note: 'Or pixelate' }
]

function AnnotateGrid() {
  return (
    <div className="fx-tools">
      {ALL_TOOLS.map((t) => (
        <div key={t.name} className="fx-tool">
          <span className="fx-tool-ic">{t.icon}</span>
          <b>{t.name}</b>
          <K>{t.key}</K>
          {t.note && <small>{t.note}</small>}
        </div>
      ))}
      <div className="fx-tool fx-tool-wide">
        <b>Undo / redo</b>
        <span className="fx-keys"><K>⌘</K><K>Z</K> · <K>⇧</K><K>⌘</K><K>Z</K></span>
        <small>Every shape stays editable: move, resize, recolor, delete</small>
      </div>
    </div>
  )
}

function AlignDemo() {
  return (
    <div className="fx-align">
      <div className="fx-box fx-box-a">Title</div>
      <div className="fx-box fx-box-b">
        <span className="step-badge" style={{ position: 'static', width: 22, height: 22, fontSize: 12 }}>1</span> Drag me
      </div>
      <div className="fx-box fx-box-c">Button</div>
      <i className="fx-guide fx-guide-v" />
      <i className="fx-guide fx-guide-h" />
      <p className="fx-caption">Pink guides snap shapes to each other and to the capture edges. Hold <K>⌘</K> to place freely.</p>
    </div>
  )
}

function TextDemo() {
  return (
    <div className="fx-text" style={{ background: grad(['#a1c4fd', '#c2e9fb']) }}>
      <span className="fx-t fx-t-plain">Plain text</span>
      <span className="fx-t fx-t-stroke">With a stroke</span>
      <span className="fx-t fx-t-light">Light background</span>
      <span className="fx-t fx-t-dark">Dark background</span>
      <p className="fx-caption">Click to type, click again to edit, drag the frame to move it. A soft shadow keeps text readable.</p>
    </div>
  )
}

function EditorDemo() {
  const [g, setG] = useState(GRADIENTS[9])
  return (
    <div className="fx-editor">
      <div className="fx-ed-view" style={{ background: grad(g) }}>
        <Scaled w={472} h={262} style={{ width: '72%' }}>
          <PlanCard style={{ boxShadow: '0 20px 50px rgba(0,0,0,.3)', borderRadius: 12 }} />
        </Scaled>
        <span className="fx-zoom">100%</span>
      </div>
      <div className="fx-ed-side">
        <div className="fx-seg"><span className="on">Gradient</span><span>Color</span><span className="off">Image</span></div>
        <div className="fx-hex">
          <span><i style={{ background: g[0] }} />{g[0]}</span>
          <span><i style={{ background: g[1] }} />{g[1]}</span>
          <button type="button" aria-label="Random gradient" onClick={() => setG(GRADIENTS[Math.floor(Math.random() * GRADIENTS.length)])}>
            <Shuffle size={14} />
          </button>
        </div>
        <div className="fx-hue" />
        <div className="fx-grid">
          {GRADIENTS.map((x) => (
            <button key={x.join()} type="button" aria-label={`Gradient ${x[0]} to ${x[1]}`} aria-pressed={x === g} style={{ background: grad(x) }} onClick={() => setG(x)} />
          ))}
        </div>
      </div>
    </div>
  )
}

function PreviewDemo() {
  return (
    <div className="fx-preview">
      <div className="fx-mini-screen fx-plain">
        <div className="fx-pin">
          <div className="fx-pin-bar">
            <span>−</span><span>100%</span><span>+</span><span className="fx-sep" /><span>Opacity 80%</span>
          </div>
          <div className="fx-pin-img" style={{ background: grad(['#fb923c', '#ec4899']) }}>
            <i />
          </div>
        </div>
        <div className="fx-thumb" style={{ background: grad(['#f83600', '#f9d423']) }}>
          <i />
          <div className="fx-thumb-btns">
            <span><Copy size={11} /> Copy</span>
            <span><PencilLine size={11} /> Edit</span>
          </div>
          <span className="fx-thumb-pin"><Pin size={11} /></span>
        </div>
      </div>
      <p className="fx-caption">
        After a copy, the result waits in the corner: drag it into another app, or reopen it with your drawings still editable. Pin it to keep it on top
        of everything, with zoom and opacity.
      </p>
    </div>
  )
}

const THEMES = [
  { id: 'light', label: 'Light', bg: 'rgba(248,248,250,.96)', fg: '#1c1c1e' },
  { id: 'gray', label: 'Gray', bg: 'rgba(58,58,62,.96)', fg: '#f2f2f4' },
  { id: 'dark', label: 'Dark', bg: 'rgba(28,28,31,.94)', fg: '#f2f2f4' }
]
const ACCENTS = ['#0a84ff', '#ff375f', '#30d158', '#ff9f0a', '#bf5af2']

function ThemeDemo() {
  const [theme, setTheme] = useState(THEMES[2])
  const [accent, setAccent] = useState(ACCENTS[0])
  const [glass, setGlass] = useState(false)
  const name = useId()
  return (
    <div className="fx-theme">
      <div className="fx-theme-view" style={{ background: grad(['#ff5f6d', '#ffc371']) }}>
        <div className="fx-theme-shapes"><i /><i /><i /></div>
        <div
          style={{
            ['--ui-bg' as string]: glass ? (theme.id === 'light' ? 'rgba(255,255,255,.45)' : 'rgba(30,30,34,.4)') : theme.bg,
            ['--ui-fg' as string]: theme.fg,
            ['--ui-active' as string]: accent
          }}
        >
          <Toolbar items={TOOLS.slice(0, 7)} active={['arrow']} className={glass ? 'tb-glass' : ''} />
        </div>
      </div>
      <div className="fx-theme-ctl">
        <div className="fx-seg" role="radiogroup" aria-label="Theme">
          {THEMES.map((t) => (
            <label key={t.id} className={t.id === theme.id ? 'on' : ''}>
              <input type="radio" name={name} checked={t.id === theme.id} onChange={() => setTheme(t)} /> {t.label}
            </label>
          ))}
        </div>
        <div className="fx-accents" role="radiogroup" aria-label="Highlight color">
          {ACCENTS.map((a) => (
            <button key={a} type="button" role="radio" aria-checked={a === accent} aria-label={`Highlight ${a}`} style={{ background: a }} onClick={() => setAccent(a)} />
          ))}
        </div>
        <label className="fx-glass">
          <input type="checkbox" role="switch" checked={glass} onChange={() => setGlass(!glass)} />
          <i className="wf-switch" aria-hidden="true" /> Liquid Glass
        </label>
      </div>
    </div>
  )
}

/* ---------- tabs ---------- */

const TABS: Tab[] = [
  {
    id: 'capture', label: 'Capture', Icon: Crop, title: 'Freeze, select, done',
    body: <>The screen freezes the moment you press the hotkey, so menus and tooltips stay put. Drag an area, move and resize it, nudge it with the arrow keys. Full screen goes straight to the floating preview.</>,
    demo: CaptureDemo
  },
  {
    id: 'annotate', label: 'Annotate', Icon: Pencil, title: 'Nine tools, one key each',
    body: <>Press a letter to pick a tool, press it again to go back to moving the selection. Buttons with a corner mark have more shapes on right-click.</>,
    demo: AnnotateGrid
  },
  {
    id: 'align', label: 'Smart align', Icon: Magnet, title: 'Things line up by themselves',
    body: <>While you drag a shape, or a text box you're still typing in, it snaps to line up with the others and with the edges of the capture.</>,
    demo: AlignDemo
  },
  {
    id: 'text', label: 'Text', Icon: Type, title: 'Text that reads on anything',
    body: <>Four styles: plain, stroke, light background or dark background, each with its own color. Text keeps its own color, apart from the other tools.</>,
    demo: TextDemo
  },
  {
    id: 'editor', label: 'Background editor', Icon: WandSparkles, title: 'A full editor when you need it',
    body: <>Live preview with every drawing tool, editable hex values, a hue slider and a random button, 32 gradient and 32 color presets, output sizes, and zoom with <K>⌘</K>+scroll. Try the swatches.</>,
    demo: EditorDemo
  },
  {
    id: 'preview', label: 'Preview & pins', Icon: Pin, title: 'Keep it close',
    body: <>A small preview after each copy, like Shottr. Turn it into a pin that floats above every window and Space, even full-screen apps.</>,
    demo: PreviewDemo
  },
  {
    id: 'theme', label: 'Make it yours', Icon: Palette, title: 'Looks the way you like',
    body: <>Light, Gray, Dark or System, a highlight color, and optional Liquid Glass. Reorder or hide any toolbar button, change any shortcut. Try it here.</>,
    demo: ThemeDemo
  }
]

export default function Features() {
  const [tab, setTab] = useState(TABS[0])
  const id = useId()
  const Demo = tab.demo
  return (
    <div className="fx">
      <div className="fx-tabs" role="tablist" aria-label="Features" aria-orientation="vertical">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            id={`${id}-${t.id}`}
            aria-selected={t.id === tab.id}
            aria-controls={`${id}-panel`}
            tabIndex={t.id === tab.id ? 0 : -1}
            onClick={() => setTab(t)}
            onKeyDown={(e) => {
              const i = TABS.indexOf(tab)
              const next = e.key === 'ArrowDown' || e.key === 'ArrowRight' ? i + 1 : e.key === 'ArrowUp' || e.key === 'ArrowLeft' ? i - 1 : null
              if (next === null) return
              e.preventDefault()
              const t2 = TABS[(next + TABS.length) % TABS.length]
              setTab(t2)
              document.getElementById(`${id}-${t2.id}`)?.focus()
            }}
          >
            <t.Icon size={17} /> {t.label}
          </button>
        ))}
      </div>
      <div className="fx-panel" role="tabpanel" id={`${id}-panel`} aria-labelledby={`${id}-${tab.id}`} key={tab.id}>
        <div className="fx-copy">
          <h3>{tab.title}</h3>
          <p>{tab.body}</p>
        </div>
        <div className="fx-demo">
          <Demo />
        </div>
      </div>
    </div>
  )
}
