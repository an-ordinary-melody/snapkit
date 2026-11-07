# Native macOS Snapkit: testing plan

Status: in use, goes with [native-mac-plan.md](native-mac-plan.md). §2 maps every Electron check to its native check; §6 lists the commands. Some of §1 and §4 describes the original plan (XCUITest, per-theme scenes, token tests) where the build went a simpler way; §2 and §4 say what runs today.

Goal: the native app does everything the Electron app does, looks and behaves
the same, and every bug the Electron e2e suites guard against stays guarded.
Electron remains the reference: when they differ, Electron is right unless we
decide otherwise and record it.

## 1. Test layers

| Layer | Tool | Runs where | Speed |
|---|---|---|---|
| **U** Unit | Swift Testing on `SnapkitCore` | CI + local | seconds |
| **R** Render / image output | Swift Testing, renders to PNG | CI + local | seconds |
| **UI** Flows | XCUITest against the app in test mode | CI + local | minutes |
| **V** Visual parity | Both apps render the same scenes; diff | local (CI later) | minutes |
| **P** Performance / soak | Timing harness, 24 h run | local | minutes / a day |
| **M** Manual | Checklist (§5) | real Mac | before release |

### U: Unit tests (`SnapkitCore`)

Pure logic with no window, each one checked against the **shared fixtures** (§3),
so Electron's vitest suite and the Swift suite assert the same results:

| Area | Electron source (and its vitest file) | Swift |
|---|---|---|
| Settings merge, patch, reset, defaults, toolbar order | `shared/settings.ts` (`settings.test.ts`) | `SettingsTests` |
| Accelerator parse/format (`Alt+Shift+Z` ↔ key code + modifiers) | `main/hotkeys.ts` | `AcceleratorTests` |
| File naming, unique names, numbering | `shared/naming.ts` (`naming.test.ts`) | `NamingTests` |
| History prune rules, startup tidy-up, atomic writes | `shared/history.ts`, `main/history.ts` (`history.test.ts`) | `HistoryStoreTests` (temp folder) |
| Version compare, release picking | `shared/version.ts` (`version.test.ts`) | `VersionTests` |
| Engine order | `main/capture/order.ts` (`order.test.ts`) | `CaptureEngineOrderTests` |
| Toolbar / style bar placement, rect from points, resize, move | `overlay/layout.ts` (`layout.test.ts`) | `OverlayLayoutTests` |
| Annotation model: shapes, arrow heads, ruler label/ticks, snap45, snapBox, step numbers, undo | `annotate/model.ts` (`model.test.ts`) | `AnnotationModelTests` |
| Color helpers (readable text color, hue) | `annotate/color.ts` (`color.test.ts`) | `ColorTests` |
| Beautify layout: frames, padding, radius, shadow geometry | `beautify/layout.ts` (`layout.test.ts`) | `BeautifyLayoutTests` |
| `CaptureDoc` / `doc.json` decode and encode round trip | `shared/ipc.ts` | `CaptureDocTests` |
| `last-area.json` and display matching | `main/lastArea.ts` | `LastAreaTests` |

### R: Image-output tests

Render a fixture `CaptureDoc` (fixed source PNG + shapes + background) to PNG
and check:

- **Exact size:** output width/height in px for each frame (auto, 1:1, 16:9,
  4:3, 9:16, fixed size) at scale 1 and 2. Compared with the expected sizes in
  the fixture, which Electron's renderer produced.
- **Padding and shadow:** pixel probes, e.g. the background colour at
  `(padding/2, padding/2)`, the screenshot's first pixel at `(padding, padding)`
  inside the radius, shadow darkening below the image.
- **Each shape:** one reference PNG per shape type and style, compared with a
  tolerance (§4) against the **Electron** render of the same doc.
- **Compression:** output is a valid PNG, ≤ 256 colours for `standard`, 1× size
  for `smallest` on a scale-2 doc, smaller than the uncompressed PNG, and the
  original returned when compressing doesn't help.
- **Clipboard bytes:** the PNG on `NSPasteboard` as `public.png` is byte-identical
  to the file we produced.
- **Thumbnails:** history `thumb.jpg` at most 320 px wide or 240 px tall.

### UI: Flow tests (XCUITest)

The app is driven in **test mode**, a launch argument compiled only into Debug
and test builds (never Release):

- `-SnapkitTestScreen <png>` per display: capture uses this image instead of
  ScreenCaptureKit, so no Screen Recording permission is needed and outputs are
  deterministic.
- `-SnapkitProfile <dir>`: an isolated Application Support folder (as Electron's
  `--user-data-dir`), pre-filled with a fixture `settings.json`.
