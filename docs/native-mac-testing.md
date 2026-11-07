# Native macOS Snapkit: testing plan

Status: proposal, goes with [native-mac-plan.md](native-mac-plan.md). No test code yet.

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
| Version compare, release picking, ignore `mac-v*` tags | `shared/version.ts` (`version.test.ts`) | `VersionTests` |
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

Every check in `e2e/run-all.mjs` gets a native test with the same label. The
native runner prints the same labels, so a missing one is visible the same way.
Status in the native runner: a check is either **ported**, **N/A with a reason
written here**, or **failing**; there is no "skipped" without a row below.

Layer codes as in §1. "Same" = the native test asserts the same result.

### annotate (21)

| Electron check | Native test | Layer |
|---|---|---|
| Typing into a new text box: Enter adds a line | `AnnotateTests.testEnterAddsLine` | UI |
| Esc while typing ends the text, not the capture | `testEscEndsTextOnly` | UI |
| Moving a text box while typing (snap may nudge a few px) | `testMoveTextWhileTyping` | UI |
| One text style at a time | `testOneTextStyle` + `AnnotationModelTests` | UI, U |
| Typed text size applies | `testTypedTextSize` | UI |
| Readable (white) text on a dark background | `ColorTests.readableText` + `testDarkBackgroundWhiteText` | U, UI |
| Highlighter has its own five colours | `testHighlighterSwatches` | UI |
| A blur area can be clicked and adjusted | `testBlurHitTest` | UI |
| Blur strength down to 0 (no blur) | `RenderTests.blurZero` + `testBlurZero` | R, UI |
| Style bar follows the selected shape | `testStyleBarFollowsSelection` | UI |
| Custom colours from the picker | `testCustomSwatch` | UI |
| Background toggle and its dot | `testBackgroundToggleDot` | UI |
| Solid colour presets (8) | `testSolidSwatches` | UI |
| Fine shadow slider (step 0.01) | `testShadowSliderStep` | UI |
| Arrow right-click menu (Arrow, Two-way arrow) | `testArrowVariantsMenu` | UI |
| Two-way arrow draws a head at each end | `RenderTests.twoWayArrow` | R |
| Colour picker not clipped | `testPickerVisible` + visual scene `picker-edge` | UI, V |
| Esc while typing in the editor stays in the editor | `testEditorEscWhileTyping` | UI |
| Esc closes the editor only | `testEditorEscClosesEditorOnly` | UI |
| Fixed output size (16:9) | `RenderTests.frames` | R |
| No page errors | `NoErrorsTests`: no log line at error level during the suite | UI |

### regressions (13)

| Electron check | Native test | Layer |
|---|---|---|
| Esc with the colour picker open only closes the picker | `RegressionTests.testEscClosesPickerOnly` | UI |
| Text background style doesn't recolour other tools | `testTextStyleKeepsShapeColor` + `AnnotationModelTests` | UI, U |
| Editor opened from the preview shows the image | `testEditFromPreviewShowsImage` | UI |
| Ctrl/⌘ + scroll zooms around the pointer, drawings sharp | `testEditorZoomAroundPointer` + visual scene `editor-zoom-2x` | UI, V |
| Space + drag pans the zoomed editor, draws nothing | `testSpacePans` | UI |
| Trackpad pinch zooms in | `testPinchZoom` (synthesized magnify event) | UI |
| Ctrl/⌘ + 0 fits again, still in editor | `testZeroFits` | UI |
| Quick area capture copies the drawn area | `testQuickCopy` | UI |
| Quick area capture ignores a click | `testQuickCopyIgnoresClick` | UI |
| Quick capture off: drawing keeps capture mode open | `testQuickCopyOff` | UI |
| Thin themed scrollbars without a track | N/A as written: native uses system overlay scrollers. Covered by visual scenes `history`, `settings-*` | V |
| Editor tools fit a small screen | `testEditorToolsFitSmallScreen` (test screen 1280×720) | UI |
| No page errors | `NoErrorsTests` | UI |

### compress (6)

