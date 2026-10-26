import { FolderOpen, RotateCcw } from 'lucide-react'
import { useEffect, useState } from 'react'
import { FEATURES } from '@shared/features'
import { HISTORY_LIMITS } from '@shared/history'
import type { HistoryUsage, LoginItemState, SettingsSnapshot, UpdateCheck } from '@shared/ipc'
import { dateStamp, fileName, type NameRule } from '@shared/naming'
import { ColorField, formatAccelerator, Group, HotkeyField, NumberField, Row, Segmented, SliderField, Toggle } from './controls'
import type { SectionProps } from './Settings'

const api = window.snapkit

export function General({ snap, set }: SectionProps) {
  const s = snap.settings
  return (
    <>
      <LaunchAtLogin />

      <Group title="After a capture">
        <Row label="Quick area capture" desc="Copies the area the moment you let go. No editing step.">
          <Toggle label="Quick area capture" value={s.capture.quickCopy} onChange={(quickCopy) => set({ capture: { quickCopy } })} />
        </Row>
        <Row label="Copy text" desc={s.ocr.textButton === 'panel' ? 'Shows the text so you can check it before copying.' : 'Copies the text right away.'}>
          <Segmented
            label="Copy text"
            value={s.ocr.textButton}
            options={[
              { value: 'panel', label: 'Show text first' },
              { value: 'copy', label: 'Copy right away' }
            ]}
            onChange={(textButton) => set({ ocr: { textButton } })}
          />
        </Row>
        <Row label="Copy last area right away" desc="For Capture last area. Off: opens capture mode with the area selected.">
          <Toggle label="Copy last area right away" value={s.capture.lastAreaInstant} onChange={(lastAreaInstant) => set({ capture: { lastAreaInstant } })} />
        </Row>
        <Row label="Copy full-screen captures right away" desc="Off: they only go to the floating preview and history.">
          <Toggle label="Copy full-screen captures right away" value={s.capture.fullscreenCopy} onChange={(fullscreenCopy) => set({ capture: { fullscreenCopy } })} />
        </Row>
        <Row label="Floating preview after copy" desc='Keeps the result in a corner. Use the "Pin" button to turn it on or off.'>
          <Toggle label="Floating preview after copy" value={s.pin.afterCopy} onChange={(v) => set({ pin: { afterCopy: v } })} />
        </Row>
        <Row label="Background on by default" desc='Automatically adds the background when you copy or save. Use the "Background" button to turn it on or off.'>
          <Toggle label="Background on by default" value={s.beautify.applyOnCopy} onChange={(v) => set({ beautify: { applyOnCopy: v } })} />
        </Row>
        <Row label="Compress images" desc='Smaller PNGs with fewer colors; text stays sharp. Use the "Compress" switch in the editor to turn it on or off.'>
          <Toggle label="Compress images" value={s.compress.enabled} onChange={(enabled) => set({ compress: { enabled } })} />
        </Row>
        {s.compress.enabled && (
          <>
            <Row label="Compression" desc={s.compress.preset === 'standard' ? 'Fewer colors, same size.' : 'Fewer colors, and 1× size on Retina / HiDPI screens.'}>
              <Segmented
                label="Compression"
                value={s.compress.preset}
                options={[
                  { value: 'standard', label: 'Standard' },
                  { value: 'smallest', label: 'Smallest' }
                ]}
                onChange={(preset) => set({ compress: { preset } })}
              />
            </Row>
            <Row label="Compress when">
              <Segmented
                label="Compress when"
                value={s.compress.applyTo}
                options={[
                  { value: 'both', label: 'Copy and save' },
                  { value: 'copy', label: 'Copy' },
                  { value: 'save', label: 'Save' }
                ]}
                onChange={(applyTo) => set({ compress: { applyTo } })}
              />
            </Row>
          </>
        )}
      </Group>

      <Group title="Saving">
        <Row label="Ask where to save" desc="Off: save straight to the screenshots folder.">
          <Toggle label="Ask where to save" value={s.save.askLocation} onChange={(v) => set({ save: { askLocation: v } })} />
        </Row>
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
        <NameBuilder rule={s.save.name} next={s.save.nextNumber} set={set} />
      </Group>

      <Group title="Notifications">
        <Row label="When copied">
          <Toggle label="Notify when copied" value={s.notifications.onCopy} onChange={(v) => set({ notifications: { onCopy: v } })} />
        </Row>
        <Row label="When saved" desc="Click it to show the file.">
          <Toggle label="Notify when saved" value={s.notifications.onSave} onChange={(v) => set({ notifications: { onSave: v } })} />
        </Row>
      </Group>

      <HistorySettings snap={snap} set={set} />
    </>
  )
}

