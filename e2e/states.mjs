// States that overlapping work used to break (docs/state-machines.md): late text reads, two reads at
// once, drawing in Capture text, an area moving to another display, remembered picks, Esc during a
// copy, double clicks on the preview, and a pin saved twice. Text reading is replaced by a stand-in
// with set delays. Usage: npm run build && node e2e/states.mjs <out-dir>
import { _electron as electron } from 'playwright-core'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'fs'
import { join, resolve } from 'path'

const out = resolve(process.argv[2] ?? 'e2e-out')
const profile = join(out, 'profile')
const saves = join(out, 'saves')
mkdirSync(profile, { recursive: true })
mkdirSync(saves, { recursive: true })
writeFileSync(
  join(profile, 'settings.json'),
  JSON.stringify({
    hotkeys: { capture: 'CommandOrControl+Alt+Shift+F12', ocr: '' },
    notifications: { onCopy: false, onSave: false },
    ocr: { textButton: 'copy' },
    // Saving compresses (on a worker thread), so a save takes a moment and a second one can overlap it.
    compress: { enabled: true, applyTo: 'save' },
    save: { folder: saves, askLocation: false, name: { text: 'Pin', date: 'none', number: 'after', digits: 3 } }
  })
)
const MOD = process.platform === 'darwin' ? 'Meta' : 'Control'
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
// A fixed test screen instead of the real one (the scene hook, see e2e/scene.mjs): these checks are
// about timing, not pixels, and they then also run while the Mac is locked.
const fixtures = resolve(import.meta.dirname, '..', 'fixtures')
const app = await electron.launch({
  args: ['.', '--no-sandbox', `--user-data-dir=${profile}`, ...(process.env.SNAPKIT_E2E_ARGS?.split(' ').filter(Boolean) ?? [])],
  env: { ...process.env, SNAPKIT_SCENE: join(fixtures, 'scenes', 'overlay-dim.json'), SNAPKIT_FIXTURES: fixtures }
})
const errors = []
// The newest window of a kind (a capture window that stopped answering is replaced by a new one).
const win = (hash) => app.windows().filter((w) => w.url().endsWith('#' + hash) && !w.isClosed()).at(-1)
const overlay = () => win('overlay')
const capturing = () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().some((w) => w.webContents.getURL().endsWith('#overlay') && w.isVisible() && w.getOpacity() > 0))
const clipboardText = () => app.evaluate(({ clipboard }) => clipboard.readText())
const historyCount = () => (existsSync(join(profile, 'history', 'index.json')) ? JSON.parse(readFileSync(join(profile, 'history', 'index.json'), 'utf8')).length : 0)
/** Waits for `fn` to be true (the machine may be busy: no fixed delays). */
const until = async (fn, ms = 8000) => {
  for (const end = Date.now() + ms; Date.now() < end; await wait(100)) if (await fn().catch(() => false)) return true
  return false
}
const open = async (args = []) => {
  await until(async () => !(await capturing()))
  await app.evaluate(({ app }, a) => void setTimeout(() => app.emit('second-instance', {}, a)), args) // see e2e/scene.mjs
  await until(async () => (await capturing()) && (await overlay().evaluate(() => !!document.querySelector('.dim-full'))))
  await wait(300)
}
const close = async () => {
  if (await capturing()) await overlay().keyboard.press('Escape')
  await until(async () => !(await capturing()))
}
const drag = async (x1, y1, x2, y2) => {
  const m = overlay().mouse
  await m.move(x1, y1); await m.down(); await m.move(x2, y2, { steps: 4 }); await m.up()
  await until(() => overlay().evaluate(() => !!document.querySelector('.handles, .ocr-reading, .ocr-note')), 2000)
}
/** Text reading answers after plan.ms with plan.text: plan is one answer, or one per image width (px). */
const planReads = (plan) =>
  app.evaluate(({ ipcMain }, plan) => {
    ipcMain.removeHandler('capture:ocr')
    ipcMain.handle('capture:ocr', async (_e, png) => {
      const width = Buffer.from(png).readUInt32BE(16) // from the PNG header
      const { ms, text } = plan.ms !== undefined ? plan : (plan[width] ?? { ms: 0, text: `unexpected width ${width}` })
      await new Promise((r) => setTimeout(r, ms))
      return { lines: text ? [{ text, x: 0, y: 0, w: 40, h: 10 }] : [], engine: 'test', ms }
    })
  }, plan)

