// Runs end-to-end suites and checks their results, so bugs fixed once stay fixed.
// Usage: npm run e2e                     every suite (builds first); a full pass clears the test backlog
//        npm run e2e:backlog             only the suites on the test backlog (see e2e/backlog.mjs)
//        node e2e/run-all.mjs [suite ...] [--backlog] [--out <dir>]
// Each check is a pattern the suite's output must contain, with what it guards.
import { spawn } from 'child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, loadBacklog, settleBacklog } from './backlog.mjs'

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
    [/editor zoom in: true .*\| point stays under the pointer: true \| drawings redrawn sharp: true/, 'Ctrl + scroll zooms the editor around the pointer, drawings stay sharp'],
    [/Space hand pans: true .*\| draws nothing: true \| hand gone on release: true/, 'Space + drag pans the zoomed editor (hand tool)'],
    [/pinch zooms in: true/, 'trackpad pinch zooms in'],
    [/Ctrl\+0 fits again: true \| still in editor: true/, 'Ctrl + 0 fits the editor preview again'],
    [/quick area capture copies the drawn area: true/, 'Quick area capture copies the first area drawn'],
    [/a click does not quick-copy: true/, 'Quick area capture ignores a click'],
    [/off: drawing keeps capture mode open: true/, 'Quick area capture off by default behaves as before'],
    [/scrollbars have no track: true/, 'thin themed scrollbars without a background strip'],
    [/editor tools fit a small screen: true/, 'editor tools clipped on a small or scaled screen (Windows 150%)'],
    [/renderer errors: none/, 'no page errors']
  ],
  compress: [
    [/standard copy: exact PNG on the clipboard: true \| smaller than a plain PNG: true \| full size: true/, 'copies are smaller PNGs, kept exactly on the clipboard'],
    [/editor Compress switch follows the setting: true \| size shown: true/, 'editor Compress switch starts from the setting, shows the size'],
    [/switched off: false \| chips hidden: true/, 'Compress switch turns off'],
    [/copy with Compress off is the original: true/, 'Compress off copies the original'],
    [/smallest copy is 1× size: true/, 'Smallest brings HiDPI captures to 1×'],
    [/renderer errors: none/, 'no page errors']
  ],
  lastarea: [
    [/first use opens a normal capture: true/, 'Capture last area with nothing remembered: a normal capture'],
    [/reopens the same area: true .* \| toolbar shown: true/, 'Capture last area reopens the last copied area'],
    [/a cancelled capture is not remembered: true/, 'a cancelled capture is not remembered'],
    [/after full screen it selects the whole screen: true/, 'a full-screen capture counts as the whole screen'],
    [/copy right away: no capture mode: true \| copied the area: .* true/, 'Copy last area right away'],
    [/remembered after a restart: true/, 'the last area survives a restart'],
    [/renderer errors: none/, 'no page errors']
  ],
  ruler: [
    [/off by default: true/, 'Ruler tool is off by default'],
    [/right after Blur: true/, 'Ruler sits right after Blur'],
    [/measures in image pixels: true/, 'Ruler shows its length in image pixels'],
    [/dragging an end updates the length: true/, 'dragging a ruler end updates the length'],
    [/renderer errors: none/, 'no page errors']
  ],
  ocr: process.env.SNAPKIT_E2E_ARGS?.includes('device-scale-factor')
    ? [[/ocr test: skipped/, 'needs a full-size screen (skipped on the scaled CI run)']]
    : [
    [/panel text matches: true/, 'Copy text reads English and Vietnamese into the text panel'],
    [/lines outlined: [1-9]/, 'the lines found are outlined'],
    [/copied as one line: true \| capture closed: true/, 'One line + Copy text copies and closes'],
    [/capture text copies: true \| hint: Drag over text to copy it \| note: Copied \d lines? of text \| closed: true/, 'Capture text copies the text right away'],
    [/empty area: No text found \| still capturing: true/, 'an area without text says so'],
    [/preview Text button:\s*Copied \d+ lines \| copied: true/, 'the floating preview copies its text'],
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
    ...(process.platform === 'win32'
      ? [[/preview stays above a focused app window: topmost=True above=True/, 'Windows: the preview stays on top of the app you go back to']]
      : []),
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
    // A 400×300 area: 800×600 pixels on a Retina Mac, 400×300 at 100% on Windows.
    [/Enter copied: \{"width":(400,"height":300|600,"height":450|800,"height":600)\} \| panel closed: true/, 'copy from history'],
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
    [process.platform === 'darwin' ? /history close button: false/ : /history close button: true/, 'History window close button (Windows only; macOS has its own)'],
    [/clear button: .*Clear History .*trash/, 'labeled Clear History button'],
    [/drag file: Snapkit .*\.png \d+ bytes/, 'drag a capture out of history'],
    [/after clear keep starred: 1/, 'clear, keep starred'],
    [/confirm text: Click again to delete all/, 'clear all asks twice'],
    [/after clear all: 0 \| errors: none/, 'clear all'],
    [/full screen with background: true \| history entry has it too: true/, 'full-screen capture gets the background when it is on by default (copy, preview, history)']
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
  // Windows only (skipped elsewhere): the capture window stays shown but invisible between captures.
  winkeep: process.platform === 'win32'
    ? [
        [/between captures: shown but invisible: true/, 'Windows: capture window kept shown, invisible, not on top (no show animation)'],
        [/round 1: opened true \| closed invisible true \| keyboard back to: Another app/, 'Windows: keyboard returns to the previous app after capture (1)'],
        [/round 3: opened true \| closed invisible true \| keyboard back to: Another app/, 'Windows: keyboard returns to the previous app after capture (3)']
      ]
    : [[/winkeep test: skipped/, 'Windows-only test']],
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
    [/quick area capture switch: false/, 'Quick area capture switch, off by default'],
    [/saving rows: Ask where to save \| Screenshots folder \| File name/, 'folder right after Ask where to save'],
    [/dim default: 0.75 \/ mode dark/, 'defaults: 75% dim, Dark'],
    [/history keep slider: 10 of 30/, 'history keeps 10, up to 30'],
    [/history recording switch: true/, '"Recording" switch in History settings, on by default (matches the History window)'],
    [/shortcut rows without descriptions: Capture area, Capture last area, Capture text, Capture full screen, History, Settings$/m, 'short shortcut names, no descriptions'],
    [/Dock icon with Settings open: true \| after closing: false \| capture still opens: true|^(?![\s\S]*Dock icon)/, 'macOS: Dock icon only while Settings is open'],
    [/settings hotkey row: (⌘⇧2|Ctrl\+Shift\+2) \| registered: true/, 'Open Settings shortcut'],
    [/switch on color: rgb\((9|10|11), 13[1-3], 25[4-5]\)/, 'blue switches'],
    [/name preview: Example: Bug 001.png/, 'file naming'],
    [/hotkey button: (⌘⌥⇧F11|Ctrl\+Alt\+Shift\+F11) \| saved: CommandOrControl\+Alt\+Shift\+F11/, 'recording a hotkey'],
    [/arrow key saved: w/, 'tool letters'],
    [/mode: dark \| saved: dark/, 'theme mode'],
    [/dropdown options: rgb\(242, 242, 244\) on rgb\(44, 44, 48\)/, 'readable dropdown options in the dark theme (Windows lists them natively)'],
    [/dim color: default #000000 \| saved #1e3a8a/, 'dim color setting (black by default)'],
    [/dim amount step: 0\.01/, 'dim amount moves in 1% steps'],
    [/capture dims in: .*rgba\(30, 58, 138, 0\.75\) 0px 0px 0px 99999px/, 'capture mode dims in the chosen color'],
    [/glass toggled on .*: on \| saved: true/, 'Liquid Glass toggle'],
    [/history window glass: on/, 'theme reaches windows already open'],
    [/group rows: \[ 'Arrows \(2\)', 'Shapes \(5\)' \]/, 'no separate Line / Ellipse rows'],
    [/palette saved: #00aa55/, 'quick colors'],
    [/step color saved: #3b82f6/, 'step color'],
    [/remember last: true/, 'remember last background'],
    [/step outline\/shadow: defaults 2 0.3 \| saved \{"color":"#00ff00","width":4\} 0/, 'step badge outline and shadow settings (defaults 2 px, 30%)'],
    [/step badge drawn with: 4px #00ff00 shadow off/, 'step badges use the outline and shadow settings'],
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
const fromBacklog = args.includes('--backlog')
if (fromBacklog) args.splice(args.indexOf('--backlog'), 1)
const full = !fromBacklog && !args.length
const names = fromBacklog ? [...new Set(loadBacklog().map((i) => i.suite))] : full ? Object.keys(SUITES) : args
if (!names.length) {
  console.log('Test backlog: empty, nothing to run.')
  process.exit(0)
}

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
const passed = []
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
  if (ok) passed.push(name)
  else failed++
}
console.log(failed ? `\n${failed} suite(s) failed. Logs: ${outRoot}` : `\nAll ${names.length} suites passed. Logs: ${outRoot}`)
console.log(describe(settleBacklog(passed, full && !failed)))
process.exit(failed ? 1 : 0)