/** Read from the OS (it can also be changed in System Settings), so it isn't a stored setting. */
function LaunchAtLogin() {
  const [state, setState] = useState<LoginItemState | null>(null)
  useEffect(() => {
    void api.loginItemGet().then(setState)
    const again = () => void api.loginItemGet().then(setState)
    window.addEventListener('focus', again) // back from System Settings
    return () => window.removeEventListener('focus', again)
  }, [])
  return (
    <Group title="Startup">
      <Row
        label="Launch at login"
        desc={state?.needsApproval ? 'Approve it in System Settings → General → Login Items.' : 'Start Snapkit when you log in.'}
      >
        {state?.needsApproval && (
          <button className="st-btn" onClick={() => api.openUrl('login-items')}>
            Open Login Items
          </button>
        )}
        <Toggle label="Launch at login" value={!!state?.enabled} onChange={(v) => void api.loginItemSet(v).then(setState)} disabled={!state} />
      </Row>
    </Group>
  )
}

/** History: limits (capped for speed), pause, where it's kept, and clearing. */
function HistorySettings({ snap, set }: SectionProps) {
  const h = snap.settings.history
  const [use, setUse] = useState<HistoryUsage | null>(null)
  useEffect(() => {
    void api.historyUsage().then(setUse)
    api.onHistoryChanged(() => void api.historyUsage().then(setUse))
  }, [])
  const mb = (b: number) => `${(b / 1024 / 1024).toFixed(b < 10 * 1024 * 1024 ? 1 : 0)} MB`
  return (
    <Group
      title="History"
      note={`Your copies, saves and pins, to reuse. Open it with ${snap.settings.hotkeys.history ? formatAccelerator(snap.settings.hotkeys.history) + ' or ' : ''}History… in the menu bar. Starred ones are never removed.`}
    >
      {/* Same switch as in the History window: on = recording. */}
      <Row label="Recording" desc="Off: new captures aren't kept.">
        <Toggle label="Recording" value={!h.paused} onChange={(on) => set({ history: { paused: !on } })} />
      </Row>
      <Row label="Keep" desc={`Up to ${HISTORY_LIMITS.maxCount} recent captures.`}>
        <SliderField label="Captures to keep" min={1} max={HISTORY_LIMITS.maxCount} value={Math.min(h.maxCount, HISTORY_LIMITS.maxCount)} onChange={(maxCount) => set({ history: { maxCount } })} />
      </Row>
      <Row label="Size limit" desc={`When full, the oldest go first. Max ${HISTORY_LIMITS.maxMB / 1000} GB.`}>
        <SliderField label="History size limit" min={50} max={HISTORY_LIMITS.maxMB} step={50} value={Math.min(h.maxMB, HISTORY_LIMITS.maxMB)} format={(n) => `${n} MB`} onChange={(maxMB) => set({ history: { maxMB } })} />
      </Row>
      <Row label="Keep for">
        <select className="st-select" aria-label="Keep captures for" value={h.maxAgeDays} onChange={(e) => set({ history: { maxAgeDays: Number(e.target.value) } })}>
          {[1, 7, 30, 90].map((d) => (
            <option key={d} value={d}>
              {d === 1 ? '1 day' : `${d} days`}
            </option>
          ))}
          <option value={0}>Forever</option>
        </select>
      </Row>
      <Row label="Stored" desc={use ? use.folder : ''}>
        <span className="st-muted">{use ? `${use.count} ${use.count === 1 ? 'capture' : 'captures'} · ${mb(use.bytes)}` : '…'}</span>
        <button className="st-btn" onClick={() => api.historyReveal()}>
          <FolderOpen size={14} /> Show folder
        </button>
      </Row>
      <Row label="Clear history" desc="Deletes all history.">
        <button className="st-btn" disabled={!use?.count} onClick={() => void api.historyClear(true).then(setUse)}>
          Clear, keep starred
        </button>
        <button
          className="st-btn danger"
          disabled={!use?.count}
          onClick={() => {
            if (window.confirm('Delete every capture in history, including starred ones?')) void api.historyClear(false).then(setUse)
          }}
        >
          Clear all…
        </button>
      </Row>
    </Group>
  )
}

