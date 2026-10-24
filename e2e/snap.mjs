// Smart align: a dragged shape snaps to line up with others (selected or not); ⌘ places it freely.
// Usage: npm run build && node e2e/snap.mjs <out-dir>
import { _electron as electron } from 'playwright-core'
import { mkdirSync, writeFileSync } from 'fs'
import { join, resolve } from 'path'
const out = resolve(process.argv[2] ?? 'e2e-out'); const profile = join(out, 'profile'); mkdirSync(profile, { recursive: true })
writeFileSync(join(profile, 'settings.json'), JSON.stringify({ hotkeys: { capture: 'CommandOrControl+Alt+Shift+F12' } }))
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const app = await electron.launch({ args: ['.', '--no-sandbox', `--user-data-dir=${profile}`] })
try {
  await wait(2500)
  await app.evaluate(({ app }) => app.emit('second-instance'))
  await wait(1200)
  const win = app.windows().find((w) => w.url().endsWith('#overlay'))
  const m = win.mouse
  const drag = async (x1, y1, x2, y2, hold) => {
    await m.move(x1, y1); await m.down(); await m.move(x2 + 1, y2 + 1, { steps: 6 }); await m.move(x2, y2, { steps: 2 })
    if (hold) await hold()
    await m.up(); await wait(150)
  }
  await drag(150, 100, 1000, 700)
  await win.click('.toolbar button[data-tip="Rectangle"]')
  await drag(300, 200, 400, 280) // A: left edge 300, top 200
  await drag(600, 400, 700, 480) // B
  await win.click('.toolbar button[data-tip="Rectangle"]'); await wait(150) // tool off: just move shapes
  // Shape boxes in screen (CSS) px; the editor shows the layer zoomed.
  const rects = () => win.evaluate(() => { const st = window.Konva.stages.at(-1); const c = st.container().getBoundingClientRect(); const k = c.width / st.width(); return st.find('Group').filter((g) => g.id()).map((g) => { const b = g.getClientRect({ skipStroke: true, skipShadow: true }); return [Math.round(c.x + b.x * k), Math.round(c.y + b.y * k), Math.round(k * 100) / 100] }) })
  console.log('active tool:', await win.$eval('.toolbar button.active[data-id]', (b) => b.dataset.id).catch(() => 'none'), '| rects', JSON.stringify(await rects()))
  // Grab B on its edge and move it so its left edge is 3 px from A's (300): should snap to 300.
  let guides = 0
  await drag(600, 440, 303, 440, async () => { guides = await win.evaluate(() => window.Konva.stages[0].find('Line').filter((l) => (l.dash() ?? []).length).length) })
  console.log('unselected drag -> rects', JSON.stringify(await rects()), '| guides while dragging', guides)
  // Now B is selected: drag it again, top edge 3 px off A's top (200).
  await drag(303, 470, 303 + 150, 203 + 70, async () => { guides = await win.evaluate(() => window.Konva.stages[0].find('Line').filter((l) => (l.dash() ?? []).length).length) })
  console.log('selected drag -> rects', JSON.stringify(await rects()), '| guides while dragging', guides)
  // With a drawing tool active (right after drawing): grab A and line its top up with B's (200 → B is at y 200 now, so move A down near C).
  await win.click('.toolbar button[data-tip="Rectangle"]')
  await drag(700, 500, 800, 580) // C: top 500
  await drag(300, 240, 520, 243 + 300, async () => { guides = await win.evaluate(() => window.Konva.stages[0].find('Line').filter((l) => (l.dash() ?? []).length).length) })
  console.log('tool active drag -> rects', JSON.stringify(await rects()), '| guides while dragging', guides)
  // A text box still being typed in snaps too when its frame is dragged.
  const typingDrag = async (label) => {
    const target = (await rects())[0] // A
    const ta = await win.$eval('.text-editor', (e) => e.getBoundingClientRect().toJSON())
    const fr = await win.$eval('.text-frame', (e) => e.getBoundingClientRect().toJSON())
    const dx = target[0] + 3 - ta.x
    await drag(fr.x + 2, fr.y + 2, fr.x + 2 + dx, fr.y + 2 + 30, async () => { guides = await win.evaluate(() => window.Konva.stages.at(-1).find('Line').filter((l) => (l.dash() ?? []).length).length) })
    const after = await win.$eval('.text-editor', (e) => e.getBoundingClientRect().x)
    console.log(label, '(it snaps to the nearest shape) typing text left', Math.round(after), 'vs shape', target[0], '| guides while dragging', guides, '| still typing:', !!(await win.$('.text-editor:focus')))
  }
  await win.click('.toolbar button[data-tip="Text"]')
  await m.click(760, 300); await wait(200); await win.keyboard.type('Snap me')
  await typingDrag('capture:')
  await win.keyboard.press('Escape'); await wait(150)
  writeFileSync(join(out, 'snap.png'), await win.screenshot())
  // In the background editor (zoomed): drag C so its left edge comes near B's.
  await win.click('.toolbar button[data-tip="Edit background"]'); await wait(800)
  const pos = await rects()
  console.log('editor rects', JSON.stringify(pos), '| tool', await win.$eval('.be-dock .toolbar button.active[data-id]', (b) => b.dataset.id).catch(() => 'none'))
  const [bx] = pos[1], [cx, cy] = pos[2]
  await drag(cx, cy + 20, bx + 3 + 1, cy + 60, async () => { guides = await win.evaluate(() => window.Konva.stages.at(-1).find('Line').filter((l) => (l.dash() ?? []).length).length) })
  console.log('editor drag -> rects', JSON.stringify(await rects()), '| guides while dragging', guides)
  // The Text tool may still be on from capture mode; clicking it again would turn it off.
  if (!(await win.$('.be-dock .toolbar button.active[data-id="text"]'))) await win.click('.be-dock .toolbar button[data-tip="Text"]')
  await m.click(650, 400); await wait(300)
  await win.keyboard.type('Editor text')
  await typingDrag('editor:')
  writeFileSync(join(out, 'snap-editor.png'), await win.screenshot())
} finally { await app.close() }
