// Floating preview + pin test: turn the preview on, copy, then copy / edit /
// pin from the preview. Usage: npm run build && node e2e/pin.mjs <out-dir>
import { _electron as electron } from 'playwright-core'
import { mkdirSync, writeFileSync } from 'fs'
import { join, resolve } from 'path'

const out = resolve(process.argv[2] ?? 'e2e-out')
const profile = join(out, 'profile')
mkdirSync(profile, { recursive: true })
writeFileSync(join(profile, 'settings.json'), JSON.stringify({ hotkeys: { capture: 'CommandOrControl+Alt+Shift+F12' }, notifications: { onCopy: false } }))

const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const app = await electron.launch({ args: ['.', '--no-sandbox', `--user-data-dir=${profile}`] })
const floating = (view) =>
  app.evaluate(
    ({ BrowserWindow, screen }, view) =>
      BrowserWindow.getAllWindows()
        .filter((w) => !w.isDestroyed() && w.webContents.getURL().endsWith('#' + view))
        .map((w) => ({ visible: w.isVisible(), bounds: w.getBounds(), workArea: screen.getDisplayMatching(w.getBounds()).workArea })),
    view
  )
const windowFor = (view) => app.windows().find((w) => w.url().endsWith('#' + view))
const overlayVisible = () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().some((w) => w.webContents.getURL().endsWith('#overlay') && w.isVisible() && w.getOpacity() > 0))
const clip = () => app.evaluate(({ clipboard }) => clipboard.readImage().getSize())
const drag = async (m, x1, y1, x2, y2) => {
  await m.move(x1, y1); await m.down(); await m.move(x2, y2, { steps: 5 }); await m.up(); await wait(80)
}
const capture = async () => {
  await app.evaluate(({ app }) => app.emit('second-instance'))
  await wait(900)
  const win = windowFor('overlay')
  await drag(win.mouse, 300, 200, 700, 500)
  await wait(200)
  return win
}

try {
  await wait(2500)
  const ov = await capture()
  await ov.keyboard.press('a')
  await drag(ov.mouse, 350, 250, 600, 420)
  console.log('preview toggle starts:', await ov.$eval('.toolbar button[data-id="pin"]', (b) => b.dataset.tip))
  await ov.click('.toolbar button[data-id="pin"]')
  console.log('after click:', await ov.$eval('.toolbar button[data-id="pin"]', (b) => b.dataset.tip), '| dot:', !!(await ov.$('.toolbar button[data-id="pin"] .on-dot')))
  await ov.keyboard.press('Meta+c')
  await wait(1200)
  let thumbs = await floating('thumb')
  const t = thumbs[0]
  const corner = t && Math.abs(t.bounds.x + t.bounds.width - (t.workArea.x + t.workArea.width)) <= 20 && Math.abs(t.bounds.y + t.bounds.height - (t.workArea.y + t.workArea.height)) <= 20
  console.log('preview after ⌘C:', thumbs.length, 'in the bottom-right corner:', corner, JSON.stringify(t?.bounds), '| clipboard:', JSON.stringify(await clip()))

  const thumb = windowFor('thumb')
  await thumb.hover('.thumb')
  await wait(200)
  writeFileSync(join(out, '1-thumb.png'), await thumb.screenshot())
  await app.evaluate(({ clipboard }) => clipboard.clear())
  await thumb.click('.thumb-btn:has-text("Copy")')
  await wait(200)
  console.log('copy from preview:', JSON.stringify(await clip()))

  // Edit: reopens the editor with the arrow; draw a rectangle; Done updates the preview.
  await thumb.click('.thumb-btn:has-text("Edit")')
  await wait(1000)
  const ed = windowFor('overlay')
  console.log('editor open:', !!(await ed.$('.be-backdrop')), '| drawings restored (Konva arrow nodes):', await ed.evaluate(() => window.Konva?.stages[0]?.find('Arrow').length))
  await ed.click('.be-dock .toolbar button[data-tip="Rectangle"]')
  const host = await ed.$eval('.be-ann .annotations', (e) => e.getBoundingClientRect().toJSON())
  await drag(ed.mouse, host.x + 20, host.y + 20, host.x + host.width / 2, host.y + host.height / 2)
  writeFileSync(join(out, '2-edit.png'), await ed.screenshot())
  await ed.click('.be-btn:has-text("Done")')
  await wait(800)
  console.log('Done closes the editor:', !(await overlayVisible()), '| preview still there:', (await floating('thumb')).length === 1)
  await thumb.hover('.thumb')
  writeFileSync(join(out, '3-thumb-after-edit.png'), await thumb.screenshot())

  // Move handle moves the preview (out of the corner stack).
  const before = (await floating('thumb'))[0].bounds
  const mh = await thumb.$eval('.thumb-move', (e) => e.getBoundingClientRect().toJSON())
  await thumb.hover('.thumb')
  await drag(thumb.mouse, mh.x + mh.width / 2, mh.y + mh.height / 2, mh.x + mh.width / 2 - 120, mh.y + mh.height / 2 - 80)
  await wait(200)
  const after = (await floating('thumb'))[0].bounds
  console.log('move handle moved the preview by', after.x - before.x, after.y - before.y)

  // Pin: turns the preview into a full-size pin where it was captured.
  await thumb.click('.thumb-pin')
  await wait(1000)
  console.log('pin from preview:', JSON.stringify((await floating('pin')).map((p) => p.bounds)), '| preview closed:', (await floating('thumb')).length === 0)

  // Next capture starts with the preview off (the setting's default).
  const ov2 = await capture()
  console.log('next capture starts:', await ov2.$eval('.toolbar button[data-id="pin"]', (b) => b.dataset.tip))
  await ov2.keyboard.press('Meta+c')
  await wait(800)
  console.log('no preview when off:', (await floating('thumb')).length === 0, '| pin still visible:', (await floating('pin'))[0]?.visible)

  await windowFor('pin').keyboard.press('Escape').catch(() => {})
  await wait(400)
  console.log('pin closed:', (await floating('pin')).length === 0)
} finally {
  await app.close()
}
