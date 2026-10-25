// Ruler tool: off by default, sits after Blur, measures in image pixels, and is part of the output.
// Usage: npm run build && node e2e/ruler.mjs <out-dir>
import { _electron as electron } from 'playwright-core'
import { mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
const out = process.argv[2] ?? 'e2e-out'; const profile = join(out, 'profile'); mkdirSync(profile, { recursive: true })
writeFileSync(join(profile, 'settings.json'), JSON.stringify({ hotkeys: { capture: 'CommandOrControl+Alt+Shift+F12' }, notifications: { onCopy: false } }))
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const app = await electron.launch({ args: ['.', '--no-sandbox', `--user-data-dir=${profile}`, ...(process.env.SNAPKIT_E2E_ARGS?.split(' ').filter(Boolean) ?? [])] })
const errors = []
const overlay = () => app.windows().find((w) => w.url().endsWith('#overlay'))
const tips = (w) => w.$$eval('.toolbar button[data-tip]', (bs) => bs.map((b) => b.dataset.tip))
const capture = async () => {
  await app.evaluate(({ app }) => app.emit('second-instance', {}, []))
  await wait(1200)
  const m = overlay().mouse
  await m.move(100, 100); await m.down(); await m.move(500, 400, { steps: 6 }); await m.up(); await wait(300)
}
try {
  await wait(2500)
  for (let i = 0; i < 40 && !overlay(); i++) await wait(250)
  overlay().on('pageerror', (e) => errors.push(e.message))
  await capture()
  console.log('off by default:', !(await tips(overlay())).includes('Ruler'))
  await overlay().keyboard.press('Escape'); await wait(500)

  await overlay().evaluate(() => window.snapkit.settingsUpdate({ features: { ruler: true } })); await wait(300)
  await capture()
  const w = overlay()
  const list = await tips(w)
  console.log('right after Blur:', list.indexOf('Ruler') === list.indexOf('Blur') + 1, JSON.stringify(list))
  // Draw a 200 px (screen points) horizontal ruler with its key.
  await w.keyboard.press('m'); await wait(150)
  const m = w.mouse
  await m.move(150, 250); await m.down(); await m.move(350, 250, { steps: 6 }); await m.up(); await wait(300)
  const scale = await w.evaluate(() => devicePixelRatio)
  const label = await w.evaluate(() => window.Konva.stages[0].findOne('.ruler-label')?.findOne('Text')?.text() ?? null)
  console.log('measures in image pixels:', label === `${Math.round(200 * scale)} px`, label, scale)
  // Drag an end: the length follows.
  await w.keyboard.press('m'); await wait(150) // back to moving / selecting
  await m.click(250, 250); await wait(250)
  await m.move(350, 250); await m.down(); await m.move(450, 250, { steps: 5 }); await m.up(); await wait(300)
  const after = await w.evaluate(() => window.Konva.stages[0].findOne('.ruler-label')?.findOne('Text')?.text() ?? null)
  await m.click(480, 380); await wait(200) // deselect for a clean picture
  writeFileSync(join(out, 'ruler.png'), await w.screenshot({ clip: { x: 120, y: 200, width: 360, height: 100 } }))
  console.log('dragging an end updates the length:', after === `${Math.round(300 * scale)} px`, after)
  console.log('renderer errors:', errors.length ? errors.join(' | ') : 'none')
} finally { await app.close() }
