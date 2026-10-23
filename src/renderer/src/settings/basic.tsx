import { FolderOpen, RotateCcw } from 'lucide-react'
import { FEATURES } from '@shared/features'
import { dateStamp, fileName, type NameRule } from '@shared/naming'
import { ColorField, Group, HotkeyField, NumberField, Row, Segmented, SliderField, Toggle } from './controls'
import type { SectionProps } from './Settings'

const api = window.snapkit

export function General({ snap, set }: SectionProps) {
  const s = snap.settings
  return (
    <>
      <Group title="After a capture">
        <Row label="Floating preview after copy" desc="Keep the result in the corner to copy again, edit or pin. The pin button turns it on or off per capture.">
          <Toggle label="Floating preview after copy" value={s.pin.afterCopy} onChange={(v) => set({ pin: { afterCopy: v } })} />
        </Row>
        <Row label="Background on by default" desc="Copy and save include the background preset. The layers button turns it on or off per capture.">
          <Toggle label="Background on by default" value={s.beautify.applyOnCopy} onChange={(v) => set({ beautify: { applyOnCopy: v } })} />
        </Row>
      </Group>

      <Group title="Saving">
        <Row label="Ask where to save" desc="Off: save straight to the folder below.">
          <Toggle label="Ask where to save" value={s.save.askLocation} onChange={(v) => set({ save: { askLocation: v } })} />
        </Row>
        <NameBuilder rule={s.save.name} next={s.save.nextNumber} set={set} />
        <Row label="Screenshots folder" desc={s.save.folder || `${snap.defaultSaveFolder} (default)`}>
          <button
            className="st-btn"
            onClick={() =>
              void api.settingsChooseFolder().then((folder) => {
                if (folder) set({ save: { folder } })
              })
            }
          >
            <FolderOpen size={14} /> Choose…
          </button>
          {s.save.folder && (
            <button className="st-btn subtle icon" title="Use the default folder" aria-label="Use the default folder" onClick={() => set({ save: { folder: '' } })}>
              <RotateCcw size={13} />
            </button>
          )}
        </Row>
      </Group>

      <Group title="Notifications">
        <Row label="When copied">
          <Toggle label="Notify when copied" value={s.notifications.onCopy} onChange={(v) => set({ notifications: { onCopy: v } })} />
        </Row>
        <Row label="When saved" desc="Click the notification to show the file.">
          <Toggle label="Notify when saved" value={s.notifications.onSave} onChange={(v) => set({ notifications: { onSave: v } })} />
        </Row>
      </Group>

      <Group title="Coming later">
        <Row label="Launch at login" desc="In a later update." disabled>
          <Toggle label="Launch at login" value={false} onChange={() => {}} disabled />
        </Row>
        <Row label="Capture history" desc="How many captures to keep, and a size limit: with the history panel." disabled />
      </Group>
    </>
  )
}

