// Signature 1: a few of the app's real General settings; flipping them changes the flow beside them.
import { ChevronRight } from 'lucide-react'
import { useState } from 'react'

type Key = 'quick' | 'bg' | 'preview' | 'ask'

const SETTINGS: { key: Key; label: string; hint: string }[] = [
  { key: 'quick', label: 'Quick area capture', hint: 'Copy the moment you let go' },
  { key: 'bg', label: 'Background on copy', hint: 'Every copy gets your default background' },
  { key: 'preview', label: 'Floating preview after copy', hint: 'Keep the last capture in the corner' },
  { key: 'ask', label: 'Ask where to save', hint: 'Or save straight to Pictures/Snapkit' }
]

export default function WorkflowDemo() {
  const [on, setOn] = useState<Record<Key, boolean>>({ quick: false, bg: true, preview: true, ask: true })
  const flip = (k: Key) => setOn((s) => ({ ...s, [k]: !s[k] }))

  const flow: { label: string; keys?: string[]; tone?: 'accent' }[] = [
    { label: 'Capture', keys: ['⌥', '⇧', 'Z'] },
    { label: 'Select area' },
    ...(on.quick ? [] : [{ label: 'Draw & adjust' }]),
    ...(on.bg ? [{ label: 'Add background', tone: 'accent' as const }] : []),
    { label: on.quick ? 'Copied on release' : 'Copy', keys: on.quick ? undefined : ['⌘', 'C'] },
    ...(on.preview ? [{ label: 'Floating preview', tone: 'accent' as const }] : [])
  ]

  return (
    <div className="wf">
      <div className="wf-settings" role="group" aria-label="Example settings">
        <div className="wf-head">General · After a capture</div>
        {SETTINGS.map((s) => (
          <label key={s.key} className="wf-row">
            <span>
              <b>{s.label}</b>
              <small>{s.hint}</small>
            </span>
            <input type="checkbox" role="switch" checked={on[s.key]} onChange={() => flip(s.key)} />
            <i className="wf-switch" aria-hidden="true" />
          </label>
        ))}
      </div>
      <div className="wf-flow" aria-live="polite">
        <div className="wf-head">Your flow</div>
        <ol>
          {flow.map((f, i) => (
            <li key={f.label} className={f.tone === 'accent' ? 'is-accent' : ''} style={{ animationDelay: `${i * 40}ms` }}>
              <span className="wf-n">{i + 1}</span>
              <span className="wf-label">{f.label}</span>
              {f.keys && (
                <span className="wf-keys">
                  {f.keys.map((k) => (
                    <kbd key={k} className="kbd">
                      {k}
                    </kbd>
                  ))}
                </span>
              )}
              {i < flow.length - 1 && <ChevronRight className="wf-next" size={14} aria-hidden="true" />}
            </li>
          ))}
        </ol>
        <p className="wf-save">
          <kbd className="kbd">⌘</kbd>
          <kbd className="kbd">S</kbd> {on.ask ? 'asks where to save, starting in the last folder' : 'saves straight to Pictures/Snapkit'}
        </p>
      </div>
    </div>
  )
}
