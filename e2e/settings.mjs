// Settings window test: every section in both themes, real changes, and that
// capture mode picks them up. Usage: npm run build && node e2e/settings.mjs <out-dir>
import { _electron as electron } from 'playwright-core'
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'fs'
import { join, resolve } from 'path'

const out = resolve(process.argv[2] ?? 'e2e-out')
const profile = join(out, 'profile')
mkdirSync(profile, { recursive: true })
const saves = join(out, 'saved')
mkdirSync(saves, { recursive: true })
writeFileSync(join(profile, 'settings.json'), JSON.stringify({ hotkeys: { capture: 'CommandOrControl+Alt+Shift+F12' }, save: { folder: saves, askLocation: false }, notifications: { onSave: false } }))
const saved = () => JSON.parse(readFileSync(join(profile, 'settings.json'), 'utf8'))

const MOD = process.platform === 'darwin' ? 'Meta' : 'Control'
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const app = await electron.launch({ args: ['.', '--no-sandbox', `--user-data-dir=${profile}`] })
const windowFor = (view) => app.windows().find((w) => w.url().endsWith('#' + view))

try {
  await wait(2500)
  // As if the overlay sent it (IPC is only accepted from Snapkit's own pages).
  await app.evaluate(({ ipcMain }) => ipcMain.emit('settings:open', { senderFrame: { url: 'file:///app/out/renderer/index.html#overlay' } }))
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

  // General starts with Startup; history keeps up to 30 (10 by default).
  await section('General')
  console.log('general groups:', await st.$$eval('.st-group > h3', (t) => t.map((e) => e.textContent).slice(0, 3).join(' | ')))
  console.log('quick area capture switch:', await st.$eval('button[aria-label="Quick area capture"]', (e) => e.getAttribute('aria-checked')).catch(() => 'missing'))
  console.log('saving rows:', await st.evaluate(() => [...[...document.querySelectorAll('.st-group')].find((g) => g.querySelector('h3')?.textContent === 'Saving').querySelectorAll('.st-label > span')].map((e) => e.textContent).slice(0, 3).join(' | ')))
  console.log('dim default:', await st.evaluate(() => window.snapkit.settingsGet().then((x) => x.defaults.capture.dimOpacity + ' / mode ' + x.defaults.appearance.mode)))
  console.log('history recording switch:', await st.$eval('button[aria-label="Recording"]', (e) => e.getAttribute('aria-checked')))
  console.log('dropdown options:', await st.$eval('select[aria-label="Keep captures for"] option', (o) => `${getComputedStyle(o).color} on ${getComputedStyle(o).backgroundColor}`))
  console.log('history keep slider:', await st.$eval('input[aria-label="Captures to keep"]', (e) => `${e.value} of ${e.max}`))
  // Open settings is a global hotkey, registered from the start.
  await section('Shortcuts')
  console.log('shortcut rows without descriptions:', await st.evaluate(() => [...[...document.querySelectorAll('.st-group')].find((g) => g.querySelector('h3')?.textContent === 'Global').querySelectorAll('.st-row')].map((r) => r.querySelector('.st-label > span').textContent + (r.querySelector('.st-label small') ? '+desc' : '')).join(', ')))
  console.log('settings hotkey row:', await st.evaluate(() => [...[...document.querySelectorAll('.st-group')].find((g) => g.querySelector('h3')?.textContent === 'Global').querySelectorAll('.st-row')].find((r) => r.querySelector('.st-label > span')?.textContent === 'Settings').querySelector('.st-hotkey').textContent),
    '| registered:', await app.evaluate(({ globalShortcut }) => globalShortcut.isRegistered('CommandOrControl+Shift+2')))
  // Switches are blue when on.
  await section('General')
  await st.click('button[aria-label="Notify when copied"]')
  await wait(400) // past the color transition
  console.log('switch on color:', await st.$eval('.switch.on', (e) => getComputedStyle(e).backgroundColor))
  await st.click('button[aria-label="Notify when copied"]')
  // File naming: "Bug" + number after.
  await st.fill('input[aria-label="File name text"]', 'Bug')
  await st.click('.st-seg[aria-label="Date position"] button:has-text("Off")')
  await st.click('.st-seg[aria-label="Number position"] button:has-text("After")')
  await st.fill('input[aria-label="Starting number"]', '7')
  await st.fill('input[aria-label="Number of digits"]', '2')
  await wait(150)
  console.log('number options:', await st.$eval('.st-number-opts', (e) => e.innerText.replace(/\n+/g, ' | ')))
  await st.fill('input[aria-label="Starting number"]', '1')
  await st.fill('input[aria-label="Number of digits"]', '3')
  await wait(200)
  console.log('name preview:', await st.$eval('.st-namer-preview', (e) => e.getAttribute('aria-label')))

  // Shortcuts: record a new capture hotkey, change a tool letter.
  await section('Shortcuts')
  await st.click('.st-hotkey')
  await st.keyboard.press(`${process.platform === 'darwin' ? 'Meta' : 'Control'}+Alt+Shift+F11`)
  await wait(300)
  console.log('hotkey button:', await st.$eval('.st-hotkey', (e) => e.textContent), '| saved:', saved().hotkeys?.capture)
  await st.fill('input[aria-label="Arrow key"]', 'w')
  await wait(200)
  console.log('arrow key saved:', saved().toolKeys?.arrow)

  // Appearance: dark theme and a darker dim.
  await section('Appearance')
  await st.click('.st-seg button:has-text("Dark")')
  await wait(300)
  console.log('mode:', await st.evaluate(() => document.documentElement.dataset.mode), '| saved:', saved().appearance?.mode)
  // Dim color: black by default; a dark blue dims capture mode in blue.
  const dimDefault = await st.evaluate(() => window.snapkit.settingsGet().then((x) => x.settings.capture.dimColor))
  await st.click('button[aria-label="Dim color: pick a color"]')
  await st.fill('.color-picker .hex', '#1e3a8a')
  await st.keyboard.press('Enter')
  await wait(200)
  console.log('dim color: default', dimDefault, '| saved', saved().capture?.dimColor)
  console.log('dim amount step:', await st.$eval('input[aria-label="Dim amount"]', (e) => e.step))
  await st.click('button[aria-label="Liquid Glass"]')
  await wait(200)
  console.log('glass toggled on (default is off):', await st.evaluate(() => document.documentElement.dataset.glass), '| saved:', saved().appearance?.glass)
  // Windows that are already open (the history panel stays loaded) follow at once.
  const hist = windowFor('history')
  console.log('history window glass:', await hist.evaluate(() => document.documentElement.dataset.glass), '| mode', await hist.evaluate(() => document.documentElement.dataset.mode))
  writeFileSync(join(out, 'dark-solid-appearance.png'), await st.screenshot())
  await st.click('button[aria-label="Liquid Glass"]') // back off: dark solid
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
  console.log('tool rows:', await st.$$eval('.st-group:has-text("Tools (vertical bar)") .st-reorder', (rs) => rs.map((r) => r.querySelector('.st-label span:not(.st-feature-icon)')?.textContent)))
  console.log('group rows:', await st.$$eval('.st-reorder.group', (rs) => rs.map((r) => r.querySelector('.st-label span:not(.st-feature-icon)')?.textContent + ' (' + r.querySelectorAll('.st-variant').length + ')')))
  await st.click('button[aria-label="Move Arrow down"]')
  await wait(200)
  console.log('arrow moved down, order:', (saved().toolbarOrder ?? []).slice(0, 4).join(', '))

  // Tools: change the first quick color.
  await section('Tools')
  await st.click('button[aria-label="Color 1: pick a color"]')
  await st.fill('.color-picker .hex', '#00aa55')
  await st.keyboard.press('Enter')
  await wait(200)
  console.log('palette saved:', saved().annotate?.palette?.[0])
  await st.click('button[aria-label="Step badge color: pick a color"]')
  await st.fill('.color-picker .hex', '#3b82f6')
  await st.keyboard.press('Enter')
  await wait(150)
  console.log('step color saved:', saved().annotate?.stepColor)
  // Step badges: outline and shadow (defaults: 2 px white, 30%).
  const outlineDefault = await st.$eval('input[aria-label="Step outline width"]', (e) => e.value)
  const shadowDefault = await st.$eval('input[aria-label="Step shadow"]', (e) => e.value)
  await st.fill('input[aria-label="Step outline width"]', '4')
  await wait(150)
  await st.click('button[aria-label="Step outline color: pick a color"]')
  await st.fill('.color-picker .hex', '#00ff00')
  await st.keyboard.press('Enter')
  await st.$eval('input[aria-label="Step shadow"]', (el) => {
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    set.call(el, '0'); el.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await wait(200)
  console.log('step outline/shadow: defaults', outlineDefault, shadowDefault, '| saved', JSON.stringify(saved().annotate?.stepStroke), saved().annotate?.stepShadow)

  // Background: pick a library gradient as the default; turn on remember-last.
  await section('Background')
  await st.click('.st-group:has-text("Gradient library") .st-lib-swatch >> nth=4')
  await st.click('.st-group:has-text("Gradient library") .st-btn:has-text("Make default")')
  await wait(200)
  const defPreset = saved().beautify.presets.find((p) => p.id === (saved().beautify.preset ?? 'ocean'))
  console.log('default background now:', JSON.stringify(defPreset?.background), '| marked:', await st.$$eval('.st-lib-default', (e) => e.length))
  await st.click('button[aria-label="Remember last background"]')
  await wait(150)
  console.log('remember last:', saved().beautify.rememberLast)
  const before = await st.$$eval('.st-group:has-text("Gradient library") .st-lib-swatch', (b) => b.length)
  await st.click('.st-group:has-text("Gradient library") .st-btn:has-text("Add")')
  await wait(150)
  console.log('gradient added first:', JSON.stringify(saved().beautify?.gradients?.[0]), '| count', before, '->', saved().beautify?.gradients?.length)
  writeFileSync(join(out, 'dark-glass-background.png'), await st.screenshot({ fullPage: true }))
  await st.click('.st-group:has-text("Gradient library") .st-btn:has-text("Reset to defaults")')
  await wait(150)
  console.log('gradients reset:', saved().beautify?.gradients?.length)

  // Capture mode picks it all up.
  await app.evaluate(({ app }) => app.emit('second-instance'))
  await wait(1000)
  const ov = windowFor('overlay')
  const m = ov.mouse
  await m.move(300, 200); await m.down(); await m.move(800, 600, { steps: 4 }); await m.up(); await wait(300)
  const tools = await ov.$$eval('.toolbar.vertical button', (bs) => bs.map((b) => b.dataset.tip))
  await ov.keyboard.press('w')
  await wait(150)
  console.log('capture: mode', await ov.evaluate(() => document.documentElement.dataset.mode + '/' + document.documentElement.dataset.glass),
    '| first tool', tools[0], '| highlighter shown', tools.includes('Highlighter'),
    '| W selects arrow', await ov.$eval('.toolbar button.active[data-id]', (b) => b.dataset.id).catch(() => 'none'),
    '| first swatch', await ov.$eval('.style-bar .swatch', (b) => b.dataset.tip).catch(() => 'none'))
  console.log('capture dims in:', await ov.$eval('.selection', (e) => getComputedStyle(e).boxShadow.split('),').slice(-1)[0].trim()))
  // A step badge drawn now uses the outline and shadow set above.
  await ov.click('.toolbar button[data-tip="Numbered step"]')
  await m.click(450, 350); await wait(200)
  console.log('step badge drawn with:', await ov.evaluate(() => {
    const c = window.Konva.stages[0].find('Circle').at(-1)
    return c ? `${c.strokeWidth()}px ${c.stroke()} shadow ${c.shadowEnabled() ? c.shadowOpacity() : 'off'}` : 'none'
  }))
  writeFileSync(join(out, 'capture-after-settings.png'), await ov.screenshot())
  // Two saves name the files Bug 001, Bug 002.
  await ov.keyboard.press(MOD + '+s')
  await wait(1000)
  await app.evaluate(({ app }) => app.emit('second-instance'))
  await wait(1000)
  const ov2 = windowFor('overlay')
  await ov2.mouse.move(300, 200); await ov2.mouse.down(); await ov2.mouse.move(600, 400, { steps: 3 }); await ov2.mouse.up(); await wait(200)
  await ov2.click('.toolbar button[data-id="beautify"]') // background on, so remember-last kicks in
  await ov2.keyboard.press(MOD + '+s')
  await wait(1200)
  console.log('saved files:', readdirSync(saves).sort(), '| next number:', saved().save.nextNumber)

  // Update check (real request to GitHub) and launch at login (read only: don't change the login items).
  await section('About')
  await st.click('.st-btn:has-text("Check now")')
  await st.waitForSelector('.st-btn:has-text("Check now"):not([disabled])', { timeout: 15000 })
  console.log('update check:', await st.$eval('.st-row:has-text("Check for updates") small', (e) => e.textContent))
  await section('General')
  console.log('launch at login row:', await st.$eval('.st-row:has-text("Launch at login") small', (e) => e.textContent))

  // Reset a section.
  await section('Appearance')
  await st.click('.st-header button:has-text("Reset section")')
  await wait(300)
  console.log('after reset: appearance', JSON.stringify(saved().appearance ?? 'default'), '| toolbar kept:', saved().features?.highlighter === false)
  console.log('settings errors:', errors.length ? errors : 'none')

  // macOS: a Dock icon while Settings is open, gone again when it closes.
  if (process.platform === 'darwin') {
    const dock = () => app.evaluate(({ app }) => app.dock.isVisible())
    const open = await dock()
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().endsWith('#settings')).close())
    await wait(800)
    const closed = await dock()
    await app.evaluate(({ app }) => app.emit('second-instance', {}, [])) // capture mode still opens
    await wait(1200)
    const capturing = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().some((w) => w.webContents.getURL().endsWith('#overlay') && w.isVisible() && w.getOpacity() > 0))
    console.log('Dock icon with Settings open:', open, '| after closing:', closed, '| capture still opens:', capturing)
  }
} finally {
  await app.close()
}