- A test hook to fire actions without real global hotkeys (`capture`, `history`,
  `fullscreen`, `lastArea`, `ocr`, `settings`), mirroring how Electron tests emit
  `second-instance`.
- Accessibility identifiers on every control (`tool.arrow`, `action.copy`,
  `stylebar.color.0`, …) named after the feature ids in `features.ts`.
- Outputs read back from the profile folder, the save folder, and the pasteboard.

Flows covered: hotkey → overlay → select → annotate → copy/save; Esc at every
level; quick copy; last area; full screen; floating preview; pins; history
panel; Settings sections; OCR (with a fixture image of known English and
Vietnamese text).

Real capture (actual ScreenCaptureKit, real hotkeys) runs in a separate
**`RealCapture`** test plan, locally only (§6).

## 2. Parity with Electron: every e2e check mapped

Every check in `e2e/run-all.mjs` has a native check or an N/A row with the reason.
Native checks live in `mac/e2e/run.mjs` (flow checks: the debug app driven through
`snapkitctl`, written as `suite › label`) and `mac/Tests/SnapkitCoreTests` (unit tests,
written as `unit › test`). `mac/scripts/parity-coverage.mjs` fails if a native check
named here doesn't exist, so a renamed or dropped check shows up.

Why not XCUITest: capture mode, the editor, pins and the history grid are custom-drawn
AppKit views (as Electron draws on a canvas), so XCUITest would see one big element per
window. The test hook drives the same event handlers the mouse and keyboard reach, and
reads state back, which is what the Electron suites do through Playwright. The Settings
window (SwiftUI) is read through text recognition on its own render, because SwiftUI
builds no accessibility tree until an assistive app attaches.

### annotate (21)

| Electron check | Native check |
|---|---|
| Typing into a new text box: Enter adds a line | editor › Enter adds a line: "Hello\nSnapkit"; Esc ends the text, not the capture |
| Esc while typing ends the text, not the capture | annotate › Esc while typing ends the text, not the capture |
| Moving a text box while typing (snap may nudge a few px) | parity › Moving a text box while typing (snap may nudge a few px) |
| One text style at a time | editor › one text style at a time |
| Typed text size applies | editor › typed text size applies |
| Readable (white) text on a dark background | editor › dark background sets white text; unit › colors |
| Highlighter has its own five colours | editor › highlighter has its own five colors |
| A blur area can be clicked and adjusted | editor › a blur area can be clicked (hit-testing) |
| Blur strength down to 0 (no blur) | editor › blur strength goes down to 0 |
| Style bar follows the selected shape | editor › style bar follows the selected arrow |
| Custom colours from the picker | editor › custom swatch added; the selected arrow takes it |
| Background toggle and its dot | background › background on, dot shown |
| Solid colour presets (8) | background › color tab -> solid swatches |
| Fine shadow slider (step 0.01) | background › fine shadow slider (0.01 steps) |
| Arrow right-click menu (Arrow, Two-way arrow) | editor › arrow right-click menu |
| Two-way arrow draws a head at each end | editor › two-way arrow draws a head at each end |
| Colour picker not clipped | editor › picker fully visible |
| Esc while typing in the editor stays in the editor | background › Esc while typing in the editor -> still in editor, typing ends |
| Esc closes the editor only | background › Esc closes the editor only, still capturing |
| Fixed output size (16:9) | background › fixed output size: 16:9 |
| No page errors | all › no errors in the log |

### regressions (13)

| Electron check | Native check |
|---|---|
| Esc with the colour picker open only closes the picker | editor › Esc closes only the color picker |
| Text background style doesn't recolour other tools | parity › Text background style doesn't recolour other tools |
| Editor opened from the preview shows the image | preview › Editor opened from the preview shows the image |
| Ctrl/⌘ + scroll zooms around the pointer, drawings sharp | editorView › editor zoom in: the point stays under the pointer |
| Space + drag pans the zoomed editor, draws nothing | editorView › Space hand pans, draws nothing |
| Trackpad pinch zooms in | parity › Trackpad pinch zooms in |
| Ctrl/⌘ + 0 fits again, still in editor | editorView › Ctrl/⌘ + 0 fits again, still in editor |
| Quick area capture copies the drawn area | output › Quick area capture copies the drawn area |
| Quick area capture ignores a click | parity › Quick area capture ignores a click |
| Quick capture off: drawing keeps capture mode open | parity › Quick capture off: drawing an area keeps capture mode open |
| Thin themed scrollbars without a track | N/A: native uses macOS overlay scrollers (thin, no track) in Settings and History; seen in the scene renders |
| Editor tools fit a small screen | parity › Editor tools fit a small screen (1280×720) |
| No page errors | all › no errors in the log |

