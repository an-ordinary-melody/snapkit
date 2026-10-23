// Settings window test: every section in both themes, real changes, and that
// capture mode picks them up. Usage: npm run build && node e2e/settings.mjs <out-dir>
import { _electron as electron } from 'playwright-core'
import { mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join, resolve } from 'path'

const out = resolve(process.argv[2] ?? 'e2e-out')
const profile = join(out, 'profile')
mkdirSync(profile, { recursive: true })
writeFileSync(join(profile, 'settings.json'), JSON.stringify({ hotkeys: { capture: 'CommandOrControl+Alt+Shift+F12' } }))
const saved = () => JSON.parse(readFileSync(join(profile, 'settings.json'), 'utf8'))

const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const app = await electron.launch({ args: ['.', '--no-sandbox', `--user-data-dir=${profile}`] })
const windowFor = (view) => app.windows().find((w) => w.url().endsWith('#' + view))

try {
  await wait(2500)
  await app.evaluate(({ ipcMain }) => ipcMain.emit('settings:open', {}))
  await wait(1500)
  const st = windowFor('settings')
  const errors = []
  st.on('pageerror', (e) => errors.push(String(e)))
  st.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
  const section = async (name) => {
    await st.click(`.st-nav:has-text("${name}")`)
    await wait(250)
  }

  for (const name of ['General', 'Shortcuts', 'Appearance', 'Toolbar', 'Tools', 'Background', 'About']) {
    await section(name)
    writeFileSync(join(out, `glass-${name.toLowerCase()}.png`), await st.screenshot())
  }

  // Shortcuts: record a new capture hotkey, change a tool letter.
  await section('Shortcuts')
  await st.click('.st-hotkey')
  await st.keyboard.press('Meta+Alt+Shift+F11')
  await wait(300)
  console.log('hotkey button:', await st.$eval('.st-hotkey', (e) => e.textContent), '| saved:', saved().hotkeys?.capture)
  await st.fill('input[aria-label="Arrow key"]', 'w')
  await wait(200)
  console.log('arrow key saved:', saved().toolKeys?.arrow)

  // Appearance: dark theme and a darker dim.
  await section('Appearance')
  await st.click('.st-seg button:has-text("Dark")')
  await wait(300)
  console.log('theme:', await st.evaluate(() => document.documentElement.dataset.theme), '| saved:', saved().appearance?.theme)
  for (const name of ['General', 'Appearance', 'Toolbar', 'Tools', 'Background']) {
    await section(name)
    writeFileSync(join(out, `dark-${name.toLowerCase()}.png`), await st.screenshot())
  }

  // Toolbar: turn Highlighter off, drag Text above Pencil.
  await section('Toolbar')
  await st.click('button[aria-label="Show Highlighter"]')
  const rows = st.locator('.st-group:has-text("Tools (vertical bar)") .st-reorder')
  await rows.filter({ hasText: 'Text' }).dragTo(rows.filter({ hasText: 'Pencil' }))
  await wait(300)
  console.log('highlighter off:', saved().features?.highlighter === false, '| order starts:', (saved().toolbarOrder ?? []).slice(0, 3).join(', '))

  // Tools: change the first quick color.
  await section('Tools')
  await st.click('button[aria-label="Color 1: pick a color"]')
  await st.fill('.color-picker .hex', '#00aa55')
  await st.keyboard.press('Enter')
  await wait(200)
  console.log('palette saved:', saved().annotate?.palette?.[0])

  // Background: make Sunset the default and change its padding.
  await section('Background')
  await st.click('.st-preset:has-text("Sunset")')
  await st.click('.st-btn:has-text("Make default")')
  await wait(200)
  console.log('default preset:', saved().beautify?.preset)

  // Capture mode picks it all up.
  await app.evaluate(({ app }) => app.emit('second-instance'))
  await wait(1000)
  const ov = windowFor('overlay')
  const m = ov.mouse
  await m.move(300, 200); await m.down(); await m.move(800, 600, { steps: 4 }); await m.up(); await wait(300)
  const tools = await ov.$$eval('.toolbar.vertical button', (bs) => bs.map((b) => b.dataset.tip))
  await ov.keyboard.press('w')
  await wait(150)
  console.log('capture: theme', await ov.evaluate(() => document.documentElement.dataset.theme),
    '| first tool', tools[0], '| highlighter shown', tools.includes('Highlighter'),
    '| W selects arrow', await ov.$eval('.toolbar button.active[data-id]', (b) => b.dataset.id).catch(() => 'none'),
    '| first swatch', await ov.$eval('.style-bar .swatch', (b) => b.dataset.tip).catch(() => 'none'))
  writeFileSync(join(out, 'capture-after-settings.png'), await ov.screenshot())
  await ov.keyboard.press('Escape')
  await wait(400)

  // Reset a section.
  await section('Appearance')
  await st.click('.st-header button:has-text("Reset section")')
  await wait(300)
  console.log('after reset: theme', saved().appearance?.theme ?? 'default', '| toolbar kept:', saved().features?.highlighter === false)
  console.log('settings errors:', errors.length ? errors : 'none')
} finally {
  await app.close()
}
