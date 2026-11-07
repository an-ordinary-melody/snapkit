# Native macOS Snapkit: plan

Status: proposal. No app code yet. Decisions marked **Open** are for Son.

A Swift rewrite of the macOS app (AppKit + some SwiftUI, ScreenCaptureKit, Vision),
matching what the Electron app does today (v0.2.0-beta.14) and reading its data,
so people can switch without losing settings or history.

## 1. Why native

The Electron app works, but most of the recent Mac fixes are workarounds for
running a web page as a capture overlay:

| Problem today | Where | Native |
|---|---|---|
| Capture window stops reaching the screen after days; hotkey "does nothing" | `overlay.ts` (replace windows on a quick second press, hourly rebuild) | An `NSPanel` we own: level, collection behavior and ordering are set directly, no Chromium compositor in between. |
| Window stops counting as "on every Space"; macOS slides to another Space | `watchSpaces()` (replace windows and reopen) | `.canJoinAllSpaces` + `.fullScreenAuxiliary` on a non-activating panel, re-applied each show. Known, documented pattern (used by CleanShot, Shottr). |
| Two-step open (`arm` dim, then `pixels` transfer) so the dim shows fast | `ipc.ts`, `Overlay.tsx` | The frozen frame is an `IOSurface`/`CGImage` handed straight to a layer. No copy into a renderer. |
| Hotkey path must stay synchronous or capture stalls until the next mouse move | `index.ts` | Carbon hotkey callback runs on the main run loop; no promise scheduling. |
| App Nap made idle captures slow | `LSAppNapIsDisabled` | Same flag, plus no helper processes to wake. |
| Focus not returned to the previous app | `releaseFocus()` | Non-activating panel never takes app activation in the first place. |

Other gains:

- **Size.** Installed app is ~282 MB, DMG ~76 MB. A Swift app of this scope is
  typically 5–15 MB installed, a DMG/zip of a few MB.
- **Launch and first capture.** No Chromium start, no preloaded hidden renderers
  per display. Expect launch well under a second and hotkey-to-dim in one frame.
  (Phase 0 measures the Electron baseline with `e2e/timing.mjs` so we compare real numbers.)
- **Memory.** Electron runs a main process, a GPU process and a renderer per
  display/panel. A native menu-bar app idles in tens of MB. Measure in Phase 0.
- **Signing.** One Swift binary plus one bundle is easy to sign and notarize;
  no Electron fuses, no ad-hoc signing in `after-pack.cjs`, no helper `snapkit-ocr`
  executable (Vision runs in-process).
- **Platform features for free:** ScreenCaptureKit window/display exclusion,
  `NSSharingService`, Quick Look drag, system text rendering, VoiceOver.

Costs: a second codebase for the Mac (Windows stays Electron, see §4), and a
full rewrite of the annotation editor and Settings UI, which is most of the work.

## 2. Architecture

### App structure

- Swift Package–based Xcode project in `mac/` (new top-level folder), one app target,
  one `SnapkitCore` package for logic that can be unit tested without UI.
- `LSUIElement = YES` (menu-bar app). Dock icon only while Settings is open,
  via `NSApp.setActivationPolicy(.regular/.accessory)`, as today.
- Minimum macOS: **Open** (see §8). ScreenCaptureKit's `SCScreenshotManager`
  needs macOS 14; the current app supports older.
- Single instance: `NSRunningApplication` check + a URL scheme or
  `NSDistributedNotificationCenter` for `--history`, `--fullscreen`, `--last-area`, `--text`.

```
mac/
  Snapkit.xcodeproj
  Snapkit/                 App target: AppDelegate, menu bar, windows
    Capture/               CaptureController, OverlayPanel, SelectionView
    Editor/                Canvas, tools, style bar, background editor
    Pin/                   PinPanel, PreviewPanel (floating preview)
    History/               HistoryPanel
    Settings/              SwiftUI settings window
  Packages/SnapkitCore/    Settings model + JSON, history store, naming, prune rules,
                           annotation model + geometry, beautify layout, compress
  SnapkitTests/ SnapkitUITests/
```

### Capture overlay