/** One check; a failure is reported and capture mode closed, so the next one starts clean. */
const scenario = async (n, fn) => {
  try {
    await fn()
  } catch (err) {
    console.log(`scenario ${n} failed: ${String(err).split('\n')[0]}`)
    if (await capturing().catch(() => false)) await overlay().keyboard.press('Escape').catch(() => {})
    await wait(500)
  }
}

try {
  await wait(2500)
  for (let i = 0; i < 40 && !overlay(); i++) await wait(250)
  overlay().on('pageerror', (e) => errors.push(e.message))
  const ov = () => overlay()

  // 1. A text read still going when capture mode closes doesn't land in the next capture.
  await scenario(1, async () => {
    await app.evaluate(({ clipboard }) => clipboard.writeText('before'))
    await planReads({ ms: 1500, text: 'late text' })
    await open()
    await drag(200, 150, 600, 400); await wait(200)
    await ov().keyboard.press('x')
    await until(() => ov().evaluate(() => !!document.querySelector('.ocr-reading')), 2000)
    await ov().keyboard.press('Escape')
    await open()
    await drag(200, 150, 600, 400); await wait(2500) // the late result arrives meanwhile
    const lateNote = await ov().$eval('.ocr-note', (e) => e.textContent).catch(() => 'none')
    await ov().keyboard.press('r'); await wait(150)
    const rectActive = !!(await ov().$('.toolbar button.active[data-id="rect"]'))
    console.log(`late read: note ${lateNote} | tools still work: ${rectActive} | clipboard: ${await clipboardText()}`)
    await close()
  })

  // 2. Two text reads at once (Capture text, two areas quickly): only the second one is copied.
  await scenario(2, async () => {
    await app.evaluate(({ clipboard }) => clipboard.writeText('before'))
    // The first area (300 points = 600 px wide) answers slowly, the second (400 points) quickly.
    await planReads({ 600: { ms: 700, text: 'first area' }, 800: { ms: 100, text: 'second area' } })
    await open(['--text'])
    await drag(200, 150, 500, 300)
    await drag(200, 350, 600, 500)
    await until(async () => !(await capturing()), 5000)
    await wait(1000) // the first read's answer (700 ms) comes after the second one's
    console.log(`two reads: clipboard ${await clipboardText()}`)
    await close()
  })

  // 3. Capture text has no drawing, and ⌘C doesn't copy the image.
  await scenario(3, async () => {
    await planReads({ ms: 50, text: '' })
    await open(['--text'])
    await drag(200, 150, 600, 400); await wait(400)
    await ov().keyboard.press('r'); await wait(100)
    await drag(300, 200, 400, 300); await wait(200)
    const drawLayer = !!(await ov().$('.konvajs-content'))
    await ov().keyboard.press(MOD + '+c'); await wait(500)
    console.log(`capture text: drawing layer ${drawLayer} | still capturing after ${MOD}+C: ${await capturing()}`)
    await close()
  })

  // 4. The area moving to another display takes its drawings and the editor with it.
  await scenario(4, async () => {
    await open()
    await drag(200, 150, 700, 500); await wait(200)
    await ov().keyboard.press('r'); await wait(100)
    await drag(300, 200, 450, 320); await wait(200)
    await ov().click('.toolbar button[data-id="beautifyEdit"]').catch(() => {})
    await wait(300)
    const editorBefore = !!(await ov().$('.be-row'))
    await app.evaluate(({ BrowserWindow }) => {
      for (const w of BrowserWindow.getAllWindows()) if (w.webContents.getURL().endsWith('#overlay')) w.webContents.send('overlay:clear-selection')
    })
    await wait(300)
    await drag(250, 200, 650, 450); await wait(300)
    const editorAfter = !!(await ov().$('.be-row'))
    const undoOff = await ov().$eval('.toolbar button[data-id="undo"]', (b) => b.getAttribute('aria-disabled')).catch(() => 'missing')
    console.log(`area moved away: editor before ${editorBefore} | editor after a new area ${editorAfter} | nothing to undo ${undoOff}`)
    await close()
  })

  // 5. A changed background default (as "Remember last background" does after a copy) keeps the color picked.
  await scenario(5, async () => {
    await open()
    await drag(200, 150, 600, 400); await wait(200)
    await ov().keyboard.press('r'); await wait(150)
    const picked = await ov().$$eval('.style-bar .swatch', (s) => { s[2].click(); return s[2].dataset.tip })
    await wait(150)
    await ov().keyboard.press('Escape'); await ov().keyboard.press('Escape'); await wait(500)
    await ov().evaluate(() => window.snapkit.settingsUpdate({ beautify: { presets: [{ id: 'ocean', name: 'Blossom', background: { type: 'solid', color: '#123456' }, padding: 30, radius: 8, shadow: 0 }] } }))
    await wait(300)
    await open()
    await drag(200, 150, 600, 400); await wait(200)
    await ov().keyboard.press('r'); await wait(150)
    const kept = await ov().$eval('.style-bar .swatch.active', (s) => s.dataset.tip).catch(() => 'none')
    console.log(`color after background default changed: picked ${picked} | kept ${kept === picked}`)
    await close()
  })

  // 6. Esc right after ⌘C (while the image is still being made): history gets the capture only if it was copied.
  await scenario(6, async () => {
    await app.evaluate(({ clipboard }) => clipboard.clear())
    const historyBefore = historyCount()
    await open()
    const [sw, sh] = await ov().evaluate(() => [window.innerWidth, window.innerHeight])
    await drag(5, 5, sw - 5, sh - 5) // the whole screen: the image takes a while to make
    await ov().keyboard.press(MOD + '+c')
    await ov().keyboard.press('Escape')
    await wait(2500)
    const copied = await app.evaluate(({ clipboard }) => !clipboard.readImage().isEmpty())
    const added = historyCount() - historyBefore
    console.log(`Esc during copy: copied ${copied} | history entries added ${added} | consistent ${added === (copied ? 1 : 0)}`)
  })

  // 7. Floating preview: double-clicking its Copy button copies, it doesn't open the editor.
  await scenario(7, async () => {
    await open()
    await drag(200, 150, 600, 400); await wait(200)
    await ov().click('.toolbar button[data-id="pin"]'); await wait(100)
    await ov().keyboard.press(MOD + '+c')
    await until(async () => !!win('thumb'))
    await wait(800)
    const thumb = win('thumb')
    await thumb.dblclick('.thumb-btn >> nth=0'); await wait(800)
    console.log(`preview Copy double-clicked: editor opened ${await capturing()}`)
    await close()
  })

  // 8. Pin: ⌘S twice while the first save is still compressing saves one file.
  await scenario(8, async () => {
    await win('thumb').click('.thumb-pin')
    await until(async () => !!win('pin'))
    await wait(500)
    const pin = win('pin')
    await pin.keyboard.press(MOD + '+s')
    await pin.keyboard.press(MOD + '+s')
    await wait(2500)
    console.log(`pin saved twice quickly: files ${readdirSync(saves).filter((f) => f.endsWith('.png')).length}`)
  })

  console.log('renderer errors:', errors.length ? errors.join(' | ') : 'none')
} finally {
  await app.close()
}
