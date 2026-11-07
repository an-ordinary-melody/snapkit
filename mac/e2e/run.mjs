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
