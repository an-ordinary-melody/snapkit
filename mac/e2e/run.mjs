// Native Mac app flow checks: drives a debug build in test mode (fixed test screen, isolated profile,
// private pasteboard) through snapkitctl and checks its state, like the Electron e2e suites. Each check
// carries the label of the Electron check it ports (docs/native-mac-testing.md §2).
// Usage: node mac/e2e/run.mjs [suite …]      (builds first; suites: capture annotate output safety hotkeys)
// Note: capture mode really opens on screen while this runs (about 30 s).
import { execFileSync, spawn, spawnSync } from 'child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join, resolve } from 'path'

const mac = resolve(import.meta.dirname, '..')
const env = process.env
const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { cwd: mac, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts })
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

console.log('building…')
run('scripts/build-app.sh', [])
run('swift', ['build', '--product', 'snapkitctl'])
const ctl = join(run('swift', ['build', '--show-bin-path']).trim(), 'snapkitctl')
const root = mkdtempSync(join(tmpdir(), 'snapkit-native-e2e-'))
// Run a copy from the temp folder: the app then never touches ~/Desktop (where the repo may live),
// so macOS doesn't ask for folder access again after every (ad-hoc signed) build.
const app = join(root, 'Snapkit Dev.app')
cpSync(join(mac, 'build', 'Snapkit Dev.app'), app, { recursive: true, verbatimSymlinks: true })
const screenPng = join(root, 'screen.png')
const stateFile = join(root, 'state.json')
const logFile = join(process.env.HOME, 'Library/Logs/Snapkit Dev/main.log')

// A test screen at the main display's size: five colour bands.
run(ctl, ['make-screen', screenPng])

const results = []
const check = (ok, label, detail = '') => {
  results.push({ ok, label })
  console.log(`${ok ? '  ✓' : '  ✗'} ${label}${ok || !detail ? '' : `  (${detail})`}`)
}

let profile
async function launch(settings = {}, extra = []) {
  quit()
  profile = join(root, `profile-${results.length}`)
  mkdirSync(profile, { recursive: true })
  const saves = join(profile, 'saved')
  writeFileSync(join(profile, 'settings.json'), JSON.stringify({ hotkeys: { capture: 'CommandOrControl+Alt+Shift+F12' }, ...settings, save: { folder: saves, askLocation: false, ...settings.save } }))
  spawnSync('open', ['-n', app, '--args', '-SnapkitTestScreen', screenPng, '-SnapkitProfile', profile, '-SnapkitTestOut', stateFile, '-SnapkitTestPasteboard', 'com.charios.snapkit.dev.e2e', ...extra])
  for (let i = 0; i < 50 && !alive(); i++) await wait(100)
  // Ready once it answers (the first command right after launch can be missed).
  for (let i = 0; i < 20; i++) {
    rmSync(stateFile, { force: true })
    send('state')
    if (existsSync(stateFile)) break
    await wait(200)
  }
  return saves
}
const alive = () => spawnSync('pgrep', ['-f', 'Snapkit Dev.app/Contents/MacOS/Snapkit']).status === 0
function quit() {
  spawnSync('pkill', ['-f', 'Snapkit Dev.app/Contents/MacOS/Snapkit'])
  spawnSync('sleep', ['0.4'])
}
const send = (...args) => run(ctl, [...args.map(String), '--wait', '250'])
async function state() {
  rmSync(stateFile, { force: true })
  send('state')
  // Up to 5 s: a compressed copy in a debug build can keep the app busy for over a second.
  for (let i = 0; i < 100 && !existsSync(stateFile); i++) await wait(50)
  return JSON.parse(readFileSync(stateFile, 'utf8'))
}
async function waitFor(pred, ms = 8000) {
  let s
  for (let t = 0; t < ms; t += 200) {
    s = await state()
    if (pred(s)) return s
    await wait(200)
  }
  return s
}
const logSince = (mark) => readFileSync(logFile, 'utf8').slice(mark)
const logMark = () => (existsSync(logFile) ? readFileSync(logFile, 'utf8').length : 0)

