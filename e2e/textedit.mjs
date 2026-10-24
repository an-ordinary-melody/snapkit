// Clicking into existing text edits it; dragging moves it. Usage: npm run build && node e2e/textedit.mjs <out-dir>
import { _electron as electron } from 'playwright-core'
import { mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
const out = process.argv[2] ?? 'e2e-out'; const profile = join(out, 'profile'); mkdirSync(profile, { recursive: true })
writeFileSync(join(profile, 'settings.json'), JSON.stringify({ hotkeys: { capture: 'CommandOrControl+Alt+Shift+F12' } }))
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const app = await electron.launch({ args: ['.', '--no-sandbox', `--user-data-dir=${profile}`] })
try {
  await wait(2500)
  await app.evaluate(({ app }) => app.emit('second-instance'))
  await wait(1200)
  const win = app.windows().find((w) => w.url().endsWith('#overlay'))
  const m = win.mouse
  await m.move(200, 150); await m.down(); await m.move(900, 650, { steps: 6 }); await m.up(); await wait(300)
  await win.click('.toolbar button[data-tip="Text"]'); await m.click(400, 400); await wait(150)
  await win.keyboard.type('Hello world'); await win.keyboard.press('Escape'); await wait(200)
  const ed = () => win.$eval('.text-editor', (e) => [e.value, e.selectionStart]).catch(() => null)
  const box = await win.evaluate(() => { const t = window.Konva.stages[0].find('Text')[0]; const r = t.getClientRect(); const c = t.getStage().container().getBoundingClientRect(); return { x: r.x + c.x, y: r.y + c.y, width: r.width, height: r.height } })
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2
  await m.click(cx, cy); await wait(250); console.log('selected text, click ->', JSON.stringify(await ed()))
  await win.keyboard.type('!'); await win.keyboard.press('Escape'); await wait(200)
  await win.keyboard.press('Escape'); await wait(200) // deselect
  console.log('text now:', await win.evaluate(() => window.Konva.stages[0].find('Text')[0].text()))
  await m.click(cx, cy); await wait(250); console.log('text tool, unselected text, click ->', JSON.stringify(await ed()))
  await win.keyboard.press('Escape'); await wait(200)
  // Drag still moves it (no editing).
  await m.move(cx, cy); await m.down(); await m.move(cx + 60, cy + 40, { steps: 5 }); await m.up(); await wait(250)
  console.log('after drag: editing', JSON.stringify(await ed()), '| moved to', JSON.stringify(await win.evaluate(() => window.Konva.stages[0].find('Text')[0].getClientRect())))
} finally { await app.close() }