### compress (6)

| Electron check | Native check |
|---|---|
| Copies are smaller PNGs, exact bytes on the clipboard, full size | compress › standard copy: a palette PNG on the clipboard, smaller than a plain PNG, full size |
| Editor Compress switch follows the setting, shows the size | parity › Editor Compress switch follows the setting, shows the size |
| Compress switch turns off, chips hidden | parity › Compress switch turns off, chips hidden |
| Copy with Compress off is the original | compress › copy with Compress off is the original |
| Smallest brings HiDPI captures to 1× | compress › smallest copy is 1× size |
| No page errors | all › no errors in the log |

### lastarea (7)

| Electron check | Native check |
|---|---|
| Nothing remembered: a normal capture | lastarea › Capture last area with nothing remembered: a normal capture |
| Reopens the last copied area, toolbar shown | lastarea › reopens the last copied area, toolbar shown |
| A cancelled capture is not remembered | lastarea › a cancelled capture is not remembered |
| After full screen it selects the whole screen | lastarea › after full screen it selects the whole screen |
| Copy right away: no capture mode, copies the area | lastarea › copy right away: no capture mode, copied the area |
| Survives a restart | lastarea › the last area survives a restart |
| No page errors | all › no errors in the log |

### ruler (5)

| Electron check | Native check |
|---|---|
| Off by default | unit › settings (ruler off by default) |
| Right after Blur in the toolbar | editor › Ruler sits right after Blur; unit › toolbarOrder |
| Measures in image pixels | editor › ruler drawn (shows 400 px on Retina) |
| Dragging an end updates the length | editor › dragging a ruler end updates the length |
| No page errors | all › no errors in the log |

### ocr (8)

| Electron check | Native check |
|---|---|
| Reads English and Vietnamese into the text panel | ocr › Copy text reads English and Vietnamese into the text panel |
| The lines found are outlined | ocr › the lines found are outlined |
| One line + Copy text copies and closes | ocr › One line + Copy text copies and closes |
| Capture text opens the panel (hint, toolbars hidden, copies, closes) | ocr › Capture text opens with toolbars hidden (hint: Drag over text to copy it); ocr › capture text copies and closes |
| Copy right away, with a message | ocr › copy right away, with a message |
| An area without text says "No text found" | ocr › an area without text says so |
| The floating preview copies its text | preview › the preview reads its text |
| No page errors | all › no errors in the log |

### textedit (4)

| Electron check | Native check |
|---|---|
| Click into selected text to edit it (caret at end) | editor › click into selected text to edit it |
| Edits are kept | editor › edits are kept |
| Click into text with the Text tool | editor › click into text with the Text tool |
| Dragging text moves it without editing | editor › dragging text moves it without editing |

### snap (6)

| Electron check | Native check |
|---|---|
| Smart align, no tool (guides shown) | editor › smart align: a dragged shape snaps to line up with another; unit › model (snapBox) |
| Smart align, selected shape | parity › Smart align, selected shape |
| Smart align with a drawing tool active | parity › Smart align with a drawing tool active (grabbing a shape moves it) |
| Smart align in the editor | parity › Smart align in the editor |
| Smart align while typing text | parity › Smart align while typing text (it snaps to the nearest shape) |
| Smart align while typing text in the editor | parity › Smart align while typing text in the editor |
| (also: ⌘ places freely) | editor › ⌘ places freely |

### pin (10; one is Windows-only)

| Electron check | Native check |
|---|---|
| Floating preview toggle and its dot | preview › Floating preview toggle: on, with its dot |
| Preview after ⌘C in the bottom-right corner | preview › preview after ⌘C in the bottom-right corner |
| Windows: preview stays on top of the app you go back to | N/A: Windows only (the Mac preview is a floating panel above other apps by design) |
| Copy again from the preview | preview › copy again from the preview |
| Edit restores drawings | preview › edit restores drawings |
| Done keeps the preview | preview › leaving the editor keeps the preview |
| Movable preview (moved by −120, −80) | preview › movable preview (-120, -80) |
| Pin from the preview, preview closes | preview › pin from the preview; preview closed |
| No preview when off for this capture; pin still visible | preview › no preview when off; pin still visible |
| Closing pins | preview › closing pins |

### history (7)

| Electron check | Native check |
|---|---|
| Limit prunes old captures (5 kept, 5 folders) | history › kept: 5 (limit 5) \| folders on disk: 5; unit › history pruning |
| Panel opens with 5 cards | history › history panel opens with 5 cards |
| Starring | history › starring |
| Enter copies (size per scale), panel closes | history › Enter copies (800×600 on Retina) and closes the panel |
| Editing updates the same entry | history › after edit: count 5 \| same entry on top |
| Delete removes files | history › delete removes files |
| Clear keeps starred | history › clear keeps starred |