const SUITES = {
  async capture() {
    await launch()
    send('capture')
    await wait(300)
    let s = await state()
    check(s.capturing && s.hasImage && s.visiblePanels === s.panels, 'capture mode opens with the frozen screen on every display', JSON.stringify(s))
    if (s.screenLocked) console.log('  - capture window has the keyboard: skipped (the screen is locked, so no window can take the keyboard)')
    else check(s.isKeyWindow, 'capture window has the keyboard (non-activating panel)')
    send('select', 300, 200, 600, 400)
    s = await state()
    check(JSON.stringify(s.selection) === '[300,200,600,400]', 'drag selects an area', JSON.stringify(s.selection))
    send('key', 'right', 'shift')
    send('key', 'down')
    s = await state()
    check(JSON.stringify(s.selection) === '[310,201,600,400]', 'arrows nudge the selection; Shift = 10 pt', JSON.stringify(s.selection))
    send('key', 'right', 'option')
    s = await state()
    check(JSON.stringify(s.selection) === '[310,201,601,400]', 'Option + arrow resizes', JSON.stringify(s.selection))
    send('key', 'esc')
    s = await state()
    check(!s.capturing, 'Esc closes capture mode')
    check(s.visiblePanels === 0, 'no capture window left on screen')
  },

  async annotate() {
    await launch()
    send('capture')
    send('select', 300, 200, 600, 400)
    send('tool', 'arrow')
    send('drag', 360, 260, 700, 480)
    send('tool', 'rect')
    send('drag', 650, 250, 820, 380, 'shift')
    send('tool', 'pen')
    send('drag', 400, 500, 560, 540)
    send('drag', 400, 500, 400, 500)
    let s = await state()
    check(JSON.stringify(s.shapes) === '["arrow","rect","pen"]', 'arrow, rectangle and pencil draw; a click draws nothing', JSON.stringify(s.shapes))
    send('tool', 'text')
    send('type', 'Hello Snapkit')
    send('key', 'esc')
    s = await state()
    check(s.capturing && !s.typing && s.shapes.at(-1) === 'text', 'Esc while typing ends the text, not the capture')
    send('key', 'z', 'cmd')
    s = await state()
    check(s.shapes.length === 3, 'undo (⌘Z)', JSON.stringify(s.shapes))
    send('key', 'z', 'cmd', 'shift')
    s = await state()
    check(s.shapes.length === 4, 'redo (⇧⌘Z)')
    send('key', 'r')
    s = await state()
    check(s.tool === 'rect', 'tool letter keys (R)')
    send('drag', 1000, 100, 1100, 150)
    s = await state()
    check(JSON.stringify(s.selection) === '[300,200,600,400]' && s.shapes.length === 4, 'once something is drawn, a click outside keeps the selection')
    send('key', 'esc')
  },

  async output() {
    let saves = await launch()
    send('capture')
    send('select', 300, 200, 600, 400)
    send('tool', 'arrow')
    send('drag', 360, 260, 700, 480)
    send('key', 'c', 'cmd')
    let s = await state()
    check(!s.capturing, '⌘C copies and closes capture mode')
    check(JSON.stringify(s.clipboardSize) === '[1200,800]', 'copy is the selection at full resolution (600×400 pt on Retina = 1200×800)', JSON.stringify(s.clipboardSize))
    check(s.clipboardPngBytes > 1000, 'the clipboard holds PNG bytes')
    check(s.clipboardMatchesScreen === true, 'the copy has the screen pixels where nothing is drawn')
    const last = JSON.parse(readFileSync(join(profile, 'last-area.json'), 'utf8'))
    check(last.rect.x === 300 && last.rect.width === 600 && typeof last.displayId === 'number', 'the copied area is remembered in last-area.json (Electron format)')

    saves = await launch({ save: { name: { text: 'Bug', date: 'none', number: 'after', digits: 3 } } })
    for (let i = 0; i < 2; i++) {
      send('capture')
      send('select', 100, 100, 200, 100)
      send('key', 's', 'cmd')
      await wait(200)
    }
    const files = existsSync(saves) ? readdirSync(saves).sort() : []
    check(JSON.stringify(files) === '["Bug 001.png","Bug 002.png"]', 'numbered file names', JSON.stringify(files))
    const saved = JSON.parse(readFileSync(join(profile, 'settings.json'), 'utf8'))
    check(saved.save.nextNumber === 3, 'next number saved to settings.json', String(saved.save.nextNumber))

    await launch({ capture: { quickCopy: true } })
    send('capture')
    send('select', 300, 200, 300, 200)
    await wait(200)
    s = await state()
    check(!s.capturing && JSON.stringify(s.clipboardSize) === '[600,400]', 'Quick area capture copies the drawn area', JSON.stringify(s))
  },

  // Phase 2: ports of the Electron annotate, textedit, snap, ruler and regressions checks for drawing.
  async editor() {
    await launch({ features: { ruler: true, redo: true } })
    const shape = (s, i) => s.shapeData[i]
    send('capture')
    send('select', 300, 200, 600, 400)
    let s = await state()
    check(JSON.stringify(s.toolbar.slice(0, 8)) === '["pen","arrow","rect","highlighter","text","step","blur","ruler"]', 'Ruler sits right after Blur', JSON.stringify(s.toolbar))

    // Text: Enter adds a line; styles; size; readable text on a dark background.
    send('tool', 'text')
    send('type', 'Hello\\nSnapkit')
    s = await state()
    check(s.typing, 'typing into a new text box')
    send('key', 'esc')
    s = await state()
    check(shape(s, 0)?.text === 'Hello\nSnapkit' && s.capturing && !s.typing, 'Enter adds a line: "Hello\\nSnapkit"; Esc ends the text, not the capture', JSON.stringify(shape(s, 0)))
    check(s.selected === shape(s, 0)?.id, 'finished text stays selected')
    send('style', 'look:stroke')
    s = await state()
    check(JSON.stringify(s.styleActive.filter((x) => x.startsWith('look:'))) === '["look:stroke"]', 'one text style at a time')
    send('fontsize', 36)
    s = await state()
    check(shape(s, 0).fontSize === 36, 'typed text size applies')
    send('style', 'look:dark')
    s = await state()
    check(shape(s, 0).color === '#ffffff' && shape(s, 0).background !== '', 'dark background sets white text', JSON.stringify(shape(s, 0)))

    // Click into selected text to edit it; edits are kept; dragging text moves it without editing.
    const t = shape(s, 0)
    send('click', t.x + 10, t.y + 10)
    s = await state()
    check(s.typing, 'click into selected text to edit it')
    send('type', '!')
    send('key', 'esc')
    s = await state()
    check(shape(s, 0).text === 'Hello\nSnapkit!', 'edits are kept', JSON.stringify(shape(s, 0).text))
    send('key', 'esc') // deselect; the Text tool is still on
    send('click', t.x + 10, t.y + 10)
    s = await state()
    check(s.typing, 'click into text with the Text tool')
    send('key', 'esc')
    send('tool', 'text') // Text tool off (and nothing selected)
    const before = (await state()).shapeData[0]
    send('drag', before.x + 10, before.y + 10, before.x + 60, before.y + 40)
    s = await state()
    check(!s.typing && Math.round(shape(s, 0).x - before.x) === 50, 'dragging text moves it without editing', `${shape(s, 0).x - before.x}`)

    // Highlighter: its own five colours, no custom ones.
    send('tool', 'highlighter')
    s = await state()
    check(s.styleBar.filter((x) => x.startsWith('color:')).length === 5 && !s.styleBar.includes('custom'), 'highlighter has its own five colors')
    send('tool', 'highlighter')

    // Arrow: right-click menu, two-way arrow, style bar follows the selected arrow.
    send('variants', 'arrow')
    s = await state()
    check(s.popover === 'variants:arrow', 'arrow right-click menu')
    send('key', 'esc')
    s = await state()
    check(s.capturing && !s.popover, 'Esc closes the menu, not the capture')
    send('variant', 'arrow', 'arrow-both')
    send('drag', 400, 450, 600, 520)
    s = await state()
    const arrow = s.shapeData.at(-1)
    check(arrow.type === 'arrow' && arrow.bothEnds === true && arrow.head === 'open', 'two-way arrow draws a head at each end')
    send('tool', 'arrow')
    send('click', 500, 485)
    s = await state()
    check(s.selected === arrow.id && s.styleBar.includes('width:0'), 'style bar follows the selected arrow', JSON.stringify([s.selected, s.styleBar]))
    send('style', 'width:2')
    s = await state()
    check(s.shapeData.at(-1).width === 8, 'restyle the selected arrow (thick = 8 px)')
    send('drag', 400, 450, 380, 430)
    s = await state()
    check(s.shapeData.at(-1).points[0] === 380, 'drag a line end', JSON.stringify(s.shapeData.at(-1).points))

    // Custom colour: picker, then a swatch for it. Esc closes only the picker.
    send('style', 'custom')
    s = await state()
    check(s.popover === 'picker:custom', 'custom color picker opens')
    const [px, py, pw, ph] = s.popoverFrame
    check(px >= 0 && py >= 0 && px + pw <= s.screen[0] && py + ph <= s.screen[1], 'picker fully visible')
    send('key', 'esc')
    s = await state()
    check(s.capturing && !s.popover, 'Esc closes only the color picker')
    send('style', 'custom')
    send('pick', '#00aa55')
    s = await state()
    check(s.styleBar.includes('color:#00aa55') && s.shapeData.at(-1).color === '#00aa55', 'custom swatch added; the selected arrow takes it')

    // Rectangle colour isn't changed by a text style.
    send('key', 'esc')
    send('tool', 'rect')
    send('drag', 700, 250, 850, 350)
    s = await state()
    const rect = s.shapeData.at(-1)
    check(rect.type === 'rect' && rect.color === '#00aa55', 'shapes use the current colour')

    // Blur: clickable, adjustable, down to 0.
    send('tool', 'blur')
    send('drag', 320, 320, 420, 400)
    send('tool', 'blur')
    send('click', 370, 360)
    s = await state()
    check(s.shapeData.at(-1).type === 'blur' && s.selected === s.shapeData.at(-1).id, 'a blur area can be clicked (hit-testing)')
    send('blur', 36)
    s = await state()
    check(s.shapeData.at(-1).strength === 36, 'blur strength: 36')
    send('blur', 0)
    s = await state()
    check(s.shapeData.at(-1).strength === 0, 'blur strength goes down to 0')

    // Smart align: a dragged rectangle snaps to line up with another.
    send('key', 'esc')
    send('tool', 'rect')
    send('drag', 700, 420, 800, 480)
    send('tool', 'rect')
    s = await state()
    const r2 = s.shapeData.at(-1)
    // Grab the outline (an unfilled rectangle is hit on its stroke), 3 pt right of lining up.
    send('drag', r2.x + 50, r2.y, r2.x + 50 + 3, r2.y)
    s = await state()
    check(JSON.stringify(s.selection) === '[300,200,600,400]', 'grabbing a shape doesn\'t move the capture area')
    check(s.shapeData.at(-1).x === rect.x, 'smart align: a dragged shape snaps to line up with another', `${s.shapeData.at(-1).x} vs ${rect.x}`)
    send('drag', s.shapeData.at(-1).x + 50, r2.y, s.shapeData.at(-1).x + 50 + 3, r2.y, 'cmd')
    s = await state()
    check(s.shapeData.at(-1).x === rect.x + 3, '⌘ places freely', `${s.shapeData.at(-1).x} vs ${rect.x + 3}`)

    // Ruler: length in image pixels, follows its end.
    send('tool', 'ruler')
    send('drag', 320, 560, 520, 560)
    s = await state()
    const ruler = s.shapeData.at(-1)
    check(ruler.type === 'ruler' && ruler.points[2] - ruler.points[0] === 200, 'ruler drawn (shows 400 px on Retina)')
    send('tool', 'ruler')
    send('click', 420, 560)
    send('drag', 520, 560, 620, 560)
    s = await state()
    check(s.shapeData.at(-1).points[2] === 620, 'dragging a ruler end updates the length')

    // Delete, arrow keys, right-click.
    const n = s.shapeData.length
    send('key', 'right', 'shift')
    s = await state()
    check(s.shapeData.at(-1).points[0] === 330, 'arrow keys move the selected shape (Shift = 10)')
    send('key', 'delete')
    s = await state()
    check(s.shapeData.length === n - 1 && !s.selected, 'Delete removes the selected shape')
    send('rightclick', 100, 100)
    s = await state()
    check(!s.capturing, 'right-click cancels the capture')
  },

  // Phase 3: ports of the Electron ocr, pin, lastarea, fullscreen and compress checks.
  async ocr() {
    await launch()
    send('capture')
    send('select', 90, 90, 640, 180)
    send('key', 'x')
    // The first recognition after a launch can take most of a minute while macOS loads its text models.
    let s = await waitFor((s) => s.ocrPanel, 90000)
    check(/Snapkit reads text/.test(s.ocrPanel ?? '') && /Xin chào thế giới/.test(s.ocrPanel ?? ''), 'Copy text reads English and Vietnamese into the text panel', JSON.stringify(s.ocrPanel))
    check(s.ocr >= 2, 'the lines found are outlined')
    check(!s.toolbarsShown, 'the text panel takes the toolbars\' place')
    send('ocr-panel', 'one')
    send('ocr-panel', 'copy')
    s = await waitFor((s) => !s.capturing)
    check(s.clipboardText === 'Snapkit reads text Xin chào thế giới' && !s.capturing, 'One line + Copy text copies and closes', JSON.stringify(s.clipboardText))

    send('text')
    s = await state()
    check(s.capturing && s.textOnly && !s.toolbarsShown, 'Capture text opens with toolbars hidden (hint: Drag over text to copy it)')
    send('select', 90, 90, 640, 180)
    s = await waitFor((s) => s.ocrPanel)
    check(/Snapkit reads text/.test(s.ocrPanel ?? ''), 'capture text shows the panel')
    send('ocr-panel', 'copy')
    s = await waitFor((s) => !s.capturing)
    check(/Snapkit reads text\nXin chào thế giới/.test(s.clipboardText ?? '') && !s.capturing, 'capture text copies and closes')

    send('setting', '{"ocr":{"textButton":"copy"}}')
    send('text')
    send('select', 90, 90, 640, 180)
    s = await waitFor((s) => s.note)
    check(/^Copied 2 lines of text$/.test(s.note ?? ''), 'copy right away, with a message', s.note)
    s = await waitFor((s) => !s.capturing)
    check(!s.capturing, 'and closes')
    send('setting', '{"ocr":{"textButton":"panel"}}')
    send('capture')
    send('select', 800, 600, 200, 150)
    send('key', 'x')
    s = await waitFor((s) => s.note)
    check(s.note === 'No text found' && s.capturing, 'an area without text says so', s.note)
    send('key', 'esc')
  },

  async preview() {
    await launch()
    send('capture')
    send('select', 300, 200, 400, 300)
    send('tool', 'pin')
    let s = await state()
    check(s.lit.includes('pin'), 'Floating preview toggle: on, with its dot')
    send('tool', 'arrow')
    send('drag', 350, 250, 500, 350)
    send('key', 'c', 'cmd')
    s = await state()
    const thumb = s.floating.find((f) => f.kind === 'thumb')
    check(!!thumb && thumb.frame[0] + thumb.frame[2] <= thumb.visibleFrame[0] - 15 && thumb.frame[1] + thumb.frame[3] <= thumb.visibleFrame[1] - 15, 'preview after ⌘C in the bottom-right corner', JSON.stringify(thumb))
    send('thumb', 'copy')
    s = await state()
    check(JSON.stringify(s.clipboardSize) === '[800,600]' && s.floating[0].labels[0] === 'Copied', 'copy again from the preview')
    check(JSON.stringify(s.clipboardTiffSize) === '[800,600]', 'the clipboard has TIFF too, for apps that only take that', JSON.stringify(s.clipboardTiffSize))
    send('thumb', 'text')
    s = await waitFor((s) => s.floating[0]?.labels[2] !== 'Reading…')
    check(/Copied|No text/.test(s.floating[0].labels[2]), 'the preview reads its text', s.floating[0].labels[2])
    send('thumb', 'edit')
    s = await state()
    check(s.capturing && s.shapes.length === 1, 'edit restores drawings')
    check(s.hasImage && s.editorOpen && s.editorPreview?.[2] > 0, 'Editor opened from the preview shows the image', `${s.hasImage} ${s.editorOpen} ${JSON.stringify(s.editorPreview)}`)
    send('tool', 'rect')
    send('drag', 0, 0, 0, 0)
    send('key', 'esc')
    s = await state()
    check(!s.capturing && s.floating.length === 1, 'leaving the editor keeps the preview')
    const before = s.floating[0].frame
    send('pin-move', -120, -80)
    s = await state()
    check(s.floating[0].frame[0] - before[0] === -120 && s.floating[0].frame[1] - before[1] === -80, 'movable preview (-120, -80)', JSON.stringify([before, s.floating[0].frame]))
    send('thumb', 'pin')
    s = await state()
    check(s.floating.length === 1 && s.floating[0].kind === 'pin', 'pin from the preview; preview closed')
    send('pin-zoom', 2)
    send('pin-opacity', 0.5)
    s = await state()
    check(s.floating[0].zoom === 2 && s.floating[0].opacity === 0.5 && s.floating[0].frame[2] === 800, 'pin zoom and opacity', JSON.stringify(s.floating[0]))
    send('capture')
    send('select', 300, 200, 400, 300)
    send('key', 'c', 'cmd')
    s = await state()
    check(s.floating.length === 1 && s.floating[0].kind === 'pin', 'no preview when off; pin still visible')
    send('closepins')
    s = await state()
    check(s.floating.length === 0, 'closing pins')
  },

  async lastarea() {
    await launch()
    send('lastarea')
    let s = await state()
    check(s.capturing && !s.selection, 'Capture last area with nothing remembered: a normal capture')
    send('select', 210, 160, 300, 200)
    send('key', 'c', 'cmd')
    send('lastarea')
    s = await state()
    check(JSON.stringify(s.selection) === '[210,160,300,200]' && s.toolbarsShown, 'reopens the last copied area, toolbar shown', JSON.stringify(s.selection))
    send('select', 500, 400, 100, 100)
    send('key', 'esc')
    s = await state()
    check(s.lastArea?.rect?.x === 210, 'a cancelled capture is not remembered')
    send('fullscreen')
    await wait(300)
    send('closepins')
    send('lastarea')
    s = await state()
    check(s.selection?.[0] === 0 && s.selection?.[2] === s.screen[0], 'after full screen it selects the whole screen', JSON.stringify(s.selection))
    send('key', 'esc')
    send('setting', '{"capture":{"lastAreaInstant":true}}')
    send('capture')
    send('select', 210, 160, 300, 200)
    send('key', 'c', 'cmd')
    send('lastarea')
    await wait(300)
    s = await state()
    check(!s.capturing && JSON.stringify(s.clipboardSize) === '[600,400]', 'copy right away: no capture mode, copied the area')
    quit()
    spawnSync('open', ['-n', app, '--args', '-SnapkitTestScreen', screenPng, '-SnapkitProfile', profile, '-SnapkitTestOut', stateFile, '-SnapkitTestPasteboard', 'com.charios.snapkit.dev.e2e'])
    for (let i = 0; i < 20; i++) {
      rmSync(stateFile, { force: true })
      send('state')
      if (existsSync(stateFile)) break
      await wait(200)
    }
    send('setting', '{"capture":{"lastAreaInstant":false}}')
    send('lastarea')
    s = await state()
    check(JSON.stringify(s.selection) === '[210,160,300,200]', 'the last area survives a restart')
    send('key', 'esc')
  },

  async fullscreen() {
    await launch()
    send('clearclip')
    send('fullscreen')
    let s = await waitFor((s) => s.floating.length)
    check(s.floating.length === 1 && s.floating[0].kind === 'thumb' && !s.capturing, 'full-screen capture goes straight to the preview')
    check(s.clipboardPngBytes === 0, 'not copied by default')
    send('thumb', 'edit')
    s = await state()
    check(s.capturing, 'edit a full-screen capture')
    send('key', 'esc')
    send('closepins')
    send('setting', '{"capture":{"fullscreenCopy":true}}')
    send('fullscreen')
    s = await waitFor((s) => s.clipboardPngBytes)
    check(s.clipboardSize?.[0] === s.screen[0] * 2, 'full-screen capture can copy (Copy full-screen captures)')
    send('closepins')
  },

  async compress() {
    await launch()
    const copy = async () => {
      send('capture')
      send('select', 100, 100, 600, 400)
      send('key', 'c', 'cmd')
      return state()
    }
    let plain = await copy()
    send('setting', '{"compress":{"enabled":true}}')
    let s = await copy()
    check(s.clipboardColorType === 3 && s.clipboardPngBytes < plain.clipboardPngBytes && JSON.stringify(s.clipboardSize) === '[1200,800]',
      'standard copy: a palette PNG on the clipboard, smaller than a plain PNG, full size', `${s.clipboardColorType} ${s.clipboardPngBytes} < ${plain.clipboardPngBytes} ${s.clipboardSize}`)
    check(s.clipboardMatchesScreen === true, 'compressed copy keeps the colours (≤ 256, close enough)')
    send('setting', '{"compress":{"preset":"smallest"}}')
    s = await copy()
    check(JSON.stringify(s.clipboardSize) === '[600,400]', 'smallest copy is 1× size')
    send('setting', '{"compress":{"enabled":false}}')
    s = await copy()
    check(s.clipboardColorType !== 3 && s.clipboardPngBytes === plain.clipboardPngBytes, 'copy with Compress off is the original')
    send('capture')
    send('select', 100, 100, 200, 100)
    send('key', 's', 'cmd')
    s = await state()
    check(s.notifications.some((n) => n.startsWith('Screenshot saved')), 'notification on save (on by default)')
  },

  // Phase 4: ports of the Electron history checks and the background / editor parts of annotate,
  // regressions and fullscreen.
  async history() {
    await launch({ history: { maxCount: 5 } })
    for (let i = 0; i < 7; i++) {
      send('capture')
      send('select', 100 + i * 10, 100, 400, 300)
      send('key', 'c', 'cmd')
    }
    let s = await state()
    check(s.history.length === 5 && s.historyFolders === 5, 'kept: 5 (limit 5) | folders on disk: 5', `${s.history.length} ${s.historyFolders}`)
    send('history')
    s = await state()
    check(s.historyVisible && s.history.length === 5, 'history panel opens with 5 cards')
    send('hist', 'star', 1)
    s = await state()
    check(s.history.filter((h) => h.starred).length === 1, 'starring')
    send('clearclip')
    send('hist-key', 'return')
    s = await state()
    check(JSON.stringify(s.clipboardSize) === '[800,600]' && !s.historyVisible, 'Enter copies (800×600 on Retina) and closes the panel', JSON.stringify([s.clipboardSize, s.historyVisible]))
    const second = s.history[1].id
    send('hist', 'edit', 1)
    s = await state()
    check(s.capturing && s.editorOpen && s.shapes.length === 0, 'edit opens the entry in the editor')
    send('tool', 'rect')
    send('editor', 'drag', s.editorPreview[0] + 30, s.editorPreview[1] + 30, s.editorPreview[0] + 120, s.editorPreview[1] + 90)
    send('editor', 'press', 'done')
    s = await state()
    check(s.history.length === 5 && s.history[0].id === second, 'after edit: count 5 | same entry on top', JSON.stringify(s.history.map((h) => h.id)))
    send('hist', 'delete', 4)
    s = await state()
    check(s.history.length === 4 && s.historyFolders === 4, 'delete removes files')
    send('history')
    send('hist-clear', 'menu')
    send('hist-clear', 'keep')
    s = await state()
    check(s.history.length === 1 && s.history[0].starred && s.historyFolders === 1, 'clear keeps starred')
    send('history')
  },

  async historyPanel() {
    await launch()
    let s = await state()
    check(s.history.length === 0, 'starts empty')
    for (let i = 0; i < 3; i++) {
      send('capture')
      send('select', 100, 100, 300, 200)
      send('key', 'c', 'cmd')
    }
    send('history')
    send('hist-resize', 1100, 600)
    await wait(700)
    s = await state()
    const saved = JSON.parse(readFileSync(join(profile, 'settings.json'), 'utf8'))
    check(s.historyColumns === 5 && saved.history?.panel?.width === 1100, 'resizable history window remembers its size (columns 4 -> 5)', JSON.stringify([s.historyColumns, saved.history?.panel]))
    send('hist-dragfile')
    const drag = JSON.parse(readFileSync(stateFile, 'utf8'))
    check(/^Snapkit .*\.png$/.test(drag.dragFile) && drag.bytes > 1000, 'drag a capture out of history (Snapkit <date>.png)', drag.dragFile)
    // Starred from the keyboard on the third card: the selection goes back to the newest (History.tsx setSel(0)).
    send('hist-key', 'right')
    send('hist-key', 'right')
    const third = (await state()).historySelected
    send('hist-key', 'f')
    s = await state()
    check(third === 2 && s.historySelected === 0, 'history: after a change, the newest is selected again', `${third} -> ${s.historySelected}`)
    send('hist', 'unstar', 2)
    send('hist', 'star', 0)
    send('hist-clear', 'menu')
    send('hist-clear', 'all')
    s = await state()
    check(s.historyClearAll === 'Click again to delete all' && s.history.length === 3, 'clear all asks twice')
    send('hist-clear', 'all')
    s = await state()
    check(s.history.length === 0 && s.historyFolders === 0, 'clear all')
    send('history')
    send('setting', '{"beautify":{"applyOnCopy":true}}')
    send('fullscreen')
    s = await waitFor((s) => s.history.length)
    check(s.history.length === 1 && s.history[0].size[0] > s.screen[0] * 2 && s.floating[0].image[0] === s.history[0].size[0],
      'full-screen capture gets the background when it is on by default (preview, history)', JSON.stringify([s.history[0]?.size, s.floating[0]?.image]))
    send('closepins')
    send('setting', '{"history":{"paused":true}}')
    send('capture')
    send('select', 100, 100, 300, 200)
    send('key', 'c', 'cmd')
    s = await state()
    check(s.history.length === 1, 'nothing recorded while paused')
  },

  async background() {
    await launch()
    send('capture')
    send('select', 300, 200, 400, 300)
    send('tool', 'beautify')
    let s = await state()
    check(s.lit.includes('beautify') && s.beautify.on, 'background on, dot shown')
    send('key', 'c', 'cmd')
    s = await state()
    check(JSON.stringify(s.clipboardSize) === '[880,680]', 'copy with the default background: 20 pt padding all round (800+80 × 600+80)', JSON.stringify(s.clipboardSize))
    send('capture')
    send('select', 300, 200, 400, 300)
    send('tool', 'beautifyEdit')
    s = await state()
    check(s.editorOpen && s.capturing, 'Edit background opens the editor')
    send('editor', 'press', 'tab:solid')
    s = await state()
    check(s.editorTab === 'solid' && s.beautify.background?.type === 'solid', 'color tab -> solid swatches')
    send('editor', 'swatch', 2)
    s = await state()
    check(s.beautify.background?.color === '#18181b', 'pick a solid colour')
    send('editor', 'slider', 'shadow', 0.37)
    s = await state()
    check(s.beautify.shadow === 0.37, 'fine shadow slider (0.01 steps)')
    send('editor', 'chip', 'frames', 'Slide 16:9')
    s = await state()
    check(/Output: \d+ × \d+ px/.test(s.editorOutput) && (() => { const [w, h] = s.editorOutput.match(/(\d+) × (\d+)/).slice(1).map(Number); return Math.abs(w / h - 16 / 9) < 0.01 })(), 'fixed output size: 16:9', s.editorOutput)
    send('tool', 'text')
    const p = s.editorPreview
    send('editor', 'drag', p[0] + 60, p[1] + 60, p[0] + 60, p[1] + 60)
    send('type', 'Hi')
    send('key', 'esc')
    s = await state()
    check(s.editorOpen && !s.typing && s.shapes.at(-1) === 'text', 'Esc while typing in the editor -> still in editor, typing ends')
    send('key', 'esc')
    send('key', 'esc')
    s = await state()
    check(!s.editorOpen && s.capturing, 'Esc closes the editor only, still capturing')
    send('tool', 'beautifyEdit')
    send('editor', 'press', 'copy')
    s = await state()
    check(!s.capturing && s.clipboardSize?.[0] / s.clipboardSize?.[1] > 1.7, 'Copy from the editor: 16:9 output', JSON.stringify(s.clipboardSize))
    const saved = JSON.parse(readFileSync(join(profile, 'settings.json'), 'utf8'))
    check(saved.beautify?.presets?.[0]?.background?.color === '#18181b', 'remember last background: the default preset takes it')
  },

  async editorView() {
    await launch()
    send('capture')
    send('select', 60, 60, 1300, 800)
    send('tool', 'arrow')
    send('drag', 350, 250, 500, 350)
    send('tool', 'beautifyEdit')
    let s = await state()
    const before = s.editorPreview
    const ax = before[0] + before[2] * 0.25, ay = before[1] + before[3] * 0.25
    // Zoomed well past the stage (as Electron's six ⌘-scroll steps), so it scrolls both ways.
    send('editor', 'zoom', 4, ax, ay)
    s = await state()
    const after = s.editorPreview
    const u = (ax - after[0]) / after[2], v = (ay - after[1]) / after[3]
    check(s.editorZoom > 2 && Math.abs(u - 0.25) < 0.01 && Math.abs(v - 0.25) < 0.01, 'editor zoom in: the point stays under the pointer', JSON.stringify([u, v]))
    send('editor', 'space', 'down')
    send('editor', 'drag', 600, 500, 650, 520)
    send('editor', 'space', 'up')
    s = await state()
    check(s.editorPreview[0] - after[0] === 50 && s.editorPreview[1] - after[1] === 20 && s.shapes.length === 1, 'Space hand pans, draws nothing', JSON.stringify([s.editorPreview[0] - after[0], s.editorPreview[1] - after[1], s.shapes]))
    // Panned far: the zoomed preview stops at the stage's edges (Electron: a scroll container).
    send('editor', 'space', 'down')
    send('editor', 'drag', 600, 500, 3000, 2500)
    send('editor', 'space', 'up')
    s = await state()
    const [px, py, pw] = s.editorPreview, sg = s.editorStage
    check(Math.abs(px - sg[0]) <= 1 && pw > sg[2] && py + s.editorPreview[3] >= sg[1] + sg[2] * 0 && py <= sg[1] + 200, 'panning stops at the preview\'s edges', JSON.stringify([s.editorPreview, sg]))
    send('key', '0', 'cmd')
    s = await state()
    check(s.editorZoom === 1 && s.editorOpen, 'Ctrl/⌘ + 0 fits again, still in editor')
    const st = s.editorStage
    check(s.editorPreview[2] <= st[2] && s.editorPreview[1] + s.editorPreview[3] <= st[1] + st[3], 'the preview fits the editor')
    send('key', 'esc')
    send('key', 'c', 'cmd')
    send('thumb', 'close')
  },

  async safety() {
    await launch({}, ['-SnapkitIdleSeconds', '2'])
    send('capture')
    send('select', 300, 200, 300, 200)
    send('capture')
    let s = await state()
    check(!s.capturing, 'capture hotkey again closes capture mode')
    let mark = logMark()
    send('capture')
    send('capture')
    check(/replacing the capture windows/.test(logSince(mark)), 'pressed again with no input since opening: the capture windows are replaced')
    send('capture')
    await wait(300)
    s = await state()
    check(s.capturing && s.visiblePanels === s.panels, 'capture works after replacing them')
    await wait(2500)
    s = await state()
    check(!s.capturing, 'idle timeout closes capture mode')
    for (let i = 0; i < 20; i++) {
      send('capture')
      send('capture')
    }
    s = await state()
    check(!s.capturing && s.visiblePanels === 0, 'many captures in a row leave nothing on screen')
  },

  async settings() {
    const saves = await launch({ notifications: { onSave: false } })
    const saved = () => JSON.parse(readFileSync(join(profile, 'settings.json'), 'utf8'))
    const texts = async () => {
      rmSync(stateFile, { force: true })
      send('settings-texts')
      for (let i = 0; i < 100 && !existsSync(stateFile); i++) await wait(100)
      return existsSync(stateFile) ? JSON.parse(readFileSync(stateFile, 'utf8')).texts.join(' | ') : ''
    }
    const set = async (patch) => { send('setting', JSON.stringify(patch)); await wait(300) }
    const section = async (id) => { send('settings', id); await wait(400) }

    await section('general')
    let s = await state()
    check(s.settingsOpen && s.settingsSection === 'general', 'settings window opens (from capture mode: ⌘,)')
    check(s.dockIcon, 'Dock icon while Settings is open')
    let t = await texts()
    const order = ['Startup', 'Capture', 'Saving'].map((g) => t.indexOf(g))
    check(order.every((i, k) => i >= 0 && (k === 0 || i > order[k - 1])), 'General starts with Startup, Capture, Saving', t.slice(0, 200))
    check(/Quick area capture/.test(t), 'quick area capture switch shown')
    check(/Ask where to save/.test(t) && /Screenshots folder|Save to/i.test(t), 'saving rows', t.slice(t.indexOf('Saving'), t.indexOf('Saving') + 200))
    const def = JSON.parse(readFileSync(join(mac, '..', 'fixtures', 'default-settings.json'), 'utf8'))
    check(def.capture.dimOpacity > 0 && def.appearance.mode === 'dark', 'dim amount and dark mode by default (shared fixture)', `${def.capture.dimOpacity} ${def.appearance.mode}`)
    check(def.history.maxCount === 10, 'history keeps 10 by default (up to 30)')

    // File naming: the preview reads like the saved name.
    await set({ save: { name: { text: 'Bug', date: 'off', number: 'after', digits: 3 }, nextNumber: 1 } })
    t = await texts()
    // The preview shows each part as a chip: Bug | 001 | .png (OCR may read the dot as •).
    check(/Bug \| 001 \| [.•·]?png/.test(t), 'name preview "Bug 001.png"', t.slice(t.indexOf('Padded'), t.indexOf('Padded') + 120))

    // Shortcuts: recording a hotkey saves and registers it; tool letters.
    await section('shortcuts')
    t = await texts()
    check(/Settings/.test(t) && /Capture area/.test(t), 'global shortcut rows include Settings', t.slice(0, 300))
    s = await state()
    check(s.hotkeysRegistered.settings, 'the settings shortcut is registered from the start')
    send('set-hotkey', 'capture', 'CommandOrControl+Alt+Shift+F11')
    await wait(300)
    s = await state()
    check(saved().hotkeys?.capture === 'CommandOrControl+Alt+Shift+F11' && s.hotkeysRegistered.capture, 'recording a hotkey saves CommandOrControl+Alt+Shift+F11', saved().hotkeys?.capture)
    rmSync(stateFile, { force: true })
    send('set-hotkey', 'capture', 'none')
    await wait(200)
    check(/can't be turned off/.test(readFileSync(stateFile, 'utf8')), 'the capture shortcut can\'t be turned off')
    await set({ toolKeys: { arrow: 'w' } })
    check(saved().toolKeys?.arrow === 'w', 'tool letter saved')

    // Appearance: dark mode, dim colour, glass; open windows follow at once.
    send('history')
    await section('appearance')
    await set({ appearance: { mode: 'dark' } })
    s = await state()
    check(s.settingsAppearance.includes('DarkAqua') && s.historyTheme?.dark, 'theme mode dark reaches Settings and the open history panel', `${s.settingsAppearance} ${JSON.stringify(s.historyTheme)}`)
    const darkBg = s.historyTheme?.background
    // Switched from the Settings window itself with Liquid Glass on: the frosted sidebar follows too.
    await set({ appearance: { mode: 'light', glass: true } })
    send('settings-set', JSON.stringify({ appearance: { mode: 'dark' } }))
    await wait(300)
    let f = (await state()).settingsFrost
    send('settings-set', JSON.stringify({ appearance: { mode: 'light' } }))
    await wait(300)
    const f2 = (await state()).settingsFrost
    check(/DarkAqua/.test(f) && /^NSAppearanceNameAqua$/.test(f2), 'glass: the frosted sidebar follows a theme switched in Settings', `${f} then ${f2}`)
    await set({ appearance: { mode: 'dark', glass: false } })
    await set({ appearance: { mode: 'gray' } })
    s = await state()
    check(s.historyTheme?.dark && s.historyTheme.background !== darkBg, 'Gray is a dark theme with lighter surfaces, in every open window', JSON.stringify(s.historyTheme))
    send('settings-reset', 'appearance')
    await wait(300)
    check(!saved().appearance, 'Reset section puts Appearance back to defaults', JSON.stringify(saved().appearance))
    await set({ capture: { dimColor: '#1e3a8a' }, appearance: { glass: true } })
    check(saved().capture?.dimColor === '#1e3a8a' && saved().appearance?.glass === true, 'dim colour and Liquid Glass saved')
    await set({ capture: { dimOpacity: 0.37 } })
    t = await texts()
    check(/Liquid Glass/.test(t) && /Dim/.test(t), 'appearance rows (Liquid Glass, Dim)', t.slice(0, 300))
    check(/\b37%/.test(t), 'Dim amount in 1% steps (37% shown)', (t.match(/\d+%/g) ?? []).join(' '))
    await set({ appearance: { glass: false } })
    send('history')

    // Toolbar: hide Highlighter, move Text first; groups show their variants.
    await section('toolbar')
    t = await texts()
    check(/Arrows/.test(t) && /Shapes/.test(t), 'tool group rows (Arrows, Shapes)', t.slice(0, 400))
    const order0 = def.toolbarOrder ?? []
    await set({ features: { highlighter: false }, toolbarOrder: ['text', ...order0.filter((x) => x !== 'text')] })
    check(saved().features?.highlighter === false && saved().toolbarOrder?.[0] === 'text', 'highlighter off and Text first saved')

    // Tools: palette, step badge.
    await set({ annotate: { palette: ['#00aa55', ...def.annotate.palette.slice(1)], stepColor: '#3b82f6', stepStroke: { width: 4, color: '#00ff00' }, stepShadow: 0 } })
    check(def.annotate.stepStroke.width === 2 && def.annotate.stepShadow === 0.3, 'step outline 2 px white and 30% shadow by default (fixture)', JSON.stringify(def.annotate.stepStroke) + ' ' + def.annotate.stepShadow)
    await section('tools')
    // Text starting style: Light and Dark backgrounds (as in the style bar); left on Dark.
    const looks = []
    for (const look of ['dark', 'light', 'dark']) {
      rmSync(stateFile, { force: true })
      send('text-look', look)
      await wait(200)
      const shown = existsSync(stateFile) ? JSON.parse(readFileSync(stateFile, 'utf8')).look : '?'
      looks.push(`${look}: ${saved().annotate?.text?.style} ${saved().annotate?.text?.background} ${shown}`)
    }
    check(looks.join(' | ') === 'dark: background #111111 dark | light: background #ffffff light | dark: background #111111 dark', 'text starting style: Dark and Light save a background, the segment follows', looks.join(' | '))
    t = await texts()
    check(/Light and Dark put a background/.test(t) && /\bLight\b/.test(t) && /\bDark\b/.test(t), 'Starting style offers Plain, Stroke, Light, Dark', t.slice(t.indexOf('Starting'), t.indexOf('Starting') + 160))
    check(/Numbered steps/.test(t) && /Badge color/.test(t), 'tools section shows step badge rows', t.slice(0, 300))

    // Background: remember last off; gradients reset to 32.
    await section('background')
    await set({ beautify: { rememberLast: false, gradients: [['#000000', '#ffffff']] } })
    check(saved().beautify?.rememberLast === false, 'remember last background off')
    send('settings-reset', 'background')
    await wait(300)
    s = await state()
    check(!saved().beautify, 'gradients reset to the defaults')
    check(def.beautify.gradients.length === 32, 'the gradient library has 32 by default', def.beautify.gradients.length)
    check(saved().features?.highlighter === false, 'resetting one section keeps the others')

    // Capture mode picks it all up.
    send('settings-close')
    await wait(500)
    s = await state()
    check(!s.settingsOpen && !s.dockIcon, 'the Dock icon goes when Settings closes')
    await set({ capture: { dimColor: '#1e3a8a', dimOpacity: 0.5 } })
    send('capture')
    send('select', 300, 200, 600, 400)
    s = await state()
    check(s.toolbar[0] === 'text' && !s.toolbar.includes('highlighter'), 'capture mode uses the new toolbar order and hides Highlighter', JSON.stringify(s.toolbar))
    send('key', 'w')
    s = await state()
    check(s.tool === 'arrow', 'W picks Arrow in capture mode', s.tool)
    send('tool', 'text')
    s = await state()
    check(s.styleActive.includes('look:dark'), 'text starts as: Dark background (white text)', JSON.stringify(s.styleActive))
    send('tool', 'arrow')
    check(s.styleBar.find((x) => x.startsWith('color:')) === 'color:#00aa55', 'Quick colours reach capture mode (first swatch #00aa55)', JSON.stringify(s.styleBar))
    const snap = async (png) => {
      rmSync(png, { force: true })
      send('snapshot', png)
      for (let i = 0; i < 50 && !existsSync(png); i++) await wait(100)
      await wait(200)
    }
    const png = join(root, 'dim.png')
    await snap(png)
    const px = run(ctl, ['pixel', png, '50', '50']).trim()
    const blueish = (h) => parseInt(h.slice(5, 7), 16) > parseInt(h.slice(1, 3), 16) + 15
    check(blueish(px), 'capture mode dims in the chosen colour', px)
    send('tool', 'step')
    send('click', 450, 350)
    s = await state()
    const step = s.shapeData?.at(-1)
    await snap(png)
    // Outward from the badge's centre: its colour, then the green outline.
    const ring = run(ctl, ['pixel', png, ...Array.from({ length: 30 }, (_, i) => [450 + i, 350]).flat().map(String)]).trim().split('\n')
    const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16))
    const blue = (h) => { const [r, g, b] = rgb(h); return b > r + 80 && b > g + 40 }
    const green = (h) => { const [r, g, b] = rgb(h); return g > r + 80 && g > b + 80 }
    check(step?.type === 'step' && ring.some(blue) && ring.some(green), 'a step badge uses the colour and outline from Settings', JSON.stringify(ring))
    send('key', 's', 'cmd')
    await wait(800)
    send('capture')
    send('select', 300, 200, 600, 400)
    send('key', 's', 'cmd')
    await wait(800)
    const files = existsSync(saves) ? readdirSync(saves).sort() : []
    check(JSON.stringify(files) === '["Bug 001.png","Bug 002.png"]' && saved().save.nextNumber === 3, 'saves are numbered Bug 001, Bug 002', JSON.stringify(files) + ' next ' + saved().save?.nextNumber)

    // About: a real update check.
    await section('about')
    send('settings-check')
    s = await waitFor((x) => !x.updateChecking && x.updateStatus, 15000)
    check(['available', 'latest', 'unavailable', 'error'].includes(s.updateStatus), 'update check answers', s.updateStatus)
    send('settings-close')
  },

  // Electron checks that had no native port yet (docs/native-mac-testing.md §2).
  async parity() {
    await launch({ capture: { quickCopy: true } })
    // Quick area capture: a click is not an area; capture mode stays.
    send('capture')
    send('drag', 400, 300, 400, 300)
    let s = await state()
    check(s.capturing, 'Quick area capture ignores a click')
    send('key', 'esc')
    send('setting', '{"capture":{"quickCopy":false}}')
    send('capture')
    send('select', 300, 200, 400, 300)
    s = await state()
    check(s.capturing && s.selection, 'Quick capture off: drawing an area keeps capture mode open')

    // Smart align in each situation: a rectangle 3 pt off lining up with another snaps to it.
    const rects = [
      { id: 'r1', type: 'rect', x: 400, y: 260, w: 120, h: 80, color: '#ef4444', width: 4 },
      { id: 'r2', type: 'rect', x: 403, y: 400, w: 120, h: 60, color: '#3b82f6', width: 4 }
    ]
    const r2x = async () => (await state()).shapeData.find((x) => x.id === 'r2').x
    const reset = () => send('shapes', JSON.stringify(rects))
    reset()
    send('click', 430, 400) // select r2 (its top edge, away from the resize handle)
    send('drag', 430, 400, 433, 400)
    check((await r2x()) === 400, 'Smart align, selected shape', String(await r2x()))
    reset()
    send('tool', 'rect')
    send('drag', 463, 400, 466, 400)
    s = await state()
    check(s.shapeData.length === 2 && (await r2x()) === 400, 'Smart align with a drawing tool active (grabbing a shape moves it)', `${s.shapeData.length} shapes, x ${await r2x()}`)
    send('tool', 'rect')
    // While typing: the text box moves (and snaps to the rectangle's left edge), typing goes on.
    reset()
    send('tool', 'text')
    send('click', 430, 330)
    send('type', 'Note')
    s = await state()
    const box = s.textBox
    if (box) send('textframe-drag', 400 + 4 - box[0], 30) // 4 pt off lining up with the rectangles
    s = await state()
    const typed = s.textBox
    check(s.typing && typed && Math.abs(typed[1] - (box[1] + 30)) <= 6, 'Moving a text box while typing (snap may nudge a few px)', `${JSON.stringify(box)} -> ${JSON.stringify(typed)} typing ${s.typing}`)
    check(typed && typed[0] !== 404 && Math.abs(typed[0] - 400) <= 3, 'Smart align while typing text (it snaps to the nearest shape)', JSON.stringify(typed))
    send('key', 'esc')
    send('key', 'esc')

    // Text style changes stay with the text: other tools keep their colour.
    await launch()
    send('capture')
    send('select', 300, 200, 400, 300)
    send('tool', 'text')
    send('click', 600, 300)
    send('type', 'Styled')
    send('style', 'look:dark')
    send('key', 'esc')
    send('key', 'esc')
    send('tool', 'arrow')
    send('drag', 320, 220, 380, 260)
    s = await state()
    check(s.shapeData.at(-1)?.type === 'arrow' && s.shapeData.at(-1).color !== '#ffffff', 'Text background style doesn\'t recolour other tools', JSON.stringify(s.shapeData.at(-1)))
    send('key', 'esc')
    send('key', 'esc')

    // Editor: pinch zooms in; Compress switch; tools fit a small screen; smart align inside the editor.
    await launch({ compress: { enabled: true } })
    send('capture')
    send('select', 300, 200, 400, 300)
    send('tool', 'beautifyEdit')
    s = await state()
    const p = s.editorPreview
    send('editor', 'pinch', 0.5, p[0] + p[2] / 2, p[1] + p[3] / 2)
    let z = await state()
    check(z.editorZoom > s.editorZoom, 'Trackpad pinch zooms in', `${s.editorZoom} -> ${z.editorZoom}`)
    send('key', '0', 'cmd')
    s = await state()
    check(s.editorControls.includes('compress') && s.editorControls.includes('compressPreset') && /KB|MB/.test(s.editorOutput), 'Editor Compress switch follows the setting, shows the size', `${s.editorControls} | ${s.editorOutput}`)
    send('editor', 'press', 'compress')
    s = await state()
    check(!s.editorControls.includes('compressPreset'), 'Compress switch turns off, chips hidden')
    // Cursors over the editor: the tool's over the preview, the arrow elsewhere (not capture mode's).
    send('tool', 'arrow')
    s = await state()
    check(s.editorCursor?.preview === 'crosshair' && s.editorCursor.sidebar === 'arrow' && s.editorCursor.backdrop === 'arrow', 'Editor cursors: the tool\'s over the preview, the arrow over the sidebar and backdrop', JSON.stringify(s.editorCursor))
    send('tool', 'arrow')
    s = await state()
    check(s.editorCursor?.preview === 'arrow', 'Editor cursors: no tool, the arrow over the preview', JSON.stringify(s.editorCursor))
    send('overlay-size', 1280, 720)
    await wait(300)
    s = await state()
    check(s.editorOpen && s.editorControlsInside, 'Editor tools fit a small screen (1280×720)', `${JSON.stringify(s.editorBounds)} outside: ${s.editorOutside}`)
    send('key', 'esc')
    send('key', 'esc')

    // Smart align in the editor, also while typing there.
    await launch()
    send('capture')
    send('select', 300, 200, 400, 300)
    reset()
    send('tool', 'beautifyEdit')
    s = await state()
    const [ox, oy, k] = s.editorTransform
    const at = (x, y) => [ox + x * k, oy + y * k]
    send('editor', 'drag', ...at(430, 400), ...at(433, 400))
    check((await r2x()) === 400, 'Smart align in the editor', String(await r2x()))
    send('tool', 'text')
    send('editor', 'drag', ...at(430, 330), ...at(430, 330))
    send('type', 'Note')
    s = await state()
    const ebox = s.textBox
    if (ebox) send('textframe-drag', (404 - ebox[0]) * k, 30 * k)
    s = await state()
    check(s.typing && s.editorOpen && s.textBox && s.textBox[0] !== 404 && Math.abs(s.textBox[0] - 400) <= 3, 'Smart align while typing text in the editor', `${JSON.stringify(ebox)} -> ${JSON.stringify(s.textBox)} typing ${s.typing}`)

    // Display change during capture: capture stays open, new windows only after it closes.
    await launch()
    send('capture')
    send('select', 300, 200, 400, 300)
    let mark = logMark()
    send('screen-change')
    await wait(800)
    s = await state()
    check(s.capturing && !/new capture windows/.test(logSince(mark)), 'Display change during capture: kept open', logSince(mark).slice(-200))
    send('key', 'esc')
    await wait(1000)
    check(/new capture windows: deferred until capture mode closed/.test(logSince(mark)), 'Display change: windows rebuilt after capture closes')
    // A capture that was seen and used, closed by the hotkey: same windows next time.
    mark = logMark()
    send('capture')
    send('select', 300, 200, 400, 300)
    send('capture')
    send('capture')
    await wait(300)
    s = await state()
    check(s.capturing && !/replacing the capture windows|new capture windows/.test(logSince(mark)), 'macOS: a seen capture closed by the hotkey keeps its windows')
    send('key', 'esc')

    // History: the panel is a normal macOS window (its own close button); labelled Clear button.
    send('history')
    await wait(400)
    s = await state()
    check(s.historyVisible && s.historyStandardClose === true, 'History close button: macOS uses its own (none of ours)')
    check(/Clear/.test(s.historyClearAll), 'Labelled Clear History button', s.historyClearAll)
    send('history')

    // A shortcut another app holds when Snapkit starts.
    quit()
    const holder = spawn(ctl, ['hold-hotkey', '6'], { stdio: ['ignore', 'pipe', 'ignore'] })
    const held = await new Promise((r) => holder.stdout.on('data', (d) => r(String(d).trim())))
    await launch({ hotkeys: { capture: 'Alt+Shift+Z' } })
    s = await state()
    const whileHeld = s.captureHotkeyRegistered
    check(held !== 'holding' || s.notifications.some((n) => /is used by another app/.test(n)), 'A capture shortcut taken at startup: a notification says so', JSON.stringify(s.notifications))
    // Picked in Settings while another app holds it: refused, and the old shortcut stays.
    send('set-hotkey', 'capture', 'CommandOrControl+Alt+Shift+F11')
    await wait(300)
    send('set-hotkey', 'capture', 'Alt+Shift+Z')
    await wait(300)
    const reply = readFileSync(stateFile, 'utf8')
    s = await state()
    const kept = JSON.parse(readFileSync(join(profile, 'settings.json'), 'utf8')).hotkeys?.capture
    check(held !== 'holding' || (/is taken by another app/.test(reply) && kept === 'CommandOrControl+Alt+Shift+F11' && s.hotkeysRegistered.capture), 'A shortcut another app holds, picked in Settings: refused, the old one kept', `${reply.slice(0, 120)} | saved ${kept} | registered ${s.hotkeysRegistered.capture}`)
    send('set-hotkey', 'capture', 'Alt+Shift+Z')
    await new Promise((r) => holder.on('exit', r))
    await wait(6000)
    s = await state()
    check(held === 'holding' && !whileHeld && s.captureHotkeyRegistered, 'Takes a shortcut back once the app holding it quits', `holder: ${held} | while held: ${whileHeld} | after: ${s.captureHotkeyRegistered}`)
  },

  // Blur and pixelate change the pixels (Electron: e2e/annotate.mjs), opaque and averaged as stored
  // (a 50/50 mix of two bands comes out near their sRGB midpoint, not washed out lighter).
  async blur() {
    let s
    // A new blur stays selected: the slider changes it (one undo step), a drag on it moves it, a
    // drag elsewhere draws another (Electron annotate: "new blur selected").
    await launch()
    send('capture')
    send('select', 100, 100, 900, 600)
    send('tool', 'blur')
    send('drag', 200, 200, 400, 350)
    s = await state()
    const first = s.shapeData.at(-1)
    const selected = s.selected === first?.id && s.tool === 'blur'
    send('blur', 20)
    send('blur', 30)
    s = await state()
    const slid = s.shapeData.at(-1).strength === 30
    send('key', 'z', 'cmd')
    s = await state()
    const oneStep = s.shapeData.length === 1 && s.shapeData[0].strength === first.strength
    send('key', 'z', 'cmd', 'shift')
    send('drag', 300, 270, 340, 300)
    s = await state()
    const moved = s.shapeData.length === 1 && s.shapeData[0].x === first.x + 40 && s.shapeData[0].y === first.y + 30
    send('drag', 600, 400, 800, 550)
    s = await state()
    const another = s.shapeData.length === 2 && s.selected === s.shapeData[1].id
    send('click', 850, 650)
    s = await state()
    check(selected && slid && oneStep && moved && another && s.selected === null, 'new blur selected; slider changes it (one undo step); drag on it moves it; drag elsewhere draws another; click away deselects',
      JSON.stringify({ selected, slid, oneStep, moved, another, after: s.selected }))
    send('key', 'esc')
    send('key', 'esc')

    await launch()
    send('capture')
    send('select', 100, 40, 600, 300)
    const png = process.env.SHOT || join(root, 'blur.png')
    const shoot = async () => {
      rmSync(png, { force: true })
      send('snapshot', png)
      for (let i = 0; i < 50 && !existsSync(png); i++) await wait(100)
      await wait(200)
    }
    const at = (...pts) => run(ctl, ['pixel', png, ...pts.flat().map(String)]).trim().split('\n')
    // A band edge right of the test screen's text: the first colour change down x = 560.
    await shoot()
    const ys = Array.from({ length: 120 }, (_, i) => 50 + i * 2)
    const col = at(...ys.map((y) => [560, y]))
    const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16))
    const near = (h, ref, tol) => rgb(h).every((v, i) => Math.abs(v - ref[i]) <= tol)
    const k = col.findIndex((c) => !near(c, rgb(col[0]), 20))
    const edge = ys[k]
    const pts = [[560, edge - 30], [560, edge + 30], [560, edge]]
    const [a, b] = at(...pts)
    const mid = rgb(a).map((v, i) => (v + rgb(b)[i]) / 2)
    send('tool', 'blur')
    send('drag', 440, edge - 50, 680, edge + 80)
    send('click', 600, edge + 40) // select it (drawing doesn't, as in Electron)
    send('blur', 40)
    await shoot()
    const [, , blurred] = at(...pts)
    check(k > 0 && (await state()).shapeData.at(-1).strength === 40 && !near(blurred, rgb(a), 20) && !near(blurred, rgb(b), 20) && near(blurred, mid, 30), 'blur mixes the two bands at their edge (sRGB midpoint)', `${a} | ${b} | edge ${blurred}`)
    send('blur', 0)
    await shoot()
    const [a0, b0] = at(...pts)
    check(near(a0, rgb(a), 2) && near(b0, rgb(b), 2), 'blur strength 0: the area as it is', `${a0} ${b0}`)
    send('blur', 40)
    send('style', 'blurMode:pixelate')
    s = await state()
    await shoot()
    const row = at(...Array.from({ length: 30 }, (_, i) => [450 + i * 7, edge]))
    const flat = row.every((h) => near(h, rgb(a), 45) || near(h, rgb(b), 45) || near(h, mid, 45))
    check(s.shapeData.at(-1).mode === 'pixelate' && new Set(row).size <= 6 && flat, 'pixelate: opaque blocks of the averaged colours', `${s.shapeData.at(-1).mode} | ${[...new Set(row)].join(' ')}`)

    // Over black text on white: the mean brightness stays (a linear-light average washes text out lighter).
    const grid = []
    for (let x = 140; x <= 400; x += 1.5) for (let y = edge + 20; y <= edge + 140; y += 1.5) grid.push([x, y])
    const mean = () => { const c = at(...grid).map(rgb); return c.reduce((t, v) => t + v[0] + v[1] + v[2], 0) / (c.length * 3) }
    await launch()
    send('capture')
    send('select', 100, 40, 600, 300)
    await shoot()
    const plain = mean()
    send('tool', 'blur')
    send('drag', 130, edge + 10, 410, edge + 150)
    await shoot()
    const blurredMean = mean()
    send('key', 'z', 'cmd')
    send('style', 'blurMode:pixelate')
    send('drag', 130, edge + 10, 410, edge + 150)
    await shoot()
    const pixMean = mean()
    check(plain < 245 && Math.abs(blurredMean - plain) < 6 && Math.abs(pixMean - plain) < 6, 'blur and pixelate over text keep its mean brightness (not washed out)', `plain ${plain.toFixed(1)} | blur ${blurredMean.toFixed(1)} | pixelate ${pixMean.toFixed(1)}`)
    send('key', 'esc')
    send('key', 'esc')
  },

  // The Ellipse tool on its own (off by default, as Line): turned on, it's in the toolbar, E picks it.
  async ellipse() {
    await launch({ features: { ellipse: true } })
    send('capture')
    send('select', 300, 200, 400, 300)
    let s = await state()
    send('key', 'e')
    const tool = (await state()).tool
    send('drag', 350, 250, 450, 330)
    send('variant', 'ellipse', 'ellipse-filled')
    send('drag', 500, 250, 600, 330)
    s = await state()
    const [a, b] = s.shapeData.slice(-2)
    check(s.toolbar.includes('ellipse') && tool === 'ellipse' && a?.type === 'ellipse' && !a.filled && b?.type === 'ellipse' && b.filled, 'Ellipse tool: in the toolbar, E, outline and filled', `${JSON.stringify(s.toolbar)} | ${tool} | ${JSON.stringify([a, b])}`)
    send('key', 'esc')
    send('key', 'esc')
  },

  // Opening Snapkit again while it runs (index.ts second-instance): captures, or --history etc.
  async openAgain() {
    await launch()
    spawnSync('open', ['-n', app, '--args', '--history'])
    let s = await waitFor((x) => x.historyVisible, 6000)
    check(s.historyVisible && !s.capturing, 'opened again with --history: the history panel', `history ${s.historyVisible}`)
    send('history')
    spawnSync('open', ['-n', app])
    s = await waitFor((x) => x.capturing, 6000)
    check(s.capturing, 'opened again: a capture starts', `capturing ${s.capturing}`)
    send('key', 'esc')
    await wait(500)
    const copies = spawnSync('pgrep', ['-f', 'Snapkit Dev.app/Contents/MacOS/Snapkit']).stdout.toString().trim().split('\n').filter(Boolean).length
    check(copies === 1, 'the second copy quits', `${copies} running`)
  },

  // A click on another app closes Settings; its own windows (History) don't.
  async settingsOutside() {
    await launch()
    send('settings', 'general')
    await wait(600)
    send('history')
    await wait(400)
    let s = await state()
    const kept = s.settingsOpen
    send('history')
    spawnSync('osascript', ['-e', 'tell application "Finder" to activate'])
    s = await waitFor((x) => !x.settingsOpen, 3000)
    check(kept && !s.settingsOpen, 'clicking another app closes Settings (Snapkit\'s own windows don\'t)', `with History ${kept} | after Finder ${s.settingsOpen}`)
  },

  // Capture mode's cursors, as Electron's (AnnotationLayer containerCursor, the handles, shapes: move).
  async cursors() {
    await launch()
    send('capture')
    send('select', 300, 200, 400, 300)
    let c = (await state()).cursors
    check(c?.inside === 'move' && c.outside === 'crosshair' && c.corner === 'nwse' && c.edge === 'ns', 'no tool: move inside, crosshair outside, resize arrows on the handles', JSON.stringify(c))
    const picks = {}
    for (const t of ['arrow', 'rect', 'pen', 'text', 'step']) {
      send('tool', t)
      picks[t] = (await state()).cursors?.inside
    }
    check(picks.arrow === 'crosshair' && picks.rect === 'crosshair' && picks.pen === 'crosshair' && picks.text === 'ibeam' && picks.step === 'step', 'drawing tools: crosshair; Text: I-beam; Steps: the pin', JSON.stringify(picks))
    send('tool', 'line') // through the middle, where the check looks
    send('drag', 420, 350, 580, 350)
    send('tool', 'arrow')
    send('pointer-moved')
    c = (await state()).cursors
    check(c?.inside === 'move', 'over a drawing: move, whatever the tool', JSON.stringify(c))
    send('key', 'z', 'cmd')
    send('tool', 'step')
    send('click', 500, 350)
    const placed = (await state()).cursors?.inside
    send('pointer-moved', 501, 351) // a hand's small movement, still on the step
    const jiggled = (await state()).cursors?.inside
    send('pointer-moved') // off it, then back over it
    const moved = (await state()).cursors?.inside
    check(placed === 'step' && jiggled === 'step' && moved === 'move', 'a step just placed keeps the pin until the pointer leaves it (then over it: move)', `${placed} | ${jiggled} | ${moved}`)
    send('key', 'esc')
    send('key', 'esc')
  },

  // Keys typed for real (through the system's event stream, not straight to the view): they reach
  // capture mode only when its window really has the keyboard.
  async realKeys() {
    // Typed through the selected input source: with Vietnamese Telex, "there" becomes "thể".
    const telex = /VietnameseTelex/.test(spawnSync('defaults', ['read', 'com.apple.HIToolbox', 'AppleSelectedInputSources']).stdout?.toString() ?? '')
    await launch()
    // As with the shortcut: another app is in front when capture mode opens.
    spawnSync('osascript', ['-e', 'tell application "Finder" to activate'])
    await wait(500)
    send('capture')
    send('select', 110, 120, 580, 60)
    await wait(700) // the keyboard comes over once the screen is grabbed
    let s = await state()
    run(ctl, ['real-type', 'r'])
    await wait(300)
    const tool = (await state()).tool
    check(s.keyWindow && tool === 'rect', 'capture mode has the keyboard: a typed R picks the rectangle', `key window ${s.keyWindow} | responder ${s.firstResponder} | tool ${tool}`)
    send('tool', 'text')
    send('type')
    await wait(300)
    run(ctl, ['real-type', 'hi there'])
    await wait(500)
    s = await state()
    check(s.typing && s.typedText.normalize() === (telex ? 'hi thể' : 'hi there').normalize(), 'typing text: the keys land in the text box', `typing ${s.typing} | text ${JSON.stringify(s.typedText)} | key window ${s.keyWindow} | responder ${s.firstResponder}`)
    // A word still being composed (an input method's marked text) shows before it's committed.
    send('mark', 'vi')
    s = await state()
    check(s.markedText && s.typedText?.endsWith('vi') && s.typedText.length > 'vi'.length, 'a word still being composed shows as it is typed', `${JSON.stringify(s.typedText)} | marked ${s.markedText}`)
    send('key', 'esc')
    // In the background editor
    await launch()
    send('capture')
    send('select', 300, 200, 400, 300)
    await wait(300)
    send('tool', 'beautifyEdit')
    send('tool', 'text')
    const pre = await state(); const p = pre.editorPreview
    const [cx, cy] = [p[0] + p[2] - 80, p[1] + p[3] / 2]
    send('editor', 'drag', cx, cy, cx, cy)
    await wait(300)
    run(ctl, ['real-type', 'edit'])
    await wait(500)
    s = await state()
    check(s.typing && s.typedText === 'edit', 'typing text in the background editor', `before: selected ${pre.selected} typing ${pre.typing} sel ${JSON.stringify(pre.selection)} | editor ${s.editorOpen} tool ${s.tool} preview ${JSON.stringify(p)} shapes ${JSON.stringify(s.shapes)} | typing ${s.typing} | text ${JSON.stringify(s.typedText)} | key window ${s.keyWindow} | responder ${s.firstResponder}`)
    send('key', 'esc')
    send('key', 'c', 'cmd')
    // Reopened from the floating preview
    await launch({ pin: { afterCopy: true } })
    send('capture')
    send('select', 300, 200, 400, 300)
    send('key', 'c', 'cmd')
    await wait(300)
    send('thumb', 'edit')
    await wait(500)
    send('tool', 'text')
    const q = (await state()).editorPreview
    send('editor', 'drag', q[0] + 60, q[1] + 60, q[0] + 60, q[1] + 60)
    await wait(300)
    run(ctl, ['real-type', 'again'])
    await wait(500)
    s = await state()
    check(s.typing && s.typedText === 'again', 'typing text in an editor reopened from the preview', `typing ${s.typing} | text ${JSON.stringify(s.typedText)} | key window ${s.keyWindow} | responder ${s.firstResponder}`)
    send('key', 'esc')
    send('key', 'esc')
    send('key', 'esc')
    send('closepins')
  },

  // Bad states Electron fixed in 1a00d6f (docs/state-machines.md, e2e/states.mjs), checked here.
  async states() {
    const saves = await launch({ ocr: { textButton: 'copy' } })
    // 1. A read still going when capture mode closes doesn't land in the next capture.
    send('clearclip')
    send('read-delays', 1500)
    send('capture')
    send('select', 110, 120, 580, 60)
    send('key', 'x')
    send('key', 'esc')
    send('key', 'esc')
    send('capture')
    send('select', 110, 120, 580, 60)
    await wait(2200) // the late answer arrives meanwhile
    let s = await state()
    send('key', 'r')
    const tool = (await state()).tool
    check(s.capturing && !s.note && !s.clipboardText && tool === 'rect', 'late read: no note, no copy, tools still work', `note ${s.note} | clipboard ${s.clipboardText} | tool ${tool}`)
    // A read that never answers gives up (helper.ts: 120 s; 1 s here).
    send('read-timeout', 1)
    send('read-delays', 3000)
    send('key', 'x')
    await wait(1600)
    s = await state()
    check(s.capturing && /Couldn't read the text: no answer/.test(s.note ?? ''), 'a text read with no answer gives up with a message', s.note)
    send('read-timeout', 120)
    await wait(1600)
    // Esc while it's still reading closes capture mode (Overlay.tsx), and the read lands nowhere.
    send('read-delays', 800)
    send('key', 'x')
    send('key', 'esc')
    await wait(1300)
    s = await state()
    check(!s.capturing && !s.clipboardText, 'Esc during a read closes capture mode and drops its result', `capturing ${s.capturing} | clipboard ${s.clipboardText}`)
    send('capture')
    send('select', 110, 120, 580, 60)
    send('key', 'esc')
    send('key', 'esc')

    // 2. Two reads at once in Capture text: only the second one is copied.
    send('clearclip')
    send('read-delays', 900, 100)
    send('text')
    send('select', 110, 120, 580, 60)
    send('select', 110, 180, 580, 60)
    s = await waitFor((x) => !x.capturing, 5000)
    await wait(1200) // the first read answers after the second
    s = await state()
    check(/Xin/.test(s.clipboardText ?? '') && !/Snapkit/.test(s.clipboardText ?? ''), 'two reads: only the second area is copied', s.clipboardText)

    // 3. Capture text has no drawing; Enter, ⌘C and ⌘S don't output the image.
    send('clearclip')
    send('read-delays', 5000)
    send('text')
    send('select', 110, 120, 580, 60)
    send('key', 'r')
    send('drag', 300, 300, 400, 380)
    send('key', 'c', 'cmd')
    send('key', 'return')
    s = await state()
    check(s.capturing && s.tool === null && s.shapes.length === 0 && !s.clipboardPngBytes, 'capture text: no drawing, ⌘C and Enter copy no image', `tool ${s.tool} shapes ${s.shapes.length} png ${s.clipboardPngBytes}`)
    send('key', 'esc')

    // 4. The area moving to another display takes its drawings, tool and editor with it.
    send('capture')
    send('select', 200, 150, 500, 350)
    send('tool', 'rect')
    send('drag', 300, 200, 450, 320)
    send('tool', 'beautifyEdit')
    const before = (await state()).editorOpen
    send('area-taken')
    s = await state()
    check(before && !s.editorOpen && !s.selection && s.shapes.length === 0 && s.tool === null, 'area moved away: editor, drawings and tool go with it', `editor ${before} -> ${s.editorOpen} | shapes ${s.shapes.length} | tool ${s.tool}`)
    send('select', 250, 200, 400, 250)
    send('key', 'z', 'cmd')
    s = await state()
    check(s.shapes.length === 0 && !s.editorOpen, 'a new area there: nothing to undo, no editor', `shapes ${s.shapes.length} editor ${s.editorOpen}`)
    send('key', 'esc')

    // 5. A changed background default (as "Remember last background" makes) keeps the colour picked.
    send('capture')
    send('select', 200, 150, 400, 250)
    send('tool', 'rect')
    send('style', 'color:#3b82f6')
    send('key', 'esc')
    send('key', 'esc')
    send('setting', JSON.stringify({ beautify: { presets: [{ id: 'ocean', name: 'Blossom', background: { type: 'solid', color: '#123456' }, padding: 30, radius: 8, shadow: 0 }] } }))
    send('capture')
    send('select', 200, 150, 400, 250)
    send('tool', 'rect')
    s = await state()
    check(s.styleActive.includes('color:#3b82f6'), 'colour picked kept after the background default changed', JSON.stringify(s.styleActive))
    send('key', 'esc')

    // 6. Esc right after ⌘C: history gets the capture only if it was copied.
    send('clearclip')
    const n0 = (await state()).history.length
    send('capture')
    send('select', 5, 5, 1400, 900)
    send('key', 'c', 'cmd')
    send('key', 'esc')
    await wait(500)
    s = await state()
    const added = s.history.length - n0
    check(added === (s.clipboardPngBytes > 0 ? 1 : 0), 'Esc right after ⌘C: history and clipboard agree', `copied ${s.clipboardPngBytes > 0} | added ${added}`)

    // 7. Double-clicking a preview's Copy button copies; only a double-click on the image edits.
    send('setting', '{"pin":{"afterCopy":true}}')
    send('capture')
    send('select', 200, 150, 400, 250)
    send('key', 'c', 'cmd')
    await wait(400)
    // The preview's buttons fit inside it, at every shape (Electron 2718f13).
    s = await state()
    const fits = [s.floating.at(-1)?.buttonsFit]
    for (const [x, y, w, h] of [[300, 100, 90, 700], [100, 300, 1100, 50], [300, 100, 160, 300]]) {
      send('capture')
      send('select', x, y, w, h)
      send('key', 'c', 'cmd')
      await wait(400)
      const f = (await state()).floating.at(-1)
      if (process.env.SHOT) { send('hover'); send('snapshot-view', 'thumb', `${process.env.SHOT}-${w}x${h}.png`) }
      fits.push(f?.buttonsFit && `${Math.round(f.frame[2])}x${Math.round(f.frame[3])}`)
    }
    check(fits.every(Boolean), 'preview buttons fit: normal, tall, strip and narrow previews', JSON.stringify(fits))
    // Past 1:2 or 3:1, the standard 16:9 preview (shared/thumb.ts); a 1:1.9 capture keeps its shape.
    check(fits[1] === '240x135' && fits[2] === '240x135' && fits[3] === '85x160', 'a tall capture and a strip get the 240×135 preview; others keep their shape', JSON.stringify(fits.slice(1)))
    // Tooltips like the toolbar's, kept 4 pt inside the (narrow) preview (Electron 587459c).
    const tips = []
    for (const which of ['close', '1', 'move']) {
      send('thumb-hover', which)
      await wait(450)
      const f = (await state()).floating.at(-1)
      const [x, y, w, h] = f.tip?.frame ?? [-1, -1, 0, 0]
      tips.push(f.tip && x >= 4 && x + w <= f.frame[2] - 4 && y >= 4 && y + h <= f.frame[3] - 4 ? f.tip.text : `${which}: ${JSON.stringify(f.tip)} in ${f.frame[2]}x${f.frame[3]}`)
    }
    send('unhover')
    check(JSON.stringify(tips) === '["close","edit","move"]', 'preview tooltips (toolbar style) show and stay inside a narrow preview', JSON.stringify(tips))
    send('closepins')
    send('capture')
    send('select', 200, 150, 400, 250)
    send('key', 'c', 'cmd')
    await wait(400)
    send('thumb-dblclick', 0)
    s = await state()
    check(!s.capturing, 'preview Copy double-clicked: no editor', `capturing ${s.capturing}`)
    send('thumb-dblclick', 'image')
    s = await state()
    check(s.capturing && s.editorOpen, 'preview image double-clicked: the editor opens')
    send('key', 'esc')
    send('key', 'esc')

    // 8. Pin: a held ⌘S saves once; two presses save two files, never the same name.
    send('thumb', 'pin')
    await wait(300)
    send('pin-key', 's', 'cmd')
    send('pin-key', 's', 'cmd', 'repeat')
    send('pin-key', 's', 'cmd', 'repeat')
    await wait(300)
    const one = existsSync(saves) ? readdirSync(saves).filter((f) => f.endsWith('.png')).length : 0
    send('pin-key', 's', 'cmd')
    await wait(300)
    const two = existsSync(saves) ? readdirSync(saves).filter((f) => f.endsWith('.png')).length : 0
    check(one === 1 && two === 2, 'pin: a held ⌘S saves once; a second press saves a second file', `${one} then ${two}`)
    send('closepins')

    // 11. An edit image that can't be decoded doesn't open (or leave) an editor waiting.
    send('edit-bad')
    s = await state()
    check(!s.capturing, 'undecodable edit image: no editor left open')

    // Not an Electron check: a capture window replaced while its screen was being grabbed wasn't left
    // out of that grab (its dim was in the frozen image, so the dim stacked). That screen is grabbed again.
    const mark = logMark()
    send('slow-grab', 600)
    send('capture')
    s = await waitFor((x) => x.hasImage, 3000)
    const log = logSince(mark)
    check(s.capturing && s.hasImage && /replaced during the grab: grabbing it again/.test(log) && (log.match(/opened in/g) || []).length === 1,
      'capture window replaced during the grab: that screen is grabbed again', log.slice(-300))
    send('key', 'esc')
  },

  async hotkeys() {
    await launch({ hotkeys: { capture: 'CommandOrControl+Shift+Z' } })
    let s = await state()
    check(s.captureHotkeyRegistered, 'capture hotkey registered (⌘⇧Z here)')
    send('capture')
    s = await state()
    check(!s.captureHotkeyRegistered, 'a capture-mode shortcut steps aside while capturing (⌘⇧Z = Redo)')
    send('key', 'esc')
    s = await state()
    check(s.captureHotkeyRegistered, 'it comes back after capture')
    await launch({ hotkeys: { capture: 'Alt+Shift+Z' } })
    s = await state()
    check(s.captureHotkeyRegistered, 'default capture hotkey ⌥⇧Z registers')
  }
}

