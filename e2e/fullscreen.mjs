// Full-screen capture and Clear history. Usage: npm run build && node e2e/fullscreen.mjs <out-dir>
import { _electron as electron } from 'playwright-core'
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'fs'
import { basename, join, resolve } from 'path'

const out = resolve(process.argv[2] ?? 'e2e-out')
const profile = join(out, 'profile')
mkdirSync(profile, { recursive: true })
writeFileSync(join(profile, 'settings.json'), JSON.stringify({ hotkeys: { capture: 'CommandOrControl+Alt+Shift+F12', fullscreen: '' }, capture: { fullscreenCopy: true } }))

const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const app = await electron.launch({ args: ['.', '--no-sandbox', `--user-data-dir=${profile}`] })
const windowFor = (view) => app.windows().filter((w) => w.url().endsWith('#' + view))

try {
  await wait(2500)
  for (let i = 0; i < 2; i++) {
    await app.evaluate(({ app }) => app.emit('second-instance', {}, ['--fullscreen']))
    await wait(1500)
  }
  const thumbs = windowFor('thumb')
  console.log('floating previews:', thumbs.length, '| overlay shown:', await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().some((w) => w.webContents.getURL().endsWith('#overlay') && w.isVisible())))
  console.log('clipboard image:', JSON.stringify(await app.evaluate(({ clipboard }) => clipboard.readImage().getSize())))
  if (thumbs[0]) writeFileSync(join(out, 'fullscreen-thumb.png'), await thumbs[0].screenshot())

  // Edit from the preview: the editor opens with the full screen and the background off.
  await thumbs[0].click('.thumb-btn:has-text("Edit")').catch((e) => console.log('edit button:', e.message.split('\n')[0]))
  await wait(1200)
  const ov = windowFor('overlay').find(Boolean)
  const errors = []
  ov.on('pageerror', (e) => errors.push(String(e)))
  writeFileSync(join(out, 'fullscreen-edit.png'), await ov.screenshot())
  console.log('editor open:', await ov.evaluate(() => !!document.querySelector('.bg-editor, .beautify-editor, canvas')))
  await ov.keyboard.press('Escape')
  await wait(500)

  await app.evaluate(({ app }) => app.emit('second-instance', {}, ['--history']))
  await wait(1000)
  const h = windowFor('history')[0]
  console.log('history entries:', await h.$$eval('.hist-card', (c) => c.length))
  // Resizable: more columns when wider, and the size is remembered.
  const cols = () => h.$eval('.hist-grid', (g) => getComputedStyle(g).gridTemplateColumns.split(' ').length)
  const before = await cols()
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().endsWith('#history')).setSize(1100, 600))
  await wait(900)
  console.log('columns:', before, '->', await cols(), '| saved size:', JSON.stringify(JSON.parse(readFileSync(join(profile, 'settings.json'), 'utf8')).history?.panel))
  console.log('default limit:', await h.evaluate(() => window.snapkit.settingsGet().then((s) => s.defaults.history.maxCount)))
  console.log('clear button:', await h.$eval('button.hist-clear', (b) => b.textContent + ' / ' + b.querySelector('svg').classList.value))
  // Drag out: the main side copies the entry to a temp file named like a capture (the native drag itself isn't run here).
  const id = await h.evaluate(() => window.snapkit.historyList().then((l) => l[0].id))
  const drag = await app.evaluate(({ ipcMain }, id) => {
    let got = null
    ipcMain.emit('history:drag-out', { senderFrame: { url: 'file:///app/out/renderer/index.html#history' }, sender: { startDrag: (o) => (got = o) } }, id)
    return got && { file: got.file, icon: got.icon.getSize() }
  }, id)
  console.log('drag file:', drag ? `${basename(drag.file)} ${statSync(drag.file).size} bytes, icon ${JSON.stringify(drag.icon)}` : 'none')
  await h.click('.hist-card >> nth=0 >> .hist-star')
  await wait(300)
  await h.click('button[aria-label="Clear history"]')
  await h.click('.hist-clear-menu button:has-text("Clear, keep starred")')
  await wait(500)
  console.log('after clear keep starred:', await h.$$eval('.hist-card', (c) => c.length))
  await h.click('button[aria-label="Clear history"]')
  await h.click('.hist-clear-menu button:has-text("Clear all")')
  console.log('confirm text:', await h.$eval('.hist-clear-menu .danger', (b) => b.textContent))
  await h.click('.hist-clear-menu .danger')
  await wait(500)
  console.log('after clear all:', await h.$$eval('.hist-card', (c) => c.length), '| errors:', errors.length ? errors : 'none')
  writeFileSync(join(out, 'history-cleared.png'), await h.screenshot())
} finally {
  await app.close()
}