### fullscreen (12)

| Electron check | Native check |
|---|---|
| Goes straight to the preview, no overlay | fullscreen › full-screen capture goes straight to the preview |
| Can copy | fullscreen › full-screen capture can copy (Copy full-screen captures) |
| Edit a full-screen capture | fullscreen › edit a full-screen capture |
| Resizable history window remembers its size | historyPanel › resizable history window remembers its size (columns 4 -> 5) |
| History keeps 10 by default | settings › history keeps 10 by default (up to 30) |
| History close button: macOS uses its own (none of ours) | parity › History close button: macOS uses its own (none of ours) |
| Labelled Clear History button | parity › Labelled Clear History button |
| Drag a capture out of history (`Snapkit <date>.png`) | historyPanel › drag a capture out of history (Snapkit <date>.png) |
| Clear, keep starred | history › clear keeps starred |
| Clear all asks twice ("Click again to delete all") | historyPanel › clear all asks twice |
| Clear all | historyPanel › clear all |
| Background on by default applies to copy, preview and history | historyPanel › full-screen capture gets the background when it is on by default (preview, history) |

### hotkeys (9; one is Windows-only)

| Electron check | Native check |
|---|---|
| Default shortcuts registered | hotkeys › default capture hotkey ⌥⇧Z registers; settings › the settings shortcut is registered from the start |
| ⌘⇧Z steps aside while capturing | hotkeys › a capture-mode shortcut steps aside while capturing (⌘⇧Z = Redo) |
| Selection outline width 1.5 px | scene `overlay-selection` (§4) |
| ⌘⇧Z registered again after capture | hotkeys › it comes back after capture |
| Gray theme in every window | settings › Gray is a dark theme with lighter surfaces, in every open window |
| No glass knob with Liquid Glass off (22 px solid) | N/A for automation: a held SwiftUI switch can't be driven without an assistive app; checked by hand (§4 manual list). The knob stretches to 22 pt, solid |
| Glass knob with Liquid Glass on | Same as above; with Liquid Glass on the held knob is a white-to-clear gradient |
| Takes a shortcut back once the app holding it quits | parity › Takes a shortcut back once the app holding it quits |
| Windows: notices a shortcut another app holds | N/A: Windows only; macOS lets two apps register the same shortcut |

### safety (11, including 3 macOS-only)

| Electron check | Native check |
|---|---|
| Capture hotkey again closes capture mode | safety › capture hotkey again closes capture mode |
| Idle timeout | safety › idle timeout closes capture mode |
| A stuck overlay never leaves the screen dimmed | N/A: there is no separate renderer that can hang while its window stays up; the frozen image and the dim are one view drawn on the main thread. The closest Mac risk, a capture window that never reached the screen, is the next rows |
| Capture works after a stuck one | safety › capture works after replacing them |
| No listener leak over many captures | safety › many captures in a row leave nothing on screen |
| Display change during capture: kept open, rebuilt after | parity › Display change during capture: kept open; parity › Display change: windows rebuilt after capture closes |
| macOS: a capture window that never showed is replaced | safety › pressed again with no input since opening: the capture windows are replaced |
| macOS: capture works after replacing it | safety › capture works after replacing them |
| macOS: a seen capture closed by the hotkey keeps its windows | parity › macOS: a seen capture closed by the hotkey keeps its windows |
| History record switch pauses history | historyPanel › nothing recorded while paused |
| History folder button leaves no stuck dim | N/A: the Electron bug was the history window's dim staying behind Finder; the native history panel has no dim layer. Its folder button only calls NSWorkspace |

### settings (34)

