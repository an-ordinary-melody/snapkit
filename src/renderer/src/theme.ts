import type { Settings } from '@shared/settings'
import { readableOn } from './overlay/annotate/color'

const darkQuery = window.matchMedia('(prefers-color-scheme: dark)')
let current: Settings['appearance'] | null = null
// "System" follows the OS live.
darkQuery.addEventListener('change', () => current && applyTheme(current))

/**
 * Apply the appearance settings: light/dark (or the system's), Liquid Glass on
 * or off, and an optional accent color for highlights, switches and main buttons.
 */
export function applyTheme(a: Settings['appearance']) {
  current = a
  const root = document.documentElement
  root.dataset.mode = a.mode === 'system' ? (darkQuery.matches ? 'dark' : 'light') : a.mode
  root.dataset.glass = a.glass === false ? 'off' : 'on'
  const vars = ['--ui-accent', '--ui-accent-hover', '--ui-on-accent', '--ui-active-bg', '--ui-active-fg']
  for (const v of vars) root.style.removeProperty(v)
  if (!a.accent) return
  const on = readableOn(a.accent)
  root.style.setProperty('--ui-accent', a.accent)
  root.style.setProperty('--ui-accent-hover', a.accent)
  root.style.setProperty('--ui-on-accent', on)
  root.style.setProperty('--ui-active-bg', a.accent)
  root.style.setProperty('--ui-active-fg', on)
}