| Electron check | Native test | Layer |
|---|---|---|
| Copies are smaller PNGs, exact bytes on the clipboard, full size | `CompressTests.standard` + `testCopyExactBytes` | R, UI |
| Editor Compress switch follows the setting, shows the size | `testCompressSwitchDefault` | UI |
| Compress switch turns off, chips hidden | `testCompressSwitchOff` | UI |
| Copy with Compress off is the original | `testCopyUncompressed` | UI |
| Smallest brings HiDPI captures to 1× | `CompressTests.smallest` | R |
| No page errors | `NoErrorsTests` | UI |

### lastarea (7)

| Electron check | Native test | Layer |
|---|---|---|
| Nothing remembered: a normal capture | `LastAreaUITests.testFirstUse` | UI |
| Reopens the last copied area, toolbar shown | `testReopensArea` | UI |
| A cancelled capture is not remembered | `testCancelNotRemembered` | UI |
| After full screen it selects the whole screen | `testAfterFullScreen` | UI |
| Copy right away: no capture mode, copies the area | `testInstantCopy` | UI |
| Survives a restart | `testRememberedAfterRestart` (relaunch with same profile) | UI |
| No page errors | `NoErrorsTests` | UI |

### ruler (5)

| Electron check | Native test | Layer |
|---|---|---|
| Off by default | `SettingsTests.defaults` + `testRulerHidden` | U, UI |
| Right after Blur in the toolbar | `SettingsTests.toolbarOrder` | U |
| Measures in image pixels | `AnnotationModelTests.rulerLabel` + `testRulerLabel` | U, UI |
| Dragging an end updates the length | `testRulerDragEnd` | UI |
| No page errors | `NoErrorsTests` | UI |

### ocr (8)

| Electron check | Native test | Layer |
|---|---|---|
| Reads English and Vietnamese into the text panel | `OCRTests.testPanelText` (fixture image) | UI |
| The lines found are outlined | `testLinesOutlined` | UI |
| One line + Copy text copies and closes | `testCopyOneLine` | UI |
| Capture text opens the panel (hint, toolbars hidden, copies, closes) | `testCaptureTextPanel` | UI |
| Copy right away, with a message | `testCaptureTextCopyNow` | UI |
| An area without text says "No text found" | `testEmptyArea` | UI |
| The floating preview copies its text | `testPreviewCopyText` | UI |
| No page errors | `NoErrorsTests` | UI |
| (Electron skips OCR on its scaled CI run) | Native runs it at scale 1 and 2 test screens | UI |

### textedit (4)

| Electron check | Native test | Layer |
|---|---|---|
| Click into selected text to edit it (caret at end) | `TextEditTests.testClickSelectedText` | UI |
| Edits are kept | `testEditsKept` | UI |
| Click into text with the Text tool | `testClickWithTextTool` | UI |
| Dragging text moves it without editing | `testDragMoves` | UI |

### snap (6)

| Electron check | Native test | Layer |
|---|---|---|
| Smart align, no tool (guides shown) | `SnapTests.testUnselectedDrag` + `AnnotationModelTests.snapBox` | UI, U |
| Smart align, selected shape | `testSelectedDrag` | UI |
| Smart align with a drawing tool active | `testToolActiveDrag` | UI |
| Smart align in the editor | `testEditorDrag` | UI |
| Smart align while typing text | `testDragWhileTyping` | UI |
| Smart align while typing text in the editor | `testEditorDragWhileTyping` | UI |
| (Electron e2e: ⌘ places freely) | `testCommandPlacesFreely` (new, from `snap.mjs` description) | UI |

### pin (10; one is Windows-only)

| Electron check | Native test | Layer |
|---|---|---|
| Floating preview toggle and its dot | `PinTests.testPreviewToggle` | UI |
| Preview after ⌘C in the bottom-right corner | `testPreviewCorner` | UI |
| Windows: preview stays on top of the app you go back to | N/A (Windows only). Mac equivalent: `testPreviewAboveFrontApp` | UI |
| Copy again from the preview | `testCopyFromPreview` | UI |
| Edit restores drawings | `testEditRestoresDrawings` | UI |
| Done keeps the preview | `testDoneKeepsPreview` | UI |
| Movable preview (moved by −120, −80) | `testMovePreview` | UI |
| Pin from the preview, preview closes | `testPinFromPreview` | UI |
| No preview when off for this capture; pin still visible | `testPreviewOffPerCapture` | UI |
| Closing pins | `testClosePins` | UI |