- One `NSPanel` subclass per display, created at launch and on
  `NSApplication.didChangeScreenParametersNotification`.
  - `styleMask: [.borderless, .nonactivatingPanel]`, `level: .screenSaver`
    (or `CGShieldingWindowLevel()`), `collectionBehavior: [.canJoinAllSpaces,
    .fullScreenAuxiliary, .stationary, .ignoresCycle]`, `hidesOnDeactivate = false`.
  - `canBecomeKey = true` so it gets keys (Esc, ⌘C, tool letters) without
    activating Snapkit; focus returns to the previous app automatically on close.
  - Shown with `orderFrontRegardless()`; hidden with `orderOut`. No opacity tricks.
- Content: a layer-backed view. Bottom layer: the frozen screen (`CALayer.contents = CGImage`).
  Above it: dim layer with a hole (`CAShapeLayer` even-odd path), selection
  outline, size label, toolbars (AppKit views), and the annotation canvas.
- Keep the Electron safeguards that still make sense: hotkey again closes capture
  mode, 3-minute idle close, and a log line per open/close. Drop the Space/rebuild
  workarounds unless testing shows they're still needed.

### Screen grabbing: ScreenCaptureKit vs CGWindowList

| | ScreenCaptureKit (`SCScreenshotManager`) | `CGWindowListCreateImage` / `CGDisplayCreateImage` |
|---|---|---|
| Status | Current API | Deprecated in macOS 14, warns at runtime in 15+ |
| Speed | ~20–60 ms per display, async | Fast, sync |
| Exclude own windows (pins, preview) | Yes, `SCContentFilter(excludingWindows:)` | No |
| Window list for window-pick (future) | `SCShareableContent` | `CGWindowListCopyWindowInfo` |
| Permission | Screen Recording; macOS 15 shows a periodic re-confirm prompt for some apps | Same permission |

Plan: **ScreenCaptureKit** for display grabs, with `SCShareableContent` fetched once
at launch and refreshed on screen changes so a capture doesn't wait on it.
Grab all displays in parallel, show the dim on the display under the cursor
first. Keep a `CaptureEngine` protocol like `src/main/capture/` so a CGDisplay
fallback can be added for older macOS if we support it.

### Global hotkeys