const names = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(SUITES)
const runMark = logMark()
// An installed Snapkit holds its shortcuts exclusively (as Electron's), so the test app couldn't take
// them: it's quit for the run and opened again after.
const installed = spawnSync('pgrep', ['-f', '/Applications/Snapkit.app/Contents/MacOS/Snapkit']).status === 0
if (installed) {
  console.log('(quitting the installed Snapkit for the run; it opens again after)')
  spawnSync('osascript', ['-e', 'quit app id "com.charios.snapkit"'])
  await wait(1000)
}
try {
  for (const name of names) {
    console.log(name)
    await SUITES[name]()
  }
  // As Electron's "No page errors": nothing went wrong in the app while the suites ran. (A failed
  // update check is the network, not Snapkit.)
  const bad = logSince(runMark).split('\n').filter((l) => /error|failed|couldn't|exception|crash/i.test(l) && !/\[test\]|\[updates\]/.test(l))
  check(bad.length === 0, 'no errors in the log', bad.slice(0, 3).join(' / '))
} finally {
  quit()
  rmSync(root, { recursive: true, force: true })
  if (installed) spawnSync('open', ['/Applications/Snapkit.app'])
}
const failed = results.filter((r) => !r.ok).length
console.log(failed ? `\n${failed} of ${results.length} checks failed` : `\nAll ${results.length} checks passed`)
process.exit(failed ? 1 : 0)