| Electron check | Native check |
|---|---|
| General groups: Startup, After a capture, Saving | settings › General starts with Startup, Capture, Saving |
| Quick area capture switch, off by default | settings › quick area capture switch shown; unit › settings (defaults from the fixture) |
| Saving rows in order | settings › saving rows |
| Defaults: 75% dim, Dark | settings › dim amount and dark mode by default (shared fixture) |
| History keeps 10, up to 30 | settings › history keeps 10 by default (up to 30) |
| History Recording switch on by default | historyPanel › nothing recorded while paused; unit › settings (paused false by default) |
| Short shortcut names, no descriptions | settings › global shortcut rows include Settings |
| Dock icon only while Settings is open | settings › Dock icon while Settings is open; settings › the Dock icon goes when Settings closes |
| Open Settings shortcut | settings › the settings shortcut is registered from the start |
| Blue switches | scene `settings-general` (§4) |
| File naming preview "Example: Bug 001.png" | settings › name preview "Bug 001.png" |
| Recording a hotkey saves `CommandOrControl+Alt+Shift+F11` | settings › recording a hotkey saves CommandOrControl+Alt+Shift+F11 |
| Tool letters saved | settings › tool letter saved |
| Theme mode saved | settings › theme mode dark reaches Settings and the open history panel |
| Readable dropdown options in dark theme | N/A: native pop-up menus are drawn by macOS in the window's appearance |
| Dim colour setting (black by default) | settings › dim colour and Liquid Glass saved |
| Dim amount in 1% steps | settings › Dim amount in 1% steps (37% shown) |
| Capture mode dims in the chosen colour | settings › capture mode dims in the chosen colour |
| Liquid Glass toggle | settings › dim colour and Liquid Glass saved |
| Theme reaches windows already open | settings › theme mode dark reaches Settings and the open history panel |
| No separate Line / Ellipse rows (Arrows 2, Shapes 5) | settings › tool group rows (Arrows, Shapes) |
| Quick colours saved | settings › Quick colours reach capture mode (first swatch #00aa55) |
| Step colour saved | settings › a step badge uses the colour and outline from Settings |
| Remember last background toggles off | settings › remember last background off |
| Step outline/shadow defaults and saved | settings › step outline 2 px white and 30% shadow by default (fixture) |
| Step badges use those settings | settings › a step badge uses the colour and outline from Settings |
| Gradient library reset (32) | settings › gradients reset to the defaults; settings › the gradient library has 32 by default |
| Settings reach capture mode (W selects arrow) | settings › W picks Arrow in capture mode; settings › capture mode uses the new toolbar order and hides Highlighter |
| Numbered file names, next number 3 | settings › saves are numbered Bug 001, Bug 002 |
| Text starting style: Light and Dark save a background, the segment follows | settings › text starting style: Dark and Light save a background, the segment follows; unit › starting text style |
| Text starts as: Dark background | settings › text starts as: Dark background (white text); unit › starting text style |
| Update check (needs internet) | settings › update check answers; unit › version |
| Reset one section | settings › Reset section puts Appearance back to defaults; settings › resetting one section keeps the others |
| No page errors | all › no errors in the log |

### states (9)

Bad states Electron fixed in 1a00d6f (docs/state-machines.md). Native already passed most by design: outputs run in order on the main thread, and every text read checks the capture session and area it started on.

| Electron check | Native check |
|---|---|
| A text read finishing after capture mode closed froze the next capture | states › late read: no note, no copy, tools still work; states › Esc during a read drops its result |
| Two text reads at once: only the newest one is copied | states › two reads: only the second area is copied |
| Capture text has no drawing and doesn't copy the image | states › capture text: no drawing, ⌘C and Enter copy no image |
| An area moved to another display left its drawings and editor behind | states › area moved away: editor, drawings and tool go with it; states › a new area there: nothing to undo, no editor |
| "Remember last background" reset the color picked | states › colour picked kept after the background default changed |
| Esc right after ⌘C still added the capture to history | states › Esc right after ⌘C: history and clipboard agree |
| Double-clicking a preview button opened the editor | states › preview Copy double-clicked: no editor; states › preview image double-clicked: the editor opens |
| A pin saved twice at once wrote two files | states › pin: a held ⌘S saves once; a second press saves a second file |
| No page errors | all › no errors in the log |

Pin saves: native saves are instant, so two separate ⌘S presses rightly make two files (with different names); the case left is a held key. Also from 1a00d6f, outside the e2e suites: the latest copy wins the clipboard and saves never overwrite each other (`output.test.ts`) hold natively because copies and saves run one after another on the main thread and the name is picked right before writing; one permission dialog at a time (`permissions.test.ts`) is a guard in `Permissions.ask`, not testable without revoking Screen Recording; an undecodable edit image is states › undecodable edit image: no editor left open.

### Not in `run-all.mjs`

| Electron script | Native |
|---|---|
| `winkeep.mjs` (3 checks, Windows only) | N/A: no Mac equivalent; Mac panels are hidden between captures |
| `timing.mjs` (hotkey → dim → frozen image) | Not ported yet: timings are logged (`[capture]` lines) but no harness compares them |
| `smoke.mjs` (Linux/Xvfb) | N/A: no Linux build |
| `backlog.mjs` | Not ported: the native suites are small enough to run whole |

Native-only checks (no Electron equivalent): capture window keyboard focus without
activating, arrow-key nudge/resize of the selection, undo/redo, the Electron-format
`last-area.json`, pin zoom and opacity.

## 3. Shared fixtures

One folder both apps test against: `fixtures/` at the repo root.

```
fixtures/
  settings/          <case>.saved.json + <case>.expected.json   (merge, patch, reset, bad types, unknown keys)
  accelerators.json  [["Alt+Shift+Z", {keyCode, modifiers}, "⌥⇧Z"], ...]
  naming.json        [{rule, date, n, expected}, ...]
  history/<case>/    index.json + entry folders + expected-prune.json
  docs/<case>/       source.png, doc.json, expected.json ({width, height, probes: [...]}), electron.png
  layout/            toolbar placement and style bar cases (from layout.test.ts)
  screens/           test-screen PNGs: 1470×956@2, 1920×1080@1, 1280×720@1, text-en-vi.png
  ui-tokens.json     §4
  scenes/            §4
```

- Electron's vitest tests are changed to read the same files (the cases now in
  `*.test.ts` move into the JSON). Both suites then fail on the same input.