- Carbon `RegisterEventHotKey` (still the only public API for system-wide
  hotkeys without Accessibility permission). Wrap it ourselves or use
  [KeyboardShortcuts](https://github.com/sindresorhus/KeyboardShortcuts) (MIT),
  which also gives a SwiftUI recorder view. **Open:** dependency or own wrapper.
- Translate Electron accelerators (`Alt+Shift+Z`, `CommandOrControl+Shift+1`)
  to key code + modifiers when reading `settings.json`, and write them back in the
  same format so the file stays compatible.
- Keep: retry hotkeys held by another app every few seconds; step aside while
  capturing when a hotkey is also a capture-mode key (⌘⇧Z = Redo).

### Menu bar

`NSStatusItem` with an `NSMenu` mirroring `tray.ts`: Capture Area / Last Area /
Full Screen / Text, History…, Record History, Open Screenshots Folder, Close All
Pins, Settings…, update item or version, Quit. Shortcuts shown from settings.

### Annotation canvas: Core Graphics vs SwiftUI Canvas

| | Custom `NSView` + Core Graphics / Core Animation | SwiftUI `Canvas` |
|---|---|---|
| Hit testing, drag handles, selection | Full control | Manual anyway; gesture system fights fine-grained mouse handling |
| Text editing in place | `NSTextView` overlay, mature | `TextField` overlay, weaker (no stroke/outline styles) |
| Blur / pixelate | Core Image (`CIGaussianBlur`, `CIPixellate`) on the region | Same, but redraws whole canvas each change |
| Export at image scale | Same drawing code into a `CGContext` at any scale | `ImageRenderer`, less control over scale/color space |
| Right-click menus, modifier keys (Shift 45°, ⌘ free place) | Native | Awkward |

Plan: **AppKit `NSView` with Core Graphics**, one `draw(shape, in: CGContext, scale:)`
function used both on screen and for export, so output matches what you see.
Shapes are value types in `SnapkitCore` mirroring `annotate/model.ts`
(pen, highlighter, line, arrow + open/two-way heads, rect/ellipse filled or not,
text with plain/stroke/background + shadow, numbered steps, blur/pixelate, ruler),
plus undo/redo, smart snap (`snapBox`), Shift snapping, move/resize, select and
restyle. Toolbars and the style bar can be SwiftUI views hosted in the panel
(`NSHostingView`); the canvas itself stays AppKit.

### Beautify (background)

Core Graphics: gradient/solid/image fill, rounded-rect clip, shadow, frames
(auto, ratios, exact size). Port `beautify/layout.ts` to Swift as pure geometry
with the same tests, so outputs match pixel-for-pixel within rounding.

### OCR

Vision `VNRecognizeTextRequest` in-process (same settings as `native/ocr-mac/main.swift`:
accurate, language correction, `vi-VT` + `en-US`). Returns lines with boxes for
the text panel. Removes the helper binary and Tesseract entirely on Mac.
Optional later: Live Text (`ImageAnalyzer`) for selecting text in pins.

### Output

- Clipboard: write the exact PNG bytes as `public.png` (keeps compressed PNGs
  small, as `clipboardPng.ts` does) plus a TIFF/`NSImage` for apps that want it.
- Save: `NSSavePanel` starting in the last folder, or straight to the folder,
  with the same naming rule (`naming.ts`) and `nextNumber`.
- Compress: 256-color quantization. Options: libimagequant (GPL/commercial,
  licence conflict with MIT), a small Swift/C median-cut quantizer, or
  ImageIO's PNG with reduced depth. **Open:** which; see §8.
- Notifications: `UNUserNotificationCenter` on copy/save per settings.

### Floating preview and pins

`NSPanel` (non-activating, floating level, all Spaces) with an image view:
zoom (scroll / menu 50–200%), opacity, drag to move, drag out as a file
(`NSDraggingSource` with a file promise or temp PNG named like a capture), copy,
copy text, save, edit (reopens the editor with the `CaptureDoc`), close / close all.
Previews stack bottom-right per display.

### History

Same folder layout and files as `docs/history.md`, read and written by a
`HistoryStore` actor in `SnapkitCore`: `index.json` + per-entry `final.png`,
`source.png`, `doc.json`, `thumb.jpg`; atomic `.tmp` folder then rename; same
prune rules (`toPrune`) and startup tidy-up. Panel: an `NSPanel` with a SwiftUI
`LazyVGrid` of thumbnails and the same keys (arrows, Enter, E, P, S, F, Delete, Esc).

### Settings

- Model: a `Codable` `Settings` struct with the same field names as `settings.ts`,
  defaults in Swift, and the same storage rule: **only changed values are written**
  (deep-merge on read, patch on write), atomic write, 100 ms debounce.
- UI: SwiftUI window with the same sections (General, Shortcuts, Appearance,
  Toolbar, Tools, Background, About), `NavigationSplitView` sidebar.
- Launch at login: `SMAppService.mainApp`.
- Appearance: the custom Liquid Glass / Gray / accent themes map to
  `NSVisualEffectView` / `.glassEffect` (macOS 26) and system light/dark.
  **Open:** keep Gray and custom accent, or follow the system.

## 3. Feature parity

Difficulty: S = days, M = about a week, L = several weeks (one developer, part-time AI-assisted pace is faster but uneven).

| Feature (Electron) | Native approach | Difficulty |
|---|---|---|
| Area capture: dim, drag, resize handles, arrow-key nudge, size label | Overlay `NSPanel` + selection view | M |
| Multiple displays, mixed Retina | Panel per `NSScreen`, SCK grab per display | M |
| Capture over full-screen apps / all Spaces | Panel collection behavior | S (to build), M (to verify) |
| Quick area capture (copy on release) | Flag in capture controller | S |
| Full-screen capture → floating preview, optional copy | SCK grab, no overlay | S |
| Capture last area (`last-area.json`), instant or preselected | Read/write same file | S |
| Capture text (OCR hotkey), text panel or copy right away | Vision + SwiftUI panel | M |
| Copy (exact PNG bytes), Save (dialog / folder, naming rule, numbering) | `NSPasteboard`, `NSSavePanel` | S |
| Compress (standard / smallest, apply to copy/save/both, editor switch, size estimate) | Quantizer + ImageIO | M |
| Tools: pencil, highlighter (Shift straight) | Core Graphics paths | M |
| Arrow (filled/open, two-way, Shift 45°), line, rect/ellipse (filled), Shift square | Core Graphics | M |
| Text (plain / outline / background, shadow, fonts, edit existing, move) | `NSTextView` overlay + CG text drawing | L |
| Numbered steps (auto numbers, stroke, shadow, text color) | CG | S |
| Blur / pixelate (strength 0–40) | Core Image on region | S |
| Ruler (px length in image pixels) | CG | S |
| Select, move, resize, restyle shapes; smart snap; ⌘ to place freely | Canvas hit testing + port of `snapBox` | L |
| Undo / redo, color picker, palettes, stroke S/M/L | Undo stack in model; `NSColorPanel` or custom picker | M |
| Tool letter keys, tool variants (right-click), toolbar order/enable | Driven by a Swift copy of `features.ts` | M |
| Background editor: presets, gradients/solids/image, padding, radius, shadow, frames, zoom, random | CG renderer + SwiftUI editor | L |
| Remember last background; background on by default (also full-screen) | Settings | S |
| Floating preview after copy (copy/edit/pin, corner stack) | `NSPanel` | M |
| Pins: zoom, opacity, move, drag out, copy, copy text, save, menu, close all | `NSPanel` + `NSDraggingSource` | M |
| Edit a preview or history entry (`CaptureDoc`) | Editor opens from doc | M |
| History: record, panel, keys, star, delete, clear, pause, limits, drag out, copy text | `HistoryStore` + SwiftUI panel | M |
| Global hotkeys (6), taken-hotkey retry, step aside in capture mode | Carbon / KeyboardShortcuts | M |
| Menu bar menu | `NSStatusItem` | S |
| Settings window, all sections, reset per section, live apply | SwiftUI | L |
| Appearance: light / dark / gray / system, glass, accent | SwiftUI + visual effect views | M |
| Launch at login (incl. "needs approval" state) | `SMAppService` | S |
| Screen Recording permission check and explanation | `CGPreflightScreenCaptureAccess` / `CGRequestScreenCaptureAccess` | S |
| Update check (GitHub releases, notify once per version, betas) | Sparkle, or keep own check (see §6) | S–M |
| Notifications on copy/save | `UNUserNotificationCenter` | S |
| Idle close, hotkey-again close, log file (`~/Library/Logs/Snapkit`) | `os.Logger` + file log | S |
| CLI flags (`--history`, `--fullscreen`, `--last-area`, `--text`) | URL scheme / second-launch arguments | S |
| Capture engine setting (`capture.engine`), OCR engine setting | Mac has one of each; hide or keep as `auto` | S |

Not needed on Mac: Windows-only workarounds (`winkeep`, `noAnimation`, koffi), Tesseract.

## 4. Compatibility and sharing

### Reading existing data

Electron's `userData` on macOS is `~/Library/Application Support/Snapkit`, which
already holds `settings.json`, `last-area.json` and `history/`. The native app
uses **the same folder and the same files**:

- `settings.json`: sparse overrides, merged over defaults. The Swift model must
  tolerate unknown keys (keep them on write, so switching back to Electron loses
  nothing) and type mismatches (fall back to the default, as `mergeSettings` does).
- `history/index.json` + entry folders: same format. `doc.json` holds `shapes`
  and `beautify` as written by the React editor; the Swift decoder reads that
  JSON (coordinates are overlay CSS px = points, `scale` = image px per point),
  and writes the same shape so both apps can reopen each other's entries.
- `last-area.json`: same fields; display ids map via `CGDirectDisplayID`
  (Electron's display id on Mac is the same number) with the bounds fallback.
- Bundle id: keep `com.charios.snapkit` so Login Items, Screen Recording
  permission (TCC) and notifications carry over. Note: TCC ties permission to the
  code signature too, so moving from ad-hoc to Developer ID signing asks for
  Screen Recording once more. That happens with any signing change.
- Electron's Chromium caches in that folder (`Cache`, `GPUCache`, …) are left
  alone; **Open:** offer a one-time cleanup.

Add a `schemaVersion` only if a format must change; until then both apps write
identical files.

### Windows

Windows stays on Electron. A native Windows rewrite is a separate decision
(**Open**), not part of this plan.

### What can be shared

There's no shared runtime between Swift and TypeScript, so sharing is by
**format and tests**, not code:

- `settings.json` / history / `CaptureDoc` formats: one spec. Write a JSON
  Schema (or keep `settings.ts` as the source of truth) and add fixture files in
  `fixtures/` that both the vitest suite and Swift tests load.
- Pure logic ported once, checked against the same fixtures: `mergeSettings`,
  `applyPatch`, `toolbarOrder`, `toPrune`, `fileName`/`uniqueName`, annotation
  geometry (`openArrowHead`, `rulerLabel`, `snapBox`, `snap45`), beautify layout.
  Turning existing vitest cases into JSON fixtures keeps both sides honest.
- `features.ts`: generate a Swift file from it in the build, or keep a
  hand-written copy with a test that compares ids. **Open.**
- Assets: icon (`build/AppIcon.icon`, `Assets.car`), presets and palettes.
- The website (`site/`) and release flow stay shared.

## 5. Milestones

Rough effort, one developer working with an AI assistant. Ranges, not promises.

| Phase | Scope | Effort |
|---|---|---|
| 0. Baseline | Measure Electron (launch, hotkey→dim, memory, size) with `e2e/timing.mjs`; Xcode project in `mac/`; CI builds an empty menu-bar app; port shared fixtures | 2–3 days |
| 1. MVP | Menu bar, capture hotkey, overlay on all displays/Spaces/full screen, area select + handles, copy (exact PNG) and save (naming rule), Esc, pencil/arrow/rect/text basics, undo, reads existing `settings.json` (hotkey, save folder, colors) | 2–3 weeks |
| 2. Editor parity | All tools and variants, select/move/resize/restyle, smart snap, steps, blur, ruler, highlighter, text styles, style bar, toolbar order and tool keys | 3–4 weeks |
| 3. Around the capture | Full-screen and last-area capture, quick copy, floating preview, pins, notifications, compress, OCR (text panel + capture text) | 2–3 weeks |
| 4. Background + history | Background editor and presets, history store + panel, edit from history/preview, shared `doc.json` | 2–3 weeks |
| 5. Settings + polish | Full settings window, appearance themes, launch at login, permissions UX, update check, logging, accessibility | 2–3 weeks |
| 6. Release | Signing/notarization, beta to a few users alongside Electron, migration check on real data, switch the Mac download | 1 week + beta time |

Total: roughly 3–4 months part-time to parity. The MVP is usable on its own for
dogfooding by the end of Phase 1.

## 6. Build, signing, distribution

- **Signing.** Today: ad-hoc signed, unsigned for Gatekeeper (users right-click
  → Open, or `xattr`). Native makes proper signing easy but it needs an Apple
  Developer Program membership ($99/year). With it: Developer ID Application
  certificate, hardened runtime, `notarytool` + stapling in CI. Without it: keep
  ad-hoc signing; the app still runs, with the same Gatekeeper friction as now.
  **Open.**
- **Packaging.** Zip or DMG of `Snapkit.app`. Universal (arm64 + x86_64) is a
  build flag in Xcode, which also settles the pending Intel build. **Open:** Intel.
- **Updates.** Options:
  1. Keep today's notify-and-download check against GitHub releases (port of `system.ts`).
  2. [Sparkle 2](https://sparkle-project.org) (MIT): in-app download and install,
     EdDSA-signed appcast. Works best with Developer ID signing; the appcast can
     be generated in CI and hosted on GitHub Pages or the site.
  **Open.**
- **CI.** GitHub Actions `macos-15` (or newer) runner: `xcodebuild test` for
  `SnapkitCore` and UI tests, `xcodebuild archive`, sign/notarize when secrets
  exist, upload the artifact; on `v*` tags attach to the release next to the
  Windows Electron installer. Secrets (certificate `.p12`, its password,
  App Store Connect API key for notarytool, Sparkle private key) live only in
  GitHub Actions secrets, never in the repo.
- **Local.** `scripts/update-mac.sh --local` gets a native variant that runs
  `xcodebuild` and installs to `/Applications`.
- **Release names.** Mac and Windows versions can share numbers; the Mac
  artifact name changes (e.g. `Snapkit-0.3.0-mac-universal.zip`).

## 7. Testing

The Playwright e2e suites drive Chromium pages; they won't run against an AppKit
app. Replacement, in layers:

1. **Unit (XCTest / Swift Testing) on `SnapkitCore`.** Settings merge/patch,
   history prune and tidy-up, naming, annotation geometry, beautify layout,
   compress, accelerator parsing. Shared JSON fixtures with the vitest suite.
2. **Render tests.** Draw a fixed `CaptureDoc` (one of each shape, each
   background) to PNG and compare with reference images within a tolerance.
   Covers what `annotate.mjs`, `ruler.mjs`, `fullscreen.mjs` check visually.
3. **Integration via a test hook.** A debug-only launch argument
   (`-SnapkitTestMode`) that injects a fixed image instead of grabbing the screen
   and exposes a small command channel (local socket or `XCUIApplication`
   launch environment) to open capture, drag, pick tools and read back outputs.
   This replaces Playwright's page access.
4. **XCUITest** for real UI flows: capture → draw → copy, Settings sections,
   history panel keys, pin actions. XCUITest can drive non-activating panels
   with accessibility identifiers.
5. **Manual checklist** for what automation can't see reliably: full-screen
   apps, Spaces, multiple displays, Screen Recording prompt, sleep/wake.

Port each e2e suite's checks (`run-all.mjs` patterns) to an equivalent test so
"bugs fixed once stay fixed" carries over. `regressions.mjs` and `safety.mjs`
(capture mode can always be closed) come first. The test backlog
(`e2e/backlog.mjs`) idea can stay as a list of XCTest plans.

CI runners have no Screen Recording permission, so layers 1–2 and the test-mode
parts of 3–4 run in CI; real capture runs locally.

## 8. Risks and open questions

### Risks

- **Two codebases.** Every new feature lands twice (Mac Swift, Windows Electron).
  Shared formats and fixtures limit drift but not effort.
- **Editor scope.** The React editor (overlay + annotation + background editor
  is ~3,000 lines of React on Konva) has many small behaviours (Esc steps back one level,
  slider drag is one undo step, text keeps keys while typing). Missing ones will
  feel like regressions. Mitigation: list them from the code before Phase 2.
- **`doc.json` compatibility.** Konva-specific details in `shapes` (text metrics,
  font fallback) may render slightly differently in Core Graphics. Reopened
  entries could shift by a few pixels.
- **Screen Recording prompts.** macOS 15+ periodically re-asks some apps; a
  signing change resets the grant. Unavoidable, but worth a clear in-app message.
- **ScreenCaptureKit latency** on first use after launch (shareable content
  fetch) could make the first capture slower than CGDisplay. Mitigated by
  warming up at launch; measure in Phase 1.
- **Compression licence.** libimagequant is GPL v3 (or commercial); Snapkit is
  MIT. Need a different quantizer or accept GPL for the Mac app.

### Open questions

1. Go native at all, or keep fixing Electron? (This plan assumes yes.)
2. Minimum macOS version: 14 (ScreenCaptureKit screenshots, simpler) or older with a CGDisplay fallback?
3. Join the Apple Developer Program ($99/year) for Developer ID signing and notarization?
4. Update mechanism: keep notify-and-download, or move to Sparkle?
5. Universal binary (Intel too) from the first native release?
6. Ship native as a separate beta next to Electron, or replace the Mac Electron build directly?
7. Hotkeys: KeyboardShortcuts package or own Carbon wrapper? (More broadly: allow third-party Swift packages?)
8. Compression: write a small MIT quantizer, or another approach?
9. Keep the custom themes (Gray, accent, Liquid Glass toggle) or follow system appearance on native?
10. `features.ts`: generate the Swift copy from it, or keep two hand-written lists with a test?
11. Clean up Electron's leftover Chromium caches in Application Support after migrating?
12. Windows: stay on Electron indefinitely, or plan a native Windows app later?
13. Where the code lives: `mac/` in this repo (recommended, shared fixtures and releases) or a separate repo?
