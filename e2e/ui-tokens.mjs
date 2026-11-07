// Writes fixtures/ui-tokens.json: the Electron app's theme colors (CSS custom properties) and measured
// sizes, per theme, for the native Mac app to match. Uses the scene renderer's test hook (see e2e/scene.mjs).
// Usage: npm run build && node e2e/ui-tokens.mjs
import { _electron as electron } from 'playwright-core'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join, resolve } from 'path'

const fixtures = resolve(import.meta.dirname, '..', 'fixtures')
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const THEMES = ['light', 'dark', 'gray'].flatMap((mode) => [true, false].map((glass) => ({ mode, glass })))

// In the page: every custom property defined in the stylesheets, as computed on :root.
const readVars = () => {
  const names = new Set()
  for (const sheet of document.styleSheets) for (const rule of sheet.cssRules) if (rule.style) for (const p of rule.style) if (p.startsWith('--')) names.add(p)
  const cs = getComputedStyle(document.documentElement)
  return Object.fromEntries([...names].sort().map((n) => [n, cs.getPropertyValue(n).trim()]))
}

// In the page: sizes (CSS px = points) and fonts of the given elements.
const measure = (targets) => {
  const box = (el) => {
    const r = el.getBoundingClientRect()
    return { x: r.x, y: r.y, w: r.width, h: r.height }
  }
  const font = (el) => {
    const s = getComputedStyle(el)
    return { family: s.fontFamily, size: parseFloat(s.fontSize), weight: Number(s.fontWeight), lineHeight: s.lineHeight, letterSpacing: s.letterSpacing }
  }
  const out = {}
  for (const [name, t] of Object.entries(targets)) {
    const els = [...document.querySelectorAll(t.sel)]
    const el = els[0]
    if (!el) continue
    const s = getComputedStyle(el)
    const v = { ...box(el), radius: s.borderRadius, padding: s.padding, border: `${s.borderWidth} ${s.borderStyle}`.trim(), outline: s.outlineWidth !== '0px' ? `${s.outlineWidth} ${s.outlineStyle}` : undefined, boxShadow: s.boxShadow !== 'none' ? s.boxShadow : undefined }
    if (t.font) v.font = font(el)
    // Gap between the first two siblings matched (along the layout direction).
    if (t.gap && els[1]) {
      const a = box(els[0])
      const b = box(els[1])
      v.gap = Math.abs(b.y - a.y) > Math.abs(b.x - a.x) ? b.y - (a.y + a.h) : b.x - (a.x + a.w)
    }
    out[name] = v
  }
  return out
}

const OVERLAY = {
  toolsBar: { sel: '.toolbar.vertical' },
  toolButton: { sel: '.toolbar.vertical button', gap: true },
  actionsBar: { sel: '.toolbar:not(.vertical):not(.style-bar)' },
  actionButton: { sel: '.toolbar:not(.vertical):not(.style-bar) button', gap: true },
  styleBar: { sel: '.toolbar.style-bar' },
  swatch: { sel: '.swatch', gap: true },
  widthDot: { sel: '.width-dot' },
  handle: { sel: '.handle' },
  selection: { sel: '.selection' },
  sizeLabel: { sel: '.size-label', font: true },
  tooltip: { sel: '.tip', font: true }
}
const SETTINGS = {
  window: { sel: '.st-window, body' },
  sidebar: { sel: '.st-sidebar' },
  navItem: { sel: '.st-nav', gap: true, font: true },
  header: { sel: '.st-header', font: true },
  groupTitle: { sel: '.st-group h2, .st-group > div:first-child', font: true },
  card: { sel: '.st-card' },
  row: { sel: '.st-row', gap: true, font: true },
  label: { sel: '.st-label', font: true },
  note: { sel: '.st-note', font: true },
  switch: { sel: '.switch' },
  switchKnob: { sel: '.switch span' },
  button: { sel: '.st-btn', font: true },
  segmented: { sel: '.st-seg' },
  input: { sel: '.st-input', font: true },
  slider: { sel: '.st-slider, .slider' }
}

async function themeTokens(theme) {
  const profile = mkdtempSync(join(tmpdir(), 'snapkit-tokens-'))
  writeFileSync(join(profile, 'settings.json'), JSON.stringify({ hotkeys: { capture: 'CommandOrControl+Alt+Shift+F12' }, appearance: { mode: theme.mode, glass: theme.glass, accent: '' } }))
  const app = await electron.launch({
    args: ['.', '--no-sandbox', `--user-data-dir=${profile}`],
    env: { ...process.env, SNAPKIT_SCENE: join(fixtures, 'scenes', 'overlay-shapes-arrow.json'), SNAPKIT_FIXTURES: fixtures }
  })
  const windowFor = async (hash) => {
    for (let i = 0; i < 40; i++) {
      const w = app.windows().find((w) => w.url().endsWith('#' + hash))
      if (w) return w
      await wait(100)
    }
    throw new Error(`no ${hash} window`)
  }
  try {
    await wait(2000)
    await app.evaluate(({ app }) => void setTimeout(() => app.emit('second-instance', {}, [])))
    const ov = await windowFor('overlay')
    await wait(1200)
    await ov.hover('.toolbar button[data-id="pen"]') // a tooltip to measure
    await wait(700)
    const overlay = { vars: await ov.evaluate(readVars), sizes: await ov.evaluate(measure, OVERLAY) }
    await ov.keyboard.press('Escape')
    await app.evaluate(({ ipcMain }) => ipcMain.emit('settings:open', { senderFrame: { url: 'file:///app/out/renderer/index.html#overlay' } }))
    const st = await windowFor('settings')
    await wait(800)
    const settings = { vars: await st.evaluate(readVars), sizes: await st.evaluate(measure, SETTINGS) }
    return { overlay, settings }
  } finally {
    await app.close()
    rmSync(profile, { recursive: true, force: true })
  }
}

const themes = {}
for (const t of THEMES) {
  const key = `${t.mode}${t.glass ? '' : '-solid'}`
  themes[key] = await themeTokens(t)
  console.log('measured', key)
}
const out = {
  about: 'Generated by e2e/ui-tokens.mjs from the Electron app. Sizes are in points (CSS px). Theme keys: light/dark/gray with Liquid Glass on; -solid = glass off.',
  themes
}
writeFileSync(join(fixtures, 'ui-tokens.json'), JSON.stringify(out, null, 2) + '\n')
console.log('wrote fixtures/ui-tokens.json')
