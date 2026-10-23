/** How saved files are named: a fixed text with an optional date and/or number before or after it. */
export interface NameRule {
  /** Fixed part, e.g. "Snapkit" or "Bug report". */
  text: string
  date: 'none' | 'before' | 'after'
  number: 'none' | 'before' | 'after'
  /** Zero-padded width of the number (3 -> 007). */
  digits: number
}

export const DEFAULT_NAME_RULE: NameRule = { text: 'Snapkit', date: 'after', number: 'none', digits: 3 }

const pad = (n: number, w = 2) => String(n).padStart(w, '0')

/** "2026-10-24 at 05.30.12" */
export function dateStamp(d: Date) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} at ${pad(d.getHours())}.${pad(d.getMinutes())}.${pad(d.getSeconds())}`
}

/** Characters that aren't allowed in file names on macOS or Windows. */
const UNSAFE = /[/\\:*?"<>|\u0000-\u001f]/g

/** The file name (with .png) for a capture saved at `now` as number `n`. Falls back to a timestamp if the rule makes nothing. */
export function fileName(rule: NameRule, now: Date, n: number): string {
  const num = pad(Math.max(0, Math.floor(n)), Math.min(8, Math.max(1, rule.digits)))
  const date = dateStamp(now)
  const parts = [
    rule.number === 'before' && num,
    rule.date === 'before' && date,
    rule.text.replace(UNSAFE, '-').trim(),
    rule.date === 'after' && date,
    rule.number === 'after' && num
  ].filter(Boolean)
  const base = parts.join(' ').trim().replace(/^\.+/, '')
  return `${base || `Snapkit ${date}`}.png`
}

/** "name.png" -> "name 2.png", "name 3.png"... while `taken` says the name is used. */
export function uniqueName(name: string, taken: (n: string) => boolean): string {
  if (!taken(name)) return name
  const stem = name.replace(/\.png$/i, '')
  for (let i = 2; ; i++) {
    const next = `${stem} ${i}.png`
    if (!taken(next)) return next
  }
}
