// The made-up page the demos capture: a "Team plan" pricing card, drawn at a fixed
// 472 × 262 px and positioned absolutely, so annotations can be placed over it exactly.
import { Check } from 'lucide-react'
import type { CSSProperties } from 'react'

export const CARD = { w: 472, h: 262 }

export function PlanCard({ style, className = '' }: { style?: CSSProperties; className?: string }) {
  return (
    <div className={`plan ${className}`} style={style}>
      <div className="plan-title">
        Team plan <span className="plan-badge">Popular</span>
      </div>
      <div className="plan-price">
        <b>$12</b> / user / month
      </div>
      <ul className="plan-list">
        {['Unlimited captures', 'Shared history', 'Priority support'].map((t) => (
          <li key={t}>
            <Check size={13} strokeWidth={3} /> {t}
          </li>
        ))}
      </ul>
      <div className="plan-email">anna.nguyen@acme.co</div>
      <div className="plan-btn">Upgrade</div>
    </div>
  )
}

/** The whole fake screen (960 × 600): wallpaper, menu bar and a browser window holding the card. */
export function Desk() {
  return (
    <div className="desk">
      <div className="desk-menubar">
        <span className="desk-apple" />
        <b>Safari</b>
        <span>File</span>
        <span>Edit</span>
        <span>View</span>
        <span className="desk-right">
          <img src="/logo-mono.svg" alt="" width={14} height={14} />
          <span>Fri 9:41</span>
        </span>
      </div>
      <div className="desk-win">
        <div className="desk-titlebar">
          <i /> <i /> <i />
          <span className="desk-url">acme.app/billing</span>
        </div>
        <div className="desk-side">
          <span className="desk-brand">acme</span>
          {['Overview', 'Projects', 'Members', 'Billing', 'Settings'].map((t) => (
            <span key={t} className={t === 'Billing' ? 'on' : ''}>
              {t}
            </span>
          ))}
        </div>
        <div className="desk-main">
          <div className="desk-h">Billing</div>
          <div className="desk-sub">Choose the plan that fits your team.</div>
        </div>
      </div>
      <PlanCard style={{ position: 'absolute', left: 264, top: 164 }} />
      <div className="plan plan-ghost" style={{ position: 'absolute', left: 264, top: 444, height: 90 }} />
    </div>
  )
}
