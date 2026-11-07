// Native Mac app flow checks: drives a debug build in test mode (fixed test screen, isolated profile,
// private pasteboard) through snapkitctl and checks its state, like the Electron e2e suites. Each check
// carries the label of the Electron check it ports (docs/native-mac-testing.md §2).
// Usage: node mac/e2e/run.mjs [suite …]      (builds first; suites: capture annotate output safety hotkeys)
// Note: capture mode really opens on screen while this runs (about 30 s).
import { execFileSync, spawnSync } from 'child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'fs'
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
const app = join(mac, 'build', 'Snapkit Dev.app')

const root = mkdtempSync(join(tmpdir(), 'snapkit-native-e2e-'))
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
  for (let i = 0; i < 20 && !existsSync(stateFile); i++) await wait(50)
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
    send('thumb', 'text')
    s = await waitFor((s) => s.floating[0]?.labels[2] !== 'Reading…')
    check(/Copied|No text/.test(s.floating[0].labels[2]), 'the preview reads its text', s.floating[0].labels[2])
    send('thumb', 'edit')
    s = await state()
    check(s.capturing && s.shapes.length === 1, 'edit restores drawings')
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
    send('select', 300, 200, 400, 300)
    send('tool', 'arrow')
    send('drag', 350, 250, 500, 350)
    send('tool', 'beautifyEdit')
    let s = await state()
    const before = s.editorPreview
    const ax = before[0] + before[2] * 0.25, ay = before[1] + before[3] * 0.25
    send('editor', 'zoom', 2, ax, ay)
    s = await state()
    const after = s.editorPreview
    const u = (ax - after[0]) / after[2], v = (ay - after[1]) / after[3]
    check(s.editorZoom === 2 && Math.abs(u - 0.25) < 0.01 && Math.abs(v - 0.25) < 0.01, 'editor zoom in: the point stays under the pointer', JSON.stringify([u, v]))
    send('editor', 'space', 'down')
    send('editor', 'drag', 600, 500, 650, 520)
    send('editor', 'space', 'up')
    s = await state()
    check(s.editorPreview[0] - after[0] === 50 && s.shapes.length === 1, 'Space hand pans, draws nothing', JSON.stringify([s.editorPreview[0] - after[0], s.shapes]))
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
try {
  for (const name of names) {
    console.log(name)
    await SUITES[name]()
  }
} finally {
  quit()
  rmSync(root, { recursive: true, force: true })
}
const failed = results.filter((r) => !r.ok).length
console.log(failed ? `\n${failed} of ${results.length} checks failed` : `\nAll ${results.length} checks passed`)
process.exit(failed ? 1 : 0)
