import { readableOn } from './overlay/annotate/color'

/** Apply the theme (`glass` / `dark`) and, if set, an accent color for highlights, switches and primary buttons. */
export function applyTheme(theme: string, accent = '') {
  const root = document.documentElement
  root.dataset.theme = theme
  const vars = ['--ui-accent', '--ui-accent-hover', '--ui-on-accent', '--ui-active-bg', '--ui-active-fg']
  for (const v of vars) root.style.removeProperty(v)
  if (!accent) return
  const on = readableOn(accent)
  root.style.setProperty('--ui-accent', accent)
  root.style.setProperty('--ui-accent-hover', accent)
  root.style.setProperty('--ui-on-accent', on)
  root.style.setProperty('--ui-active-bg', accent)
  root.style.setProperty('--ui-active-fg', on)
}