export function Shortcuts({ snap, set }: SectionProps) {
  const s = snap.settings
  const tools = FEATURES.filter((f) => f.drawing)
  const keyOf = (id: string) => (s.toolKeys[id] ?? FEATURES.find((f) => f.id === id)?.hint ?? '').toUpperCase()
  const taken = (id: string, k: string) => !!k && tools.some((t) => t.id !== id && keyOf(t.id) === k)
  return (
    <>
      <Group title="Global">
        <Row label="Capture area" desc="Works from any app.">
          <HotkeyField value={s.hotkeys.capture} onChange={(acc) => api.settingsSetHotkey(acc)} />
        </Row>
        <Row label="Open history" desc="With the history panel, in a later update." disabled />
      </Group>

      <Group title="Tools in capture mode" note="One letter or digit each. Press a tool's key again to go back to moving the selection.">
        {tools.map((t) => {
          const k = keyOf(t.id)
          return (
            <Row key={t.id} label={t.label} desc={taken(t.id, k) ? `${k} is also used by another tool.` : undefined}>
              <input
                className={`st-input key${taken(t.id, k) ? ' warn' : ''}`}
                aria-label={`${t.label} key`}
                value={k}
                maxLength={1}
                onChange={(e) => {
                  const v = e.target.value.slice(-1).toUpperCase()
                  if (v === '' || /^[A-Z0-9]$/.test(v)) set({ toolKeys: { ...s.toolKeys, [t.id]: v.toLowerCase() } })
                }}
              />
            </Row>
          )
        })}
      </Group>

      <Group title="In capture mode (fixed)">
        <Row label="Copy" desc="Also Enter.">
          <kbd className="st-kbd">⌘C</kbd>
        </Row>
        <Row label="Save">
          <kbd className="st-kbd">⌘S</kbd>
        </Row>
        <Row label="Undo / redo">
          <kbd className="st-kbd">⌘Z</kbd> <kbd className="st-kbd">⇧⌘Z</kbd>
        </Row>
        <Row label="Settings">
          <kbd className="st-kbd">⌘,</kbd>
        </Row>
        <Row label="Close" desc="Also right-click.">
          <kbd className="st-kbd">Esc</kbd>
        </Row>
      </Group>
    </>
  )
}

export function Appearance({ snap, set }: SectionProps) {
  const s = snap.settings
  return (
    <>
      <Group title="Theme">
        <Row label="Appearance" desc="For toolbars, menus, the editor, pins and this window. System follows your Mac.">
          <Segmented
            label="Appearance"
            value={s.appearance.mode}
            options={[
              { value: 'light', label: 'Light' },
              { value: 'dark', label: 'Dark' },
              { value: 'system', label: 'System' }
            ]}
            onChange={(mode) => set({ appearance: { mode } })}
          />
        </Row>
        <Row label="Liquid Glass" desc="Frosted, see-through panels that bend what's behind them at the edges. Off: solid panels.">
          <Toggle label="Liquid Glass" value={s.appearance.glass} onChange={(glass) => set({ appearance: { glass } })} />
        </Row>
        <Row label="Highlight color" desc="Selected tool, switches and main buttons. Theme: white in Light, gray in Dark.">
          <Segmented
            label="Highlight color"
            value={s.appearance.accent ? 'custom' : 'theme'}
            options={[
              { value: 'theme', label: 'Theme' },
              { value: 'custom', label: 'Custom' }
            ]}
            onChange={(v) => set({ appearance: { accent: v === 'custom' ? s.appearance.accent || '#0a84ff' : '' } })}
          />
          {s.appearance.accent && <ColorField label="Highlight color" value={s.appearance.accent} onChange={(accent) => set({ appearance: { accent } })} />}
        </Row>
      </Group>

      <Group title="Capture mode">
        <Row label="Dim outside the selection">
          <SliderField label="Dim amount" min={0.1} max={0.9} step={0.05} value={s.capture.dimOpacity} format={(v) => `${Math.round(v * 100)}%`} onChange={(dimOpacity) => set({ capture: { dimOpacity } })} />
        </Row>
        <Row label="Selection outline color">
          <ColorField label="Selection outline color" value={s.capture.accentColor} onChange={(accentColor) => set({ capture: { accentColor } })} />
        </Row>
        <Row label="Show the size label" desc="Width × height in pixels, above the selection.">
          <Toggle label="Show the size label" value={s.capture.showSizeLabel} onChange={(showSizeLabel) => set({ capture: { showSizeLabel } })} />
        </Row>
      </Group>
    </>
  )
}

