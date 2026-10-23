import { Images, Info, Keyboard, PanelsTopLeft, PenTool, RotateCcw, SlidersHorizontal, SunMoon, type LucideIcon } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import type { SettingsSnapshot } from '@shared/ipc'
import type { Settings as SettingsT, SettingsPatch } from '@shared/settings'
import { applyTheme } from '../theme'
import { About, Appearance, General, Shortcuts } from './basic'
import { BackgroundSection } from './background'
import { ToolbarSection, ToolsSection } from './tools'
import './settings.css'

const api = window.snapkit

export interface SectionProps {
  snap: SettingsSnapshot
  /** Save a change (any depth). */
  set(patch: SettingsPatch): void
}

const SECTIONS: { id: string; label: string; icon: LucideIcon; keys: (keyof SettingsT)[]; view(p: SectionProps): JSX.Element }[] = [
  { id: 'general', label: 'General', icon: SlidersHorizontal, keys: ['pin', 'save', 'notifications'], view: (p) => <General {...p} /> },
  { id: 'shortcuts', label: 'Shortcuts', icon: Keyboard, keys: ['hotkeys', 'toolKeys'], view: (p) => <Shortcuts {...p} /> },
  { id: 'appearance', label: 'Appearance', icon: SunMoon, keys: ['appearance', 'capture'], view: (p) => <Appearance {...p} /> },
  { id: 'toolbar', label: 'Toolbar', icon: PanelsTopLeft, keys: ['features', 'toolbarOrder'], view: (p) => <ToolbarSection {...p} /> },
  { id: 'tools', label: 'Tools', icon: PenTool, keys: ['annotate', 'toolVariants'], view: (p) => <ToolsSection {...p} /> },
  { id: 'background', label: 'Background', icon: Images, keys: ['beautify'], view: (p) => <BackgroundSection {...p} /> },
  { id: 'about', label: 'About', icon: Info, keys: [], view: (p) => <About {...p} /> }
]

/** The settings window: a sidebar of sections; every change is saved and applied right away. */
export function Settings() {
  const [snap, setSnap] = useState<SettingsSnapshot | null>(null)
  const [section, setSection] = useState('general')

  useEffect(() => {
    document.documentElement.classList.add('settings-page')
    void api.settingsGet().then(setSnap)
    api.onSettingsChanged(setSnap)
  }, [])
  useEffect(() => {
    if (snap) applyTheme(snap.settings.appearance)
  }, [snap])

  const set = useCallback((patch: SettingsPatch) => void api.settingsUpdate(patch).then(setSnap), [])
  if (!snap) return null
  const current = SECTIONS.find((s) => s.id === section)!

  return (
    <div className="st-window">
      <nav className="st-sidebar" aria-label="Settings sections">
        <div className="st-drag" />
        {SECTIONS.map((s) => (
          <button key={s.id} className={`st-nav${s.id === section ? ' active' : ''}`} aria-current={s.id === section} onClick={() => setSection(s.id)}>
            <s.icon size={16} />
            {s.label}
          </button>
        ))}
      </nav>
      <main className="st-main">
        <header className="st-header">
          <h2>{current.label}</h2>
          {current.keys.length > 0 && (
            <button className="st-btn subtle" onClick={() => void api.settingsReset(current.keys).then(setSnap)} title="Back to the defaults for this section">
              <RotateCcw size={13} /> Reset section
            </button>
          )}
        </header>
        <div className="st-content">{current.view({ snap, set })}</div>
      </main>
    </div>
  )
}