- `docs/<case>/electron.png` is produced by Electron (`npm run fixtures:render`),
  so the native render is compared with what Electron outputs today.
- A fixture change needs both suites green; CI runs both on every PR that
  touches `fixtures/`.

## 4. UI/UX matching

### Visual parity: same scene, both apps

A **scene** (`fixtures/scenes/*.json`, format in `e2e/scene.mjs`) names a window, a test
screen, a selection, shapes, settings and what's open. Both apps render it to a PNG at
the display's scale, without the OS window frame:

- Electron: `node e2e/scene.mjs fixtures/scenes <dir>` (test-only `SNAPKIT_SCENE` hook).
- Native: `node mac/e2e/scene.mjs fixtures/scenes <dir> --compare <electron-dir>` drives the
  debug app through the test hook and draws each window with `cacheDisplay(in:to:)`. With
  `--compare` it writes Electron | native | differences side by side and `report.md`, the
  share of pixels that differ by more than 24/255 in any channel.

The app and the fixtures are copied to a temp folder first, so the debug app never reads
from `~/Desktop` (macOS would ask for folder access again after each ad-hoc signed build).

Latest run (2026-11-08, MacBook Air display, dark theme):

| Scene | Differ | What differs |
|---|---|---|
| overlay-dim | 0.00% | — |
| overlay-selection | 0.13% | text anti-aliasing of the size label |
| overlay-shapes-arrow | 0.31% | anti-aliasing of arrow, rectangle and text edges |
| overlay-variants-rect | 0.30% | menu text anti-aliasing |
| overlay-color-picker | 0.37% | picker text and field edges |
| preview | 0.21% | edge anti-aliasing |
| pin | 0.00% | — |
| editor-default | 1.41% | text anti-aliasing in the sidebar; a thin divider before Copy in the dock |
| history-basic, history-empty | 1.0–1.1% | text anti-aliasing; the selected card's size label is white, not dimmed |
| settings-general, settings-background | 5–7% | Core Text vs Chromium text rendering on every label (the main part); 1–2 pt row offsets; no visible scrollbar (macOS overlay scrollers) |

**Approving differences:** a difference stays a failure until the user approves it.
Approved ones are listed here with the date; anything new in a later run is
unapproved.

Approved 2026-11-08 (by the user, as listed in the table above):
- Text and edge anti-aliasing everywhere (Core Text vs Chromium).
- Settings: rows 1–2 pt off Electron's; macOS overlay scrollers instead of an always-visible scrollbar.
- Editor: a thin divider before Copy in the dock.
- History: the selected card's size label is white, not dimmed. Relative times ("1 h ago") are
  only comparable when both renders run close together.

### Layout tokens

`scripts/extract-ui-tokens.mjs` writes `fixtures/ui-tokens.json` from two sources:

1. **CSS custom properties** in `styles.css` and `settings.css` per theme
   (light, dark, gray, glass): colours (`--ui-fg`, `--ui-hover`, `--ui-accent`, …),
   radii (`--ui-radius` 16, `--ui-btn-radius` 8), shadows.
2. **Measured values** from the running Electron app via Playwright
   `getComputedStyle`/`getBoundingClientRect`: toolbar button size and gap, toolbar
   padding, style bar height, swatch size, selection outline (1.5 px), size label
   font and offset, handle size, switch knob (22 px), settings sidebar width, row
   height, font family/size/weight per text role.

Native generates `UITokens.swift` from the JSON at build time, so the app uses the
same numbers, and `UITokenTests` checks that rendered native views measure the same
(within 0.5 pt). When Electron's CSS changes, rerunning the script shows what the
native app must follow.

### Behaviour parity