export function Shortcuts({ snap, set }: SectionProps) {
  const s = snap.settings
  const tools = FEATURES.filter((f) => f.drawing)
  const keyOf = (id: string) => (s.toolKeys[id] ?? FEATURES.find((f) => f.id === id)?.hint ?? '').toUpperCase()
  const taken = (id: string, k: string) => !!k && tools.some((t) => t.id !== id && keyOf(t.id) === k)
  // A global shortcut another app holds right now: Snapkit keeps trying and takes it once it's free.
  const held = (name: SettingsSnapshot['hotkeysTaken'][number], desc: string) =>
    snap.hotkeysTaken?.includes(name) ? `${desc ? desc + ' ' : ''}⚠ In use by another app. Snapkit takes it once it's free.` : desc || undefined
  return (
    <>
      <Group title="Global">
        <Row label="Capture area" desc={held('capture', '')}>
          <HotkeyField value={s.hotkeys.capture} onChange={(acc) => api.settingsSetHotkey(acc)} />
        </Row>
        <Row label="Capture last area" desc={held('lastArea', '')}>
          <HotkeyField value={s.hotkeys.lastArea} onChange={(acc) => api.settingsSetHotkey(acc, 'lastArea')} />
          {s.hotkeys.lastArea && (
            <button className="st-btn subtle" onClick={() => void api.settingsSetHotkey('', 'lastArea')} title="No shortcut; use the menu bar">
              Off
            </button>
          )}
        </Row>
        <Row label="Capture text" desc={held('ocr', '')}>
          <HotkeyField value={s.hotkeys.ocr} onChange={(acc) => api.settingsSetHotkey(acc, 'ocr')} />
          {s.hotkeys.ocr && (
            <button className="st-btn subtle" onClick={() => void api.settingsSetHotkey('', 'ocr')} title="No shortcut; use the menu bar">
              Off
            </button>
          )}
        </Row>
        <Row label="Capture full screen" desc={held('fullscreen', '')}>
          <HotkeyField value={s.hotkeys.fullscreen} onChange={(acc) => api.settingsSetHotkey(acc, 'fullscreen')} />
          {s.hotkeys.fullscreen && (
            <button className="st-btn subtle" onClick={() => void api.settingsSetHotkey('', 'fullscreen')} title="No shortcut; use the menu bar">
              Off
            </button>
          )}
        </Row>
        <Row label="History" desc={held('history', '')}>
          <HotkeyField value={s.hotkeys.history} onChange={(acc) => api.settingsSetHotkey(acc, 'history')} />
          {s.hotkeys.history && (
            <button className="st-btn subtle" onClick={() => void api.settingsSetHotkey('', 'history')} title="No shortcut; use the menu bar">
              Off
            </button>
          )}
        </Row>
        <Row label="Settings" desc={held('settings', '')}>
          <HotkeyField value={s.hotkeys.settings} onChange={(acc) => api.settingsSetHotkey(acc, 'settings')} />
          {s.hotkeys.settings && (
            <button className="st-btn subtle" onClick={() => void api.settingsSetHotkey('', 'settings')} title="No shortcut; use the menu bar">
              Off
            </button>
          )}
        </Row>
      </Group>

      <Group title="Tools in capture mode" note="One key each. Press it again to go back to moving the selection.">
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
        <Row label="Appearance" desc="Gray is a softer Dark. System follows your computer.">
          <Segmented
            label="Appearance"
            value={s.appearance.mode}
            options={[
              { value: 'light', label: 'Light' },
              { value: 'gray', label: 'Gray' },
              { value: 'dark', label: 'Dark' },
              { value: 'system', label: 'System' }
            ]}
            onChange={(mode) => set({ appearance: { mode } })}
          />
        </Row>
        <Row label="Liquid Glass" desc="Frosted, see-through panels. Off: solid.">
          <Toggle label="Liquid Glass" value={s.appearance.glass} onChange={(glass) => set({ appearance: { glass } })} />
        </Row>
        <Row label="Highlight color" desc="The selected tool, switches and main buttons.">
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
        <Row label="Dim amount">
          <SliderField label="Dim amount" min={0.1} max={0.9} step={0.01} value={s.capture.dimOpacity} format={(v) => `${Math.round(v * 100)}%`} onChange={(dimOpacity) => set({ capture: { dimOpacity } })} />
        </Row>
        <Row label="Dim color">
          <ColorField label="Dim color" value={s.capture.dimColor} onChange={(dimColor) => set({ capture: { dimColor } })} />
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
        <Row label="Capture engine" desc="Auto picks the fastest one that works.">
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
        <Row label="Text recognition" desc="Auto uses the one built into your system.">
          <select className="st-select" aria-label="Text recognition engine" value={snap.settings.ocr.engine} onChange={(e) => set({ ocr: { engine: e.target.value } })}>
            <option value="auto">Auto</option>
            {snap.ocrEngines.map((e) => (
              <option key={e.id} value={e.id} disabled={!e.available}>
                {e.label}
                {e.available ? '' : ' (not available)'}
              </option>
            ))}
          </select>
        </Row>
      </Group>
      <Group>
        <UpdatesRows snap={snap} set={set} />
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
        <Row label="Reset all settings" desc="Every section, including shortcuts.">
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
        <small>Text, plus the date and/or a counter.</small>
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
      </div>
      {rule.number !== 'none' && (
        <div className="st-namer-fields st-number-opts">
          <label className="st-field">
            <span>Starting number</span>
            <NumberField label="Starting number" min={0} max={99999999} value={next} onChange={(nextNumber) => set({ save: { nextNumber } })} />
            <small>The next save starts with this number.</small>
          </label>
          <label className="st-field">
            <span>Number of digits</span>
            <NumberField label="Number of digits" min={1} max={8} value={rule.digits} onChange={(digits) => set({ save: { name: { digits } } })} />
            <small>
              Padded with zeros: {[0, 1, 2].map((i) => String(next + i).padStart(rule.digits, '0')).join(', ')}…
            </small>
          </label>
        </div>
      )}
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

/** Update checks: notify and download (nothing installs by itself). */
function UpdatesRows({ snap, set }: SectionProps) {
  const u = snap.settings.updates
  const [check, setCheck] = useState<UpdateCheck | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => void api.updatesLast().then(setCheck), [])
  const text = !check
    ? u.lastCheck
      ? `Last checked ${new Date(u.lastCheck).toLocaleString()}.`
      : 'Not checked yet.'
    : check.status === 'available'
      ? `Snapkit ${check.version} is available (you have ${check.current}).`
      : check.status === 'latest'
        ? `You have the latest version (${check.current}).`
        : check.message ?? 'Could not check.'
  return (
    <>
      <Row label="Check for updates" desc={text}>
        {check?.status === 'available' && (
          <>
            <button className="st-btn subtle" onClick={() => api.openUrl('release')}>
              What's new
            </button>
            <button className="st-btn primary-ish" onClick={() => api.openUrl('update')}>
              Download {check.version}
            </button>
          </>
        )}
        <button
          className="st-btn"
          disabled={busy}
          onClick={() => {
            setBusy(true)
            void api.updatesCheck().then((r) => (setCheck(r), setBusy(false)))
          }}
        >
          {busy ? 'Checking…' : 'Check now'}
        </button>
      </Row>
      <Row label="Check automatically" desc="Once a day; a notification when there's a new version. Nothing installs by itself.">
        <Toggle label="Check for updates automatically" value={u.autoCheck} onChange={(autoCheck) => set({ updates: { autoCheck } })} />
      </Row>
    </>
  )
}
