// Runs every end-to-end suite and checks its results, so bugs fixed once stay fixed.
// Usage: npm run e2e            (builds first)
//        node e2e/run-all.mjs [suite ...] [--out <dir>]
// Each check is a pattern the suite's output must contain, with what it guards.
import { spawn } from 'child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const SUITES = {
  annotate: [
    [/Enter adds a line: "Hello\\nSnapkit"/, 'typing into a new text box (focus ended the empty box)'],
    [/Esc finishes text and stays in capture mode: true/, 'Esc while typing ends the text, not the capture'],
    [/frame drag moved text box by 60 (2[7-9]|3[0-3])(\.\d+)? \| still typing: true/, 'moving a text box while typing (smart align may nudge it a few px)'],
    [/active after Stroke: \[ 'Stroke \(outline\)' \]/, 'one text style at a time'],
    [/typed size 36 -> text node: true/, 'typed text size applies'],
    [/dark background sets white text: #ffffff/, 'readable text on a dark background'],
    [/highlighter swatches: 5 \| custom: false/, 'highlighter has its own five colors'],
    [/blur strength: 36/, 'a blur area can be clicked and adjusted (hit-testing)'],
    [/style bar shown for selected arrow: true/, 'style bar follows the selected shape'],
    [/custom swatch added: true/, 'custom colors from the picker'],
    [/background on, dot shown: true/, 'background toggle and its dot'],
    [/color tab -> solid swatches: 8/, 'solid color presets'],
    [/shadow slider step: 0.01/, 'fine shadow slider'],
    [/arrow styles menu: \[ 'Arrow', 'Two-way arrow' \]/, 'arrow right-click menu'],
    [/two-way arrow drawn: 3 heads/, 'two-way arrow draws a head at each end'],
    [/picker fully visible: true/, 'color picker not clipped'],
    [/Esc while typing in editor -> still in editor: true \| typing: false/, 'Esc while typing in the editor'],
    [/Esc closed editor, still capturing: true/, 'Esc closes the editor only'],
    [/16:9\? true/, 'fixed output size'],
    [/renderer errors: none/, 'no page errors']
  ],
  regressions: [
    [/Esc closes only the color picker: true/, 'Esc with the color picker open cancelled the capture'],
    [/text style keeps the rectangle color: true/, 'text background style recolored other tools'],
    [/edit from preview shows the image: true/, 'editor opened from the preview without the image'],
    [/editor tools fit a small screen: true/, 'editor tools clipped on a small or scaled screen (Windows 150%)'],
    [/renderer errors: none/, 'no page errors']
  ],
  textedit: [
    [/selected text, click -> \["Hello world",11\]/, 'click into selected text to edit it'],
    [/text now: Hello world!/, 'edits are kept'],
    [/unselected text, click -> \["Hello world!",12\]/, 'click into text with the Text tool'],
    [/after drag: editing null/, 'dragging text moves it without editing']
  ],
  snap: [
    [/unselected drag -> rects \[\[300,200,1\],\[300,\d+,1\]\] \| guides while dragging [1-9]/, 'smart align, no tool'],
    [/selected drag -> rects \[\[300,200,1\],\[\d+,200,1\]\]/, 'smart align, selected shape'],
    [/tool active drag -> rects \[\[\d+,500,1\]/, 'smart align with a drawing tool active'],
    [/editor drag -> .*guides while dragging [1-9]/, 'smart align in the editor'],
    [/capture: .*guides while dragging [1-9] \| still typing: true/, 'smart align while typing text'],
    [/editor: .*guides while dragging [1-9] \| still typing: true/, 'smart align while typing text in the editor']
  ],
  pin: [
    [/after click: Floating preview: on \| dot: true/, 'floating preview toggle'],
    [/preview after ⌘C: 1 in the bottom-right corner: true/, 'preview after copy'],
    [/copy from preview: \{"width":\d+/, 'copy again from the preview'],
    [/drawings restored \(shape groups\): 1/, 'edit restores drawings'],
    [/Done closes the editor: true \| preview still there: true/, 'Done keeps the preview'],
    [/move handle moved the preview by -120 -80/, 'movable preview'],
    [/pin from preview: \[\{.*\}\] \| preview closed: true/, 'pin from the preview'],
    [/no preview when off: true \| pin still visible: true/, 'preview off per capture'],
    [/pin closed: true/, 'closing pins']
  ],
  history: [
    [/kept: 5 \(limit 5\) \| folders on disk: 5/, 'history limit prunes old captures'],
    [/panel visible: true \| cards: 5/, 'history panel opens'],
    [/starred: 1/, 'starring'],
    [/Enter copied: \{"width":800,"height":600\} \| panel closed: true/, 'copy from history'],
    [/after edit: count 5 \| same entry on top: true/, 'editing updates the same entry'],
    [/after delete: 4 \| folders: 4/, 'delete removes files'],
    [/after clear \(keep starred\): 1 starred: 1 \| folders: 1/, 'clear keeps starred']
  ],
  fullscreen: [
    [/floating previews: 2 \| overlay shown: false/, 'full-screen capture goes straight to the preview'],
    [/clipboard image: \{"width":\d+/, 'full-screen capture can copy'],
    [/editor open: true/, 'edit a full-screen capture'],
    [process.platform === 'darwin' ? /columns: 4 -> 5 \| saved size: \{"width":1100,"height":600\}/ : /columns: \d -> \d \| saved size: \{"width":\d+,"height":\d+\}/, 'resizable history window remembers its size'],
    [/default limit: 10/, 'history keeps 10 by default'],
    [/clear button: .*Clear History .*trash/, 'labeled Clear History button'],
    [/drag file: Snapkit .*\.png \d+ bytes/, 'drag a capture out of history'],
    [/after clear keep starred: 1/, 'clear, keep starred'],
    [/confirm text: Click again to delete all/, 'clear all asks twice'],
    [/after clear all: 0 \| errors: none/, 'clear all']
  ],
  hotkeys: [
    [/defaults registered: ⌥⇧Z:true ⌘⇧9:true ⌘⇧2:true ⌘⇧1:true/, 'default shortcuts'],
    [/while capturing: .*\| ⌘⇧Z: false/, 'a capture-mode shortcut steps aside (⌘⇧Z = Redo)'],
    [/0px 0px 0px 1.5px/, 'selection outline width'],
    [/⌘⇧Z registered again: true/, 'shortcut comes back after capture'],
    [/gray: settings dark\/gray \| history dark\/gray .*native dark/, 'Gray theme in every window'],
    [/glass off: 22px solid/, 'no glass knob with Liquid Glass off'],
    [/glass on: 22px glass/, 'glass knob with Liquid Glass on'],
    [/after that app quits, registered: true \| taken now: none/, 'takes a shortcut back once the app holding it quits'],
    // Only Windows refuses a shortcut another app holds (macOS lets both have it).
    ...(process.platform === 'win32' ? [[/Snapkit sees taken: capture/, 'notices a shortcut another app holds']] : [])
  ],
  safety: [
    [/hotkey toggles: true -> false/, 'capture hotkey again closes capture mode'],
    [/idle closes it: true/, 'idle timeout'],
    [/stuck page -> no dim left: true/, 'a stuck overlay never leaves the screen dimmed'],
    [/next capture works: true/, 'capture works after a stuck one'],
    [/leftover wait listeners: \[ 0, 0, 0 \]/, 'no listener leak over many captures'],
    [/record switch pauses history: true/, 'history record switch'],
    [/after folder button: capture dim showing: false/, 'history folder button left a stuck dim']
  ],
  settings: [
    [/general groups: Startup \| After a capture \| Saving/, 'Startup first'],
    [/saving rows: Ask where to save \| Screenshots folder \| File name/, 'folder right after Ask where to save'],
    [/dim default: 0.75 \/ mode dark/, 'defaults: 75% dim, Dark'],
    [/history keep slider: 10 of 30/, 'history keeps 10, up to 30'],
    [/settings hotkey row: ⌘⇧2 \| registered: true/, 'Open Settings shortcut'],
    [/switch on color: rgb\((9|10|11), 13[1-3], 25[4-5]\)/, 'blue switches'],
    [/name preview: Example: Bug 001.png/, 'file naming'],
    [/hotkey button: ⌘⌥⇧F11 \| saved: CommandOrControl\+Alt\+Shift\+F11/, 'recording a hotkey'],
    [/arrow key saved: w/, 'tool letters'],
    [/mode: dark \| saved: dark/, 'theme mode'],
    [/glass toggled on .*: on \| saved: true/, 'Liquid Glass toggle'],
    [/history window glass: on/, 'theme reaches windows already open'],
    [/group rows: \[ 'Arrows \(2\)', 'Shapes \(5\)' \]/, 'no separate Line / Ellipse rows'],
    [/palette saved: #00aa55/, 'quick colors'],
    [/step color saved: #3b82f6/, 'step color'],
    [/remember last: true/, 'remember last background'],
    [/gradients reset: 32/, 'gradient library reset'],
    [/W selects arrow arrow/, 'settings reach capture mode'],
    [/saved files: \[ 'Bug 001.png', 'Bug 002.png' \] \| next number: 3/, 'numbered file names'],
    [/update check: (You have the latest|Update available|No release)/, 'update check (needs the internet)'],
    [/after reset: appearance "default" \| toolbar kept: true/, 'reset one section'],
    [/settings errors: none/, 'no page errors']
  ]
}

const args = process.argv.slice(2)
const outAt = args.indexOf('--out')
const outRoot = outAt >= 0 ? args.splice(outAt, 2)[1] : mkdtempSync(join(tmpdir(), 'snapkit-e2e-'))
const names = args.length ? args : Object.keys(SUITES)

function run(name) {
  const out = join(outRoot, name)
  rmSync(out, { recursive: true, force: true })
  return new Promise((done) => {
    const p = spawn(process.execPath, [join('e2e', `${name}.mjs`), out], { stdio: ['ignore', 'pipe', 'pipe'] })
    let text = ''
    p.stdout.on('data', (d) => (text += d))
    p.stderr.on('data', (d) => (text += d))
    const timer = setTimeout(() => p.kill('SIGKILL'), 5 * 60 * 1000)
    p.on('close', (code) => {
      clearTimeout(timer)
      done({ code, text })
    })
  })
}

let failed = 0
for (const name of names) {
  const checks = SUITES[name]
  if (!checks) {
    console.log(`? unknown suite ${name}`)
    failed++
    continue
  }
  const t0 = Date.now()
  const { code, text } = await run(name)
  writeFileSync(join(outRoot, `${name}.log`), text)
  const misses = checks.filter(([re]) => !re.test(text))
  const ok = code === 0 && misses.length === 0
  console.log(`${ok ? '✓' : '✗'} ${name} (${checks.length - misses.length}/${checks.length} checks, ${Math.round((Date.now() - t0) / 1000)} s)`)
  if (code !== 0) console.log(`    exited with ${code}: ${text.trim().split('\n').filter((l) => !l.startsWith('[main]')).slice(-3).join(' / ')}`)
  for (const [re, what] of misses) console.log(`    missing: ${what}  (${re})`)
  if (!ok) failed++
}
console.log(failed ? `\n${failed} suite(s) failed. Logs: ${outRoot}` : `\nAll ${names.length} suites passed. Logs: ${outRoot}`)
process.exit(failed ? 1 : 0)