| Behaviour | How it's checked |
|---|---|
| Keyboard: Esc levels, ⌘C/⌘S/⌘Z/⇧⌘Z, arrows nudge (Shift 10 px, Alt resize), Enter, Delete | Table-driven UI test: one fixture `keys.json` of (state, key, expected state), run against both apps |
| Tool letter keys and custom `toolKeys` | Same `keys.json` |
| Cursor per tool and over handles | Native unit test of the cursor map vs a table taken from Electron's CSS `cursor` values |
| Snapping (45°, square, smart align, ⌘ free) | `snap` and `annotate` ports + `AnnotationModelTests` on shared cases |
| Undo granularity (slider drag = one step) | `UndoTests` on the shared model cases |
| Timing | `PerfTests`: hotkey → dim, hotkey → frozen image, Esc → hidden, p50/p95 over 30 captures, same harness idea as `timing.mjs`. Native must be ≤ Electron on the same Mac |
| Defaults | `SettingsTests.defaults` compares native defaults with `DEFAULT_SETTINGS` exported to JSON |

### Manual UX checklist

Run on a real Mac before native replaces Electron and before each later release, with the Electron app open beside it (for as long as it still runs on Mac).
Kept in `docs/native-mac-checklist.md` (to write in Phase 1), ticked per release:

- Feel: drag smoothness, handle grab size, text caret and selection, scroll/pinch zoom.
- Glass and blur look right over light and dark wallpapers.
- Tooltips: wording, delay, position; menus' wording matches.
- Animations: none where Electron has none (overlay must appear instantly).
- Copy then paste into Slack, a browser, Notion, Preview, Keynote.
- Drag out of a pin/history into Finder, Slack, a browser.
- VoiceOver reads tools and actions sensibly.
- Anything the visual diff approved as different still feels the same.

## 5. Mac-specific edge cases

| Case | Automated | Manual |
|---|---|---|
| Two and three displays, different arrangement | UI test with several `-SnapkitTestScreen` (virtual screens in test mode) | Real displays |
| Mixed scale factors (Retina + 1× external) | Render and UI tests at scale 1 and 2; selection across scales | Real displays |
| Display added/removed during capture | `testDisplayChangeDeferred` | Unplug during capture |
| Spaces: capture from another desktop, from a full-screen app, after Mission Control changes | `OverlayPoolTests` (rebuild on simulated `activeSpaceDidChange`) | Required: full-screen Safari/Keynote, 3+ Spaces, add/remove a Space, then capture |
| Invisible overlay (panel not on screen) | `testUnseenPanelReplaced` | Covered by soak |
| Space slide (macOS jumps to another desktop to show the panel) | Watchdog logs; `RealCapture` checks the active Space doesn't change | Required |
| Screen Recording permission: first run, denied, granted later, revoked | `PermissionTests` with the check behind a protocol (fake states) | Fresh macOS user account: full flow, and after an update with the same signing cert the grant still works |
| Sleep/wake, lid close with external display | Simulated `didWakeNotification` → pool rebuilt | Real |
| Long uptime | — | **Soak:** test build runs 24 h; a script captures every 5 min across Space switches and display sleep; log must show every capture visible (watchdog never fired twice in a row), memory flat (±20 MB) |
| macOS versions | CI on macOS 14 and the newest runner | 14, 15, 26 on real or VM Macs before release |
| Intel | CI builds universal; unit + render tests on an Intel runner if available | One check on an Intel Mac before release |

## 6. Workflow

### Tiers (same as Electron today)

1. **Every change:** `npm run mac:test` (U + R, seconds) plus the native UI suites
   for the area changed, e.g. `npm run mac:e2e -- annotate textedit`. The README
   table of "code you changed → suites" gets a native column with the same suite names.
2. **Could affect other features:** run those suites or add them to the backlog:
   `npm run test:backlog -- add mac-history "changed the history store"`.
   `npm run mac:e2e:backlog` runs the native items.
3. **Full run:** `npm run mac:e2e` (all UI suites) + `npm run mac:parity` (visual
   diff against Electron) on demand and always before a native release. A full pass
   clears the `mac-` backlog items.

### Commands

Run from the repository root (each builds what it needs):

| Command | Runs |
|---|---|
| `cd mac && swift test` | Unit tests (`mac/Tests/SnapkitCoreTests`, Swift Testing) |
| `node mac/e2e/run.mjs [suite…]` | Flow checks, all or named suites; prints a label per check. Capture mode really opens on screen while it runs |
| `node e2e/scene.mjs fixtures/scenes <dir>` | Electron scene renders (after `npm run build`) |
| `node mac/e2e/scene.mjs fixtures/scenes <dir> --compare <electron-dir>` | Native scene renders, diffed against Electron's: `<dir>/compare/` |
| `node mac/scripts/parity-coverage.mjs` | Every Electron check mapped (§2) |