### history (7)

| Electron check | Native test | Layer |
|---|---|---|
| Limit prunes old captures (5 kept, 5 folders) | `HistoryStoreTests.prune` + `HistoryUITests.testLimit` | U, UI |
| Panel opens with 5 cards | `testPanelOpens` | UI |
| Starring | `testStar` | UI |
| Enter copies (size per scale), panel closes | `testEnterCopies` | UI |
| Editing updates the same entry | `testEditUpdatesEntry` | UI |
| Delete removes files | `testDelete` | UI |
| Clear keeps starred | `testClearKeepStarred` | UI |

### fullscreen (12)

| Electron check | Native test | Layer |
|---|---|---|
| Goes straight to the preview, no overlay | `FullScreenTests.testStraightToPreview` | UI |
| Can copy | `testCopies` | UI |
| Edit a full-screen capture | `testEdit` | UI |
| Resizable history window remembers its size | `testHistoryWindowSize` | UI |
| History keeps 10 by default | `SettingsTests.defaults` | U |
| History close button: macOS uses its own (none of ours) | `testHistoryNoCustomClose` | UI |
| Labelled Clear History button | `testClearButtonLabel` | UI |
| Drag a capture out of history (`Snapkit <date>.png`) | `testDragOutFileName` (drag source file promise name) | UI |
| Clear, keep starred | `testClearKeepStarred` | UI |
| Clear all asks twice ("Click again to delete all") | `testClearAllConfirm` | UI |
| Clear all | `testClearAll` | UI |
| Background on by default applies to copy, preview and history | `testDefaultBackground` + `RenderTests.fullScreenBackground` | UI, R |

### hotkeys (9; one is Windows-only)

| Electron check | Native test | Layer |
|---|---|---|
| Default shortcuts registered | `HotkeyTests.testDefaults` (registration status from the wrapper) | UI |
| ⌘⇧Z steps aside while capturing | `testStepAside` | UI |
| Selection outline width 1.5 px | `UITokenTests.selectionOutline` + visual scene `overlay-select` | U, V |
| ⌘⇧Z registered again after capture | `testStepBack` | UI |
| Gray theme in every window | visual scenes `*-gray` + `testGrayEverywhere` | V, UI |
| No glass knob with Liquid Glass off (22 px solid) | `UITokenTests.switchKnob` + visual scene | U, V |
| Glass knob with Liquid Glass on | same, glass variant | U, V |
| Takes a shortcut back once the app holding it quits | `testRetakeShortcut` (helper process holds it) | UI |
| Windows: notices a shortcut another app holds | N/A (Windows only; macOS lets both register) | — |

### safety (11, including 3 macOS-only)

