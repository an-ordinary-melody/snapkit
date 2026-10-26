// Copy text (OCR): reads known English and Vietnamese text on screen through the text panel, the
// Capture text hotkey, and an empty area. Usage: npm run build && node e2e/ocr.mjs <out-dir>
import { _electron as electron } from 'playwright-core'
import { mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
const out = process.argv[2] ?? 'e2e-out'; const profile = join(out, 'profile'); mkdirSync(profile, { recursive: true })
writeFileSync(join(profile, 'settings.json'), JSON.stringify({ hotkeys: { capture: 'CommandOrControl+Alt+Shift+F12', ocr: '' }, notifications: { onCopy: false }, ocr: { vietnamese: 'on' } }))
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const app = await electron.launch({ args: ['.', '--no-sandbox', `--user-data-dir=${profile}`, ...(process.env.SNAPKIT_E2E_ARGS?.split(' ').filter(Boolean) ?? [])] })
const errors = []
const overlay = () => app.windows().find((w) => w.url().endsWith('#overlay'))
const LINES = ['Invoice 2041 Total 1280 USD', 'Hóa đơn số 2041 đã thanh toán', 'Cảm ơn quý khách']
const norm = (s) => s.normalize('NFC').replace(/\s+/g, ' ').trim()
const capturing = () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().some((w) => w.webContents.getURL().endsWith('#overlay') && w.isVisible() && w.getOpacity() > 0))
const drag = async (x1, y1, x2, y2) => {
  const m = overlay().mouse
  await m.move(x1, y1); await m.down(); await m.move(x2, y2, { steps: 6 }); await m.up()
}
try {
  await wait(2500)
  for (let i = 0; i < 40 && !overlay(); i++) await wait(250)
  // The text window needs a real screen (the 150% CI run's screen is 456 × 342 points).
  const [sw, sh] = await overlay().evaluate(() => [window.innerWidth, window.innerHeight])
  if (sw < 800 || sh < 480) {
    console.log(`ocr test: skipped (screen ${sw} × ${sh} is too small)`)
    process.exit(0)
  }
  overlay().on('pageerror', (e) => errors.push(e.message))
  // A window with known text at the top-left of the screen (overlay coordinates 40,40 to 760,440), blank below the text.
  await app.evaluate(({ BrowserWindow, screen }, lines) => {
    const { x, y } = screen.getPrimaryDisplay().bounds
    const w = new BrowserWindow({ x: x + 40, y: y + 40, width: 720, height: 400, frame: false, show: false, alwaysOnTop: true, backgroundColor: '#ffffff' })
    const html = `<body style="margin:0;padding:24px 28px;font:28px -apple-system,'Segoe UI',sans-serif;color:#111;background:#fff">${lines.map((l) => `<div style="margin-bottom:22px">${l}</div>`).join('')}</body>`
    w.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html))
    w.once('ready-to-show', () => w.showInactive())
    globalThis.__textWin = w
  }, LINES)
  await wait(1500)
  // macOS hides Snapkit's windows (this one too) when capture mode gives the keyboard back: show it again first.
  const start = async (args) => {
    await app.evaluate(() => { const w = globalThis.__textWin; w.showInactive(); w.moveTop() })
    for (let i = 0; i < 20 && !(await app.evaluate(() => globalThis.__textWin.isVisible() && !globalThis.__textWin.webContents.isLoading())); i++) await wait(150)
    await wait(500)
    await app.evaluate(({ app }, a) => app.emit('second-instance', {}, a), args); await wait(1300)
  }

  // Capture mode → select the text → X → the text panel.
  await start([])
  await drag(45, 45, 755, 275); await wait(300)
  const t0 = Date.now()
  await overlay().keyboard.press('x')
  await overlay().waitForSelector('.ocr-panel textarea', { timeout: 120000 })
  const firstMs = Date.now() - t0
  const panel = await overlay().$eval('.ocr-panel textarea', (t) => t.value)
  const got = panel.split('\n').map(norm)
  console.log('panel text matches:', LINES.every((l) => got.includes(norm(l))), JSON.stringify(got), `| first read ${firstMs} ms`)
  writeFileSync(join(out, 'ocr-panel.png'), await overlay().screenshot({ clip: { x: 20, y: 20, width: 1120, height: 460 } }))
  console.log('lines outlined:', await overlay().$$eval('.ocr-hit', (h) => h.length))
  await overlay().click('.ocr-actions button:has-text("One line")')
  await overlay().click('.ocr-actions button:has-text("Copy text")'); await wait(800)
  const clip = norm(await app.evaluate(({ clipboard }) => clipboard.readText()))
  console.log('copied as one line:', clip === LINES.map(norm).join(' '), '| capture closed:', !(await capturing()))

  // Capture text, "Show text first" (the default): drag, and the text panel opens (no toolbars); Copy text copies and closes.
  await start(['--text'])
  const hint = await overlay().$eval('.ocr-hint', (e) => e.textContent).catch(() => null)
  await drag(45, 45, 755, 275)
  await overlay().waitForSelector('.ocr-panel textarea', { timeout: 30000 }).catch(() => {})
  const textPanel = await overlay().$eval('.ocr-panel textarea', (t) => t.value).catch(() => '')
  const toolbarsHidden = !(await overlay().$('.toolbar button[data-tip="Copy"]'))
  await overlay().click('.ocr-actions button:has-text("Copy text")').catch(() => {}); await wait(800)
  const clip2 = (await app.evaluate(({ clipboard }) => clipboard.readText())).split('\n').map(norm)
  console.log('capture text shows the panel:', LINES.every((l) => textPanel.split('\n').map(norm).includes(norm(l))), '| hint:', hint, '| toolbars hidden:', toolbarsHidden, '| copied:', LINES.every((l) => clip2.includes(norm(l))), '| closed:', !(await capturing()))

  // Capture text, "Copy right away": drag and it's copied, with a message, then capture mode closes.
  await overlay().evaluate(() => window.snapkit.settingsUpdate({ ocr: { textButton: 'copy' } })); await wait(300)
  await app.evaluate(({ clipboard }) => clipboard.writeText('old'))
  await start(['--text'])
  const t1 = Date.now()
  await drag(45, 45, 755, 275)
  await overlay().waitForSelector('.ocr-note', { timeout: 30000 })
  const readMs = Date.now() - t1
  const note = await overlay().$eval('.ocr-note', (e) => e.textContent)
  await wait(1200)
  const clip3a = (await app.evaluate(({ clipboard }) => clipboard.readText())).split('\n').map(norm)
  console.log('copy right away:', LINES.every((l) => clip3a.includes(norm(l))), '| note:', note, '| closed:', !(await capturing()), `| read ${readMs} ms`)
  await overlay().evaluate(() => window.snapkit.settingsUpdate({ ocr: { textButton: 'panel' } })); await wait(300)

  // An area with no text (the blank lower part of the window).
  await start([])
  await drag(300, 320, 700, 430); await wait(300)
  await overlay().keyboard.press('x')
  await overlay().waitForSelector('.ocr-note', { timeout: 30000 }).catch(() => {})
  console.log('empty area:', await overlay().$eval('.ocr-note', (e) => e.textContent).catch(() => 'no message'), '| still capturing:', await capturing())
  await overlay().keyboard.press('Escape'); await wait(400)
  // The floating preview's Text button reads the copied image.
  await overlay().evaluate(() => window.snapkit.settingsUpdate({ pin: { afterCopy: true } })); await wait(300)
  await start([])
  await drag(45, 45, 755, 275); await wait(300)
  await overlay().keyboard.press(process.platform === 'darwin' ? 'Meta+c' : 'Control+c'); await wait(1500)
  const thumb = app.windows().find((w) => w.url().endsWith('#thumb'))
  await app.evaluate(({ clipboard }) => clipboard.writeText('old'))
  await thumb.click('.thumb-btn[title="Capture Text (OCR)"]')
  await thumb.waitForSelector('.thumb-btn[title="Capture Text (OCR)"]:has-text("Copied")', { timeout: 30000 }).catch(() => {})
  const label = await thumb.$eval('.thumb-btn[title="Capture Text (OCR)"]', (b) => b.textContent)
  const clip3 = (await app.evaluate(({ clipboard }) => clipboard.readText())).split('\n').map(norm)
  console.log('preview Text button:', label, '| copied:', LINES.every((l) => clip3.includes(norm(l))))
  console.log('renderer errors:', errors.length ? errors.join(' | ') : 'none')
} finally { await app.close() }