export function About({ snap, set }: SectionProps) {
  return (
    <>
      <div className="st-about">
        <div className="st-app">Snapkit</div>
        <div className="st-muted">Version {snap.version}</div>
      </div>
      <Group title="Advanced">
        <Row label="Capture engine" desc="How screens are grabbed. Auto uses the fastest one that works and falls back if it fails.">
          <select className="st-select" aria-label="Capture engine" value={snap.settings.capture.engine} onChange={(e) => set({ capture: { engine: e.target.value } })}>
            <option value="auto">Auto</option>
            {snap.engines.map((e) => (
              <option key={e.id} value={e.id} disabled={!e.available}>
                {e.label}
                {e.available ? '' : ' (not available)'}
              </option>
            ))}
          </select>
        </Row>
      </Group>
      <Group>
        <Row label="Check for updates" desc="In a later update." disabled>
          <button className="st-btn" disabled>
            Check now
          </button>
        </Row>
        <Row label="Logs" desc="Timing and errors, for troubleshooting.">
          <button className="st-btn" onClick={() => api.settingsReveal('logs')}>
            Open log folder
          </button>
        </Row>
        <Row label="Settings file" desc="Only the values you changed are stored.">
          <button className="st-btn" onClick={() => api.settingsReveal('settings')}>
            Show in Finder
          </button>
        </Row>
        <Row label="Reset all settings" desc="Every section back to its defaults, including the hotkey.">
          <button
            className="st-btn danger"
            onClick={() => {
              if (window.confirm('Reset all Snapkit settings to their defaults?')) void api.settingsReset()
            }}
          >
            Reset all…
          </button>
        </Row>
      </Group>
    </>
  )
}

/**
 * File name, all in one place: the text, the date and the number side by
 * side, and a preview with each part labeled in the order it will appear.
 */
function NameBuilder({ rule, next, set }: { rule: NameRule; next: number; set: SectionProps['set'] }) {
  const now = new Date()
  const where = [
    { value: 'none' as const, label: 'Off' },
    { value: 'before' as const, label: 'Before' },
    { value: 'after' as const, label: 'After' }
  ]
  const num = String(next).padStart(rule.digits, '0')
  const parts: { kind: string; text: string }[] = [
    rule.number === 'before' && { kind: 'number', text: num },
    rule.date === 'before' && { kind: 'date', text: dateStamp(now) },
    rule.text.trim() && { kind: 'text', text: rule.text.trim() },
    rule.date === 'after' && { kind: 'date', text: dateStamp(now) },
    rule.number === 'after' && { kind: 'number', text: num }
  ].filter(Boolean) as { kind: string; text: string }[]
  return (
    <div className="st-row st-namer">
      <div className="st-label">
        <span>File name</span>
        <small>Text, plus the date and time and/or a number that counts up with each save.</small>
      </div>
      <div className="st-namer-fields">
        <label className="st-field">
          <span>Text</span>
          <input className="st-input" aria-label="File name text" placeholder="Snapkit" value={rule.text} onChange={(e) => set({ save: { name: { text: e.target.value } } })} />
        </label>
        <div className="st-field">
          <span>Date and time</span>
          <Segmented label="Date position" value={rule.date} options={where} onChange={(date) => set({ save: { name: { date } } })} />
        </div>
        <div className="st-field">
          <span>Number</span>
          <Segmented label="Number position" value={rule.number} options={where} onChange={(number) => set({ save: { name: { number } } })} />
        </div>
        {rule.number !== 'none' && (
          <div className="st-field">
            <span>Next · digits</span>
            <span className="st-control">
              <NumberField label="Next number" min={0} max={99999999} value={next} onChange={(nextNumber) => set({ save: { nextNumber } })} />
              <NumberField label="Digits" min={1} max={8} value={rule.digits} onChange={(digits) => set({ save: { name: { digits } } })} />
            </span>
          </div>
        )}
      </div>
      <div className="st-namer-preview" aria-label={`Example: ${fileName(rule, now, next)}`}>
        {parts.length ? (
          parts.map((p, i) => (
            <span key={i} className={`st-part ${p.kind}`} title={p.kind === 'text' ? 'Text' : p.kind === 'date' ? 'Date and time' : 'Number'}>
              {p.text}
            </span>
          ))
        ) : (
          <span className="st-part date">{dateStamp(now)}</span>
        )}
        <span className="st-ext">.png</span>
      </div>
    </div>
  )
}