| Electron check | Native test | Layer |
|---|---|---|
| Capture hotkey again closes capture mode | `SafetyTests.testHotkeyToggles` | UI |
| Idle timeout | `testIdleCloses` (short limit via launch argument) | UI |
| A stuck overlay never leaves the screen dimmed | `testStuckOverlayNoDim` (test hook blocks the main view's draw) | UI |
| Capture works after a stuck one | `testCaptureAfterStuck` | UI |
| No listener leak over many captures | `testNoLeakOver100Captures` (window and observer counts) | UI |
| Display change during capture: kept open, rebuilt after | `testDisplayChangeDeferred` (simulated screen-change notification) | UI |
| macOS: a capture window that never showed is replaced | `testUnseenPanelReplaced` (watchdog with a forced not-on-screen panel) | UI |
| macOS: capture works after replacing it | `testCaptureAfterReplace` | UI |
| macOS: a seen capture closed by the hotkey keeps its windows | `testSeenCaptureKeepsPanels` | UI |
| History record switch pauses history | `testRecordSwitch` | UI |
| History folder button leaves no stuck dim | `testFolderButtonNoDim` | UI |

### settings (32)

| Electron check | Native test | Layer |
|---|---|---|
| General groups: Startup, After a capture, Saving | `SettingsUITests.testGeneralGroups` | UI |
| Quick area capture switch, off by default | `testQuickCaptureSwitch` | UI |
| Saving rows in order | `testSavingRows` | UI |
| Defaults: 75% dim, Dark | `SettingsTests.defaults` | U |
| History keeps 10, up to 30 | `testHistorySlider` | UI |
| History Recording switch on by default | `testHistoryRecordingSwitch` | UI |
| Short shortcut names, no descriptions | `testShortcutRowNames` | UI |
| Dock icon only while Settings is open | `testDockIcon` (activation policy) | UI |
| Open Settings shortcut | `testSettingsHotkey` | UI |
| Blue switches | `UITokenTests.switchOn` + visual | U, V |
| File naming preview "Example: Bug 001.png" | `testNamePreview` | UI |
| Recording a hotkey saves `CommandOrControl+Alt+Shift+F11` | `testRecordHotkey` + `AcceleratorTests` | UI, U |
| Tool letters saved | `testToolLetter` | UI |
| Theme mode saved | `testThemeMode` | UI |
| Readable dropdown options in dark theme | N/A as written (native pop-up menus are system-drawn). Visual scene `settings-dark` covers it | V |
| Dim colour setting (black by default) | `testDimColor` | UI |
| Dim amount in 1% steps | `testDimStep` | UI |
| Capture mode dims in the chosen colour | `testDimApplied` + visual scene | UI, V |
| Liquid Glass toggle | `testGlassToggle` | UI |
| Theme reaches windows already open | `testThemeLive` | UI |
| No separate Line / Ellipse rows (Arrows 2, Shapes 5) | `testToolGroups` | UI |
| Quick colours saved | `testPalette` | UI |
| Step colour saved | `testStepColor` | UI |
| Remember last background toggles off | `testRememberLast` | UI |
| Step outline/shadow defaults and saved | `testStepOutline` | UI |
| Step badges use those settings | `RenderTests.stepBadge` | R |
| Gradient library reset (32) | `testGradientsReset` | UI |
| Settings reach capture mode (W selects arrow) | `testSettingsReachCapture` | UI |
| Numbered file names, next number 3 | `testNumberedSaves` | UI |
| Update check (needs internet) | `UpdateTests` against a local fixture feed; live check in `RealCapture` plan | U, UI |
| Reset one section | `testResetSection` | UI |
| No page errors | `NoErrorsTests` | UI |

### Not in `run-all.mjs`

| Electron script | Native |
|---|---|
| `winkeep.mjs` (3 checks, Windows only) | N/A: no Mac equivalent; Mac panels are hidden between captures |
| `timing.mjs` (hotkey → dim → frozen image) | `PerfTests` (§4), same three timings |
| `smoke.mjs` (Linux/Xvfb) | N/A: no Linux build |
| `backlog.mjs` | Reused as is, with native suite names prefixed `mac-` (§6) |

New native-only checks (no Electron equivalent): pool rebuild on Space change and
wake, panel ignores the mouse while idle, signing identity unchanged between
releases, `mac-v*` tags ignored by Electron's update check.

A script, `scripts/parity-coverage.mjs`, reads `SUITES` from `e2e/run-all.mjs`
and the native test list (`xcodebuild test -enumerate-tests` output), and fails
if any Electron label has no native test and no N/A row in this file. That's the
guard against dropping a check silently, including checks added to Electron later.

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

A **scene** is a JSON file: test screen, selection rect, settings overrides, shapes,
open tool/menu, window to capture. Both apps load a scene in test mode and save a
PNG of the named window:

- Electron: `SNAPKIT_SCENE=<file>` env var read in test builds; Playwright
  `page.screenshot()` of the window.
- Native: `-SnapkitScene <file>`; the window's content view rendered with
  `cacheDisplay(in:to:)`, or `XCUIScreenshot` of the element.

Scenes (first set, each in light, dark, gray, and glass where it applies):

- Overlay: dim only; selection with size label; toolbars below/above/inside/side
  of the selection (one per `placeToolbars` case); each tool active with its style
  bar; arrow variants menu; colour picker open (and near a screen edge); text
  being typed in each text style; a step badge set; blur and pixelate; ruler.
- Background editor: each preset, gradient/solid/image, each frame, zoom 2×.
- OCR text panel with lines outlined.
- Floating preview stack (1 and 3), pin at 100% and 50% opacity, pin menu.
- History panel (empty, 5 entries, a starred one, clear confirm).
- Settings: each of the 7 sections.

**Diff:** `scripts/parity-diff.mjs` compares the two PNGs per scene with a
perceptual metric (pixelmatch with anti-aliasing detection, plus SSIM) and writes
an HTML report with Electron | native | diff side by side. Thresholds per kind:

| Region | Threshold |
|---|---|
| Rendered output (the image you copy) | ≤ 0.5% pixels differ, SSIM ≥ 0.99 |
| Overlay chrome (toolbars, style bar, dim, selection) | ≤ 2%, SSIM ≥ 0.97 |
| Settings, History (system controls, fonts differ slightly) | ≤ 5%, SSIM ≥ 0.93, plus layout tokens (below) |

**Reviewed baselines:** an intentional difference (e.g. native pop-up menus) is
approved once: the native PNG goes to `fixtures/scenes/baseline/` with a note in
`fixtures/scenes/approved.md`, and later runs compare native against that baseline
instead of Electron. Unapproved differences fail.

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

Run on a real Mac before each native beta, with the Electron app open beside it.
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

npm scripts in the root `package.json`, wrapping `xcodebuild` with test plans
(`mac/TestPlans/*.xctestplan`):

| Command | Runs |
|---|---|
| `npm run mac:test` | Unit + Render test plan |
| `npm run mac:e2e [-- suite…]` | UI test plan, all or named suites; prints the same check labels as `run-all.mjs` |
| `npm run mac:parity` | Builds both apps, renders every scene in both, diffs, opens the HTML report |
| `npm run mac:real` | `RealCapture` plan: real ScreenCaptureKit, real hotkeys, live update check |
| `npm run mac:soak` | Starts the 24 h soak script |
| `npm run mac:all` | All of the above except soak, then `parity-coverage` |

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

### Release gate for a native beta

A `mac-v*` tag only ships when all of these are true:

1. `mac:all` passes on the release commit (U, R, UI, parity with no unapproved diffs).
2. `parity-coverage` reports every Electron check ported or N/A with a reason.
3. `mac:real` passes on a real Mac (macOS 14 and the newest).
4. The latest soak run (≤ 7 days old, same overlay code) passed.
5. Manual checklist ticked for this version.
6. Signing identity matches the previous release (designated requirement check).
7. Electron's update check ignores the new tag (unit test in Electron).

For native to move from beta to stable later: everything above, plus no open
"parity" issues and a period of beta use with no overlay failures in logs
(length **Open**).

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
| 6. Beta release | Release gate in CI, `mac:real` on macOS 14/15/26, Intel check, full manual pass | 2–3 days |

Testing adds roughly 6–7 weeks to the 3–4 months of the plan, spread across the
phases, not at the end. Parity coverage starts at 0 of ~150 checks and should reach
all of them by the end of Phase 5.

## 8. Open questions

1. Electron test hooks: OK to add a test-only scene loader (`SNAPKIT_SCENE`) and
   fixed test screen to the Electron app, needed for side-by-side screenshots?
2. Pixel-diff dependency: pixelmatch (ISC) as a dev dependency, or write our own?
3. Should Electron's CSS later read the shared `ui-tokens.json` too (one source),
   or stay the source the JSON is extracted from?
4. How long must the native beta run without overlay failures before it can be called stable?
5. Is a 24 h soak per release realistic, or once per change to the overlay code?