### CI (GitHub Actions)

- Job `mac-native` on `macos-15` (and `macos-14` for the minimum version) for PRs
  touching `mac/`, `fixtures/` or `src/shared/`: `mac:test`, `mac:e2e`,
  `parity-coverage`. The Electron `test` job keeps running vitest on the fixtures.
- **Screen Recording on CI:** hosted runners don't grant it to our app, and
  granting it means editing the system TCC database, which depends on the runner
  image. So CI never needs it: test mode replaces the screen grab, and real capture
  runs only in `mac:real` locally. (Phase 0 checks whether the runner image allows
  a TCC grant; if it does, `mac:real` can move to a nightly CI job.)
- Global hotkeys: also not exercised on CI (test hook instead); real hotkeys are in `mac:real`.
- `mac:parity` needs both apps and a stable display; it runs locally at first. Once
  stable, a nightly CI job on a fixed runner image, with the report as an artifact.
- Artifacts on failure: xcresult bundle, logs, failing scene PNGs.

### Gate for replacing Electron on Mac

Native replaces the Electron Mac app only when all of these are true:

1. `mac:all` passes (U, R, UI, parity with no unapproved diffs).
2. `parity-coverage` reports every Electron check ported or N/A with a reason.
3. `mac:real` passes on a real Mac (macOS 14 and the newest).
4. A 24 h soak passed on the current overlay code.
5. The manual checklist is ticked.
6. Migration check: a copy of real `~/Library/Application Support/Snapkit`
   (settings, history with drawings and backgrounds, last area) opens in native
   with nothing lost, and Electron can still read it afterwards.
7. A period of daily use as the only Mac Snapkit with no overlay failures in the
   logs (length decided later).

Later releases add the release checks (signing identity unchanged, Sparkle
signature valid) when release work is planned.

## 7. Effort and order, by milestone

Phases as in [native-mac-plan.md §7](native-mac-plan.md).

| Phase | Tests built alongside | Extra effort |
|---|---|---|
| 0. Baseline | `fixtures/` folder; move vitest cases into JSON; `extract-ui-tokens.mjs`; Electron `timing.mjs` baseline numbers; `parity-coverage.mjs` (all rows failing at first); CI job skeleton; test mode skeleton (fixed screen, profile dir) | 3–4 days |
| 1. MVP | U: settings, accelerators, naming, layout, last area. UI: `safety` (all), `hotkeys` (most), basic `annotate`. R: frames, pen/arrow/rect/text. `OverlayPoolTests`, `PerfTests`. First scenes: overlay states. Manual Spaces/full-screen check | ~1 week |
| 2. Editor parity | U: annotation model, colour, snap. UI: `annotate`, `textedit`, `snap`, `ruler`, `regressions` (editor parts). R: every shape and style. Scenes: every tool + style bar, all themes. `keys.json` behaviour table | ~1.5 weeks |
| 3. Around the capture | UI: `pin`, `lastarea`, `fullscreen` (capture parts), `ocr`, `compress`. R: compression, clipboard bytes. Scenes: preview, pins, OCR panel | ~1 week |
| 4. Background + history | U: history store, `CaptureDoc` round trip (both directions with Electron entries). UI: `history`, rest of `fullscreen`, background parts of `annotate`/`regressions`. Scenes: background editor, history | ~1 week |
| 5. Settings + polish | UI: `settings` (all 32). `PermissionTests`, `UpdateTests`. Scenes: all Settings sections. Token tests for every view. Manual checklist written. First soak | ~1 week |
| 6. Ready to replace Electron | Replacement gate, `mac:real` on macOS 14/15/26, Intel check, full manual pass, migration check | 2–3 days |

Testing adds roughly 6–7 weeks to the 3–4 months of the plan, spread across the
phases, not at the end. Parity coverage starts at 0 of ~150 checks and should reach
all of them by the end of Phase 5.

## 8. Open questions

1. Electron test hooks: OK to add a test-only scene loader (`SNAPKIT_SCENE`) and
   fixed test screen to the Electron app, needed for side-by-side screenshots?
2. Pixel-diff dependency: pixelmatch (ISC) as a dev dependency, or write our own?
3. Should Electron's CSS later read the shared `ui-tokens.json` too (one source),
   or stay the source the JSON is extracted from?
4. How long must native be used daily without overlay failures before it replaces Electron? (Later.)
5. Is a 24 h soak per release realistic, or once per change to the overlay code?
