# Native macOS Snapkit: plan

Status: proposal, no app code yet. Decisions taken so far are in §0; the rest
marked **Open** are for Son.

A Swift app for macOS (AppKit + some SwiftUI, ScreenCaptureKit, Vision) that
matches what the Electron app does today (v0.2.0-beta.14) and reads its data.
It ships **next to** the Electron app as a beta; Electron stays the stable Mac
version and the only Windows version.

## 0. Decisions

| Question | Decision |
|---|---|
| Native or keep fixing Electron | Both: keep the Electron Mac app, build native alongside it |
| Minimum macOS | 14 (Sonoma) |
| Apple Developer ID signing / notarization | No. Unsigned for Gatekeeper; see §6 for a self-signed certificate that keeps Screen Recording permission across updates |
| Intel Macs | Yes, universal binary (arm64 + x86_64) |
| How it ships | Landing page Mac download: Electron is "stable", native is "beta" once released |
| Windows | Stays Electron; no native Windows plan |
| Update mechanism | Open, explained in §6 |

## 1. Why native

The Electron app works, but most recent Mac fixes are workarounds around a web
page acting as a capture overlay:

| Problem today | Where | Native |
|---|---|---|
| Capture window stops reaching the screen after days; hotkey "does nothing" | `overlay.ts` (replace windows on a quick second press, hourly rebuild) | Still possible (see §2, lessons), but we can check it directly: window number, `occlusionState`, on-screen list. Healing is a cheap panel swap in the same process, not a renderer reload. |
| Window stops counting as "on every Space"; macOS slides to another Space | `watchSpaces()` (replace windows and reopen) | Same WindowServer behaviour hits native apps. Snapzy and macshot rebuild their panels on Space change and wake. Native lets us do it before the next capture, not after a failed one. |
| Two-step open (`arm` dim, then `pixels` transfer) so the dim shows fast | `ipc.ts`, `Overlay.tsx` | The frozen frame is a `CGImage` set straight on a layer. No copy into a renderer. |
| Hotkey path must stay synchronous or capture stalls until the next mouse move | `index.ts` | Carbon hotkey callback runs on the main run loop; no promise scheduling. |
| Focus not returned to the previous app | `releaseFocus()` | Non-activating panel never activates Snapkit in the first place. |

So native doesn't make the overlay bugs impossible; it makes them visible and
cheap to fix, and removes the Chromium layer that made them hard to diagnose.

Other gains:

- **Size.** Installed Electron app is ~282 MB, DMG ~76 MB. macshot (a native app
  with more features, video included) is a few MB of source; a native Snapkit
  should be well under 20 MB installed.
- **Launch and first capture.** No Chromium, no hidden renderer per display.
  Snapzy measured pooled panels at under 150 ms to activate vs 400–600 ms fresh;
  macshot shows each display's frozen frame as soon as its own grab lands.
  Phase 0 measures Electron with `e2e/timing.mjs` to compare real numbers.
- **Memory.** Electron runs a main, GPU and renderer per display/panel. Measure
  both in Phase 0.
- **Simpler packaging.** One binary; Vision OCR in-process, so no `snapkit-ocr`
  helper and no Electron fuses/after-pack signing.

Costs: a second Mac codebase to maintain next to Electron (every Mac feature
lands twice while both ship), and a full rewrite of the editor and Settings UI.

## 2. Lessons from open-source native apps

Two active, popular native screenshot apps were read for this plan (cloned
2026-11-07):

| | [Snapzy](https://github.com/duongductrong/Snapzy) | [macshot](https://github.com/sw33tLie/macshot) |
|---|---|---|
| Licence | BSD-3-Clause: code can be reused with attribution | GPL-3.0: **ideas only**, no code copied into MIT Snapkit |
| Stars, activity | ~3.5k, active | ~4k, active |
| Size | ~180k lines of Swift (large: video, cloud, CLI, mockups) | ~80k lines |
| Min macOS | 13 | 12.3 |
| Dependencies | Sparkle, GRDB (SQLite), swift-argument-parser, WebP | Sparkle, WebP |
| Signing | Developer ID + notarization; falls back to a **self-signed** certificate, refuses ad-hoc by default | Developer ID + notarization |
| Updates | Sparkle 2, EdDSA appcast | Sparkle 2, EdDSA appcast |

What they do that we should copy (as ideas; code only from Snapzy):

- **Overlay = pooled `NSPanel` per display**, created at launch and warmed with
  one invisible order-front so WindowServer has the surface ready.
  `styleMask [.borderless, .nonactivatingPanel]`, level `.screenSaver` (Snapzy)
  or 257 (macshot), `collectionBehavior [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary]`,
  `animationBehavior = .none` (macshot hit a zoom-in under Reduce Motion
  without it), `hidesOnDeactivate = false`.
- **Idle panels ignore the mouse** (`ignoresMouseEvents = true` until a capture
  shows them), so a stuck panel can never swallow clicks (macshot issue 231).
- **Rebuild the pool on Space churn and wake.** Snapzy documents that hidden
  panels lose their all-Spaces membership after Mission Control changes,
  full-screen app Spaces and display sleep; toggling `collectionBehavior` does
  not repair it, only a fresh window does. Both apps rebuild on
  `activeSpaceDidChangeNotification`, `didWakeNotification` and screen changes,
  debounced and never during a capture.
- **Presentation watchdog.** Snapzy re-checks right after showing that each panel
  is really on screen, and replaces a panel that isn't, with a cap per session.
  This is the native version of Snapkit's "second press replaces the windows".
- **Grab the screen in parallel with showing the panels**, cursor display first,
  and show each display as soon as its image lands (macshot).
- **Capture API mix.** macshot prefers `SCScreenshotManager` (on macOS 26 the
  rect-based call that skips the slow `SCShareableContent` fetch) and falls back
  to `CGWindowListCreateImage`. Snapzy uses `CGDisplayCreateImage` off the main
  thread as its fast path (5–20 ms per display). The CG calls are deprecated but
  still work, and they keep transient UI (open menus, Spotlight) in the shot.
- **Own Carbon hotkey wrapper** in both, no KeyboardShortcuts package. macshot
  suspends hotkeys without forgetting them (like Snapkit's step-aside). Snapzy
  also warns when a shortcut clashes with macOS's own screenshot shortcuts.
- **Screen Recording permission:** poll `CGPreflightScreenCaptureAccess()` during
  onboarding; macshot notes it caches `true` within a process, so a revoked grant
  is only seen after relaunch.
- **History storage:** Snapzy uses SQLite (GRDB). Snapkit keeps its JSON index
  for compatibility with Electron (§4).

Things they have that Snapkit doesn't (not in scope, possible later): scrolling
capture, screen recording/GIF, window capture with snapping, cloud upload, CLI,
PII auto-redaction, translation.

## 3. Architecture

### App structure

- Xcode project in `mac/` in this repo, one app target, one `SnapkitCore` Swift
  package for logic that can be unit tested without UI.
- `LSUIElement = YES` (menu-bar app). Dock icon only while Settings is open, as today.
- Deployment target macOS 14, universal binary.
- Single instance via `NSRunningApplication`; `--history`, `--fullscreen`,
  `--last-area`, `--text` via a `snapkit://` URL scheme or distributed notification.

```
mac/
  Snapkit.xcodeproj
  Snapkit/                 App target: AppDelegate, menu bar, windows
    Capture/               CaptureController, OverlayPool, OverlayPanel, SelectionView
    Editor/                Canvas, tools, style bar, background editor
    Pin/                   PinPanel, PreviewPanel (floating preview)
    History/               HistoryPanel
    Settings/              SwiftUI settings window
  Packages/SnapkitCore/    Settings model + JSON, history store, naming, prune rules,
                           annotation model + geometry, beautify layout, compress
  SnapkitTests/ SnapkitUITests/
```

### Capture overlay

- `OverlayPool`: one panel per display as in §2, warmed at launch, rebuilt on
  screen change, Space change and wake (debounced, skipped while capturing).
- Content: a layer-backed view. Bottom: the frozen screen (`CALayer.contents`).
  Above: dim with a hole (`CAShapeLayer`, even-odd), selection outline, size
  label, toolbars, annotation canvas.
- `canBecomeKey = true` so Esc, ⌘C and tool letters arrive without activating
  Snapkit; focus stays with the app underneath.
- Safeguards kept from Electron: hotkey again closes capture mode, 3-minute
  idle close, log line per open/close, plus the presentation watchdog.

### Screen grabbing

`CaptureEngine` protocol (as `src/main/capture/`), two engines:

1. **ScreenCaptureKit** `SCScreenshotManager`: default. `SCShareableContent`
   fetched at launch and on screen changes so a capture doesn't wait on it; on
   macOS 26 the rect-based call. Can exclude Snapkit's own pins and previews.
2. **CoreGraphics** `CGDisplayCreateImage`: fallback when SCK fails or is slow,
   and the source for "keep open menus in the shot". Deprecated; keep it behind
   the protocol so it can be dropped.

All displays in parallel, cursor display shown first. The `capture.engine`
setting picks one, as today.

### Global hotkeys

Own wrapper on Carbon `RegisterEventHotKey` (both reference apps do this; no
dependency). Parse and write Electron accelerators (`Alt+Shift+Z`,
`CommandOrControl+Shift+1`) so `settings.json` stays compatible. Keep: retry
hotkeys another app holds, step aside in capture mode (⌘⇧Z = Redo), and add a
warning for clashes with macOS's screenshot shortcuts.

### Menu bar

`NSStatusItem` + `NSMenu` mirroring `tray.ts`.

### Annotation canvas: Core Graphics vs SwiftUI Canvas

| | Custom `NSView` + Core Graphics | SwiftUI `Canvas` |
|---|---|---|
| Hit testing, handles, selection | Full control | Manual, gestures fight fine mouse handling |
| Text editing in place | `NSTextView` overlay | `TextField`, no outline styles |
| Blur / pixelate | Core Image on the region | Same, redraws everything |
| Export at image scale | Same draw code into any `CGContext` | `ImageRenderer`, less control |
| Right-click menus, modifier keys | Native | Awkward |

Plan: **AppKit `NSView` + Core Graphics**, one `draw(shape, in:scale:)` for screen
and export. macshot does the same (AppKit `OverlayView`, tool handlers per tool).
Shapes are value types in `SnapkitCore` mirroring `annotate/model.ts`. Toolbars
and the style bar can be SwiftUI hosted in the panel.

### Beautify

Core Graphics gradient/solid/image, rounded clip, shadow, frames. Port
`beautify/layout.ts` as pure geometry with the same tests.

### OCR

Vision `VNRecognizeTextRequest` in-process, same options as
`native/ocr-mac/main.swift` (accurate, language correction, `vi-VT` + `en-US`).

### Output

- Clipboard: exact PNG bytes as `public.png` (as `clipboardPng.ts`) plus TIFF.
- Save: `NSSavePanel` or straight to folder, same naming rule and `nextNumber`.
- Compress: 256-colour quantization. libimagequant is GPL; **Open:** small MIT
  quantizer of our own, or another approach.
- Notifications: `UNUserNotificationCenter`.

### Floating preview and pins

Non-activating `NSPanel`s, floating level, all Spaces: zoom, opacity, move, drag
out as a file, copy, copy text, save, edit, close / close all. Previews stack
bottom-right per display.

### History

Same files as `docs/history.md` (`index.json`, per-entry `final.png`,
`source.png`, `doc.json`, `thumb.jpg`), atomic `.tmp` then rename, same prune
rules, SwiftUI panel with the same keys.

### Settings

`Codable` struct with the same field names as `settings.ts`; only changed values
written, deep-merge on read, atomic and debounced writes. SwiftUI window with the
same sections. Launch at login via `SMAppService.mainApp`.

## 4. Feature parity

S = days, M = about a week, L = several weeks.

| Feature (Electron) | Native approach | Difficulty |
|---|---|---|
| Area capture: dim, drag, handles, arrow-key nudge, size label | Pooled overlay panel + selection view | M |
| Multiple displays, mixed Retina | Panel per `NSScreen`, parallel grabs | M |
| Over full-screen apps / all Spaces, survives Space churn and sleep | Pool rebuild + watchdog (§2) | M (build), M (verify) |
| Quick area capture (copy on release) | Flag in capture controller | S |
| Full-screen capture → floating preview, optional copy | Grab, no overlay | S |
| Capture last area (`last-area.json`), instant or preselected | Same file | S |
| Capture text (OCR hotkey), text panel or copy | Vision + panel | M |
| Copy (exact PNG bytes), Save (dialog/folder, naming, numbering) | `NSPasteboard`, `NSSavePanel` | S |
| Compress (standard/smallest, apply to, editor switch, size estimate) | Quantizer + ImageIO | M |
| Pencil, highlighter (Shift straight) | CG paths | M |
| Arrow (filled/open, two-way, 45°), line, rect/ellipse (filled), Shift square | CG | M |
| Text (plain/outline/background, shadow, fonts, edit existing, move) | `NSTextView` overlay + CG text | L |
| Numbered steps | CG | S |
| Blur / pixelate (0–40) | Core Image | S |
| Ruler (image px) | CG | S |
| Select, move, resize, restyle; smart snap; ⌘ free place | Hit testing + port of `snapBox` | L |
| Undo / redo, color picker, palettes, stroke S/M/L | Model undo stack | M |
| Tool letter keys, variants (right-click), toolbar order/enable | Swift copy of `features.ts` | M |
| Background editor: presets, gradients/solids/image, padding, radius, shadow, frames, zoom, random | CG renderer + SwiftUI | L |
| Remember last background; background on by default (also full-screen) | Settings | S |
| Floating preview after copy | `NSPanel` | M |
| Pins: zoom, opacity, move, drag out, copy, copy text, save, menu, close all | `NSPanel` + `NSDraggingSource` | M |
| Edit a preview or history entry (`CaptureDoc`) | Editor opens from doc | M |
| History: record, panel, keys, star, delete, clear, pause, limits, drag out, copy text | `HistoryStore` + SwiftUI | M |
| Global hotkeys (6), taken-hotkey retry, step aside | Carbon wrapper | M |
| Menu bar menu | `NSStatusItem` | S |
| Settings window, all sections, reset per section, live apply | SwiftUI | L |
| Appearance: light/dark/gray/system, glass, accent | SwiftUI + `NSVisualEffectView` / `NSGlassEffectView` (26) | M |
| Launch at login (incl. needs approval) | `SMAppService` | S |
| Screen Recording permission check and explanation | `CGPreflight…` / `CGRequestScreenCaptureAccess` | S |
| Update check | §6 | S–M |
| Notifications on copy/save | `UNUserNotificationCenter` | S |
| Idle close, hotkey-again close, log file | `os.Logger` + file | S |
| CLI flags | URL scheme | S |

Not needed on Mac: Windows workarounds (`winkeep`, `noAnimation`, koffi), Tesseract.

## 5. Compatibility with the Electron app

### Shared data

Electron's `userData` on macOS is `~/Library/Application Support/Snapkit`
(`settings.json`, `last-area.json`, `history/`). Native uses **the same folder
and files**, so users switch with nothing lost and can switch back:

- `settings.json`: sparse overrides merged over defaults. Unknown keys are kept
  on write; wrong types fall back to the default, as `mergeSettings` does.
- `history/`: same format both ways. `doc.json` shapes are in overlay points with
  `scale` = image px per point; the Swift decoder reads and writes that shape.
- `last-area.json`: Electron's Mac display id is the `CGDirectDisplayID`; bounds
  as fallback.
- Electron's Chromium caches in that folder are left alone. **Open:** clean up.

### Running both

Since both are offered for download, people will have both installed. Points to settle:

- **Bundle id and name.** Same id (`com.charios.snapkit`) means one app replaces
  the other, and Login Items, notifications and (with the same signature)
  Screen Recording carry over. A separate id (e.g. `com.charios.snapkit.beta`,
  "Snapkit Beta.app") lets both sit in Applications but needs its own Screen
  Recording grant. **Open.**
- **Only one should run.** Both grab the same hotkeys and write the same files.
  Native checks at launch for the Electron app and offers to quit it (and turn off
  its launch at login).
- **Updates must not cross over.** Electron's checker (`pickRelease` in
  `src/shared/version.ts`) takes the highest version among all releases,
  prereleases included while on a beta, and downloads the first `.dmg`. A native
  release in the same repo would be offered to Electron users. Before the first
  native release: tag native releases differently (e.g. `mac-v0.1.0-beta.1`) and
  make Electron's checker and the site's `release.ts` ignore those tags. Ship that
  Electron change first.

### What can be shared

No shared runtime, so sharing is by **format and tests**: JSON fixtures in
`fixtures/` loaded by both vitest and Swift tests for `mergeSettings`,
`applyPatch`, `toolbarOrder`, `toPrune`, `fileName`/`uniqueName`, annotation
geometry and beautify layout. `features.ts`: generate the Swift list from it, or
keep two with a test that compares ids (**Open**). Plus icon assets, presets,
palettes, the website and the release flow.

## 6. Build, signing, updates, distribution

### Signing without a Developer ID

Decision: no Apple Developer Program. Gatekeeper then warns on first open of a
downloaded app (right-click → Open, or System Settings → Open Anyway), as it
does for the Electron app today.

The part that matters more is **Screen Recording permission across updates**.
macOS ties the grant to the app's code signing identity. Ad-hoc signing (what
`build/after-pack.cjs` does now) gives every build a new identity, so after an
update macOS may treat it as a new app and the grant stops working until the user
removes and re-adds Snapkit in System Settings. Snapzy's fix, without paying
Apple: a **self-signed code signing certificate**, created once and kept as a
GitHub Actions secret, used for every release. The identity stays the same, so
the grant survives updates. Gatekeeper still warns on first install. Snapzy's CI
even refuses an ad-hoc release unless explicitly allowed, and compares each
build's designated requirement with the previous release to catch an accidental
identity change.

Recommendation: self-signed certificate for native from its first release. (The
same would help the Electron Mac build; that is a separate change.)

### Updates (Open)

Two options:

1. **Notify and download (today's Electron behaviour).** Snapkit checks GitHub
   releases, shows a notification, and opens the download. The user opens the
   DMG, drags the app to Applications, and goes through Gatekeeper's warning
   again for the new download (it's quarantined). Simple, no extra keys or files.
2. **Sparkle 2 (what Snapzy and macshot use).** Open-source update framework
   (MIT). The app reads a small feed file (`appcast.xml`) listing versions;
   when there's a newer one it shows "Version X is available" with release notes,
   downloads, checks the download's EdDSA signature against a public key built
   into the app, replaces the app in place and relaunches. Needs: an EdDSA key
   pair (private key only in GitHub secrets), CI that signs each release zip and
   updates `appcast.xml` (hosted in the repo, on GitHub Pages or on the site),
   and separate feeds or channels for beta/stable. Works without a Developer ID;
   the in-app download isn't quarantined, so there's no Gatekeeper warning after
   the first install. With the self-signed certificate, Screen Recording also
   survives the update.

Sparkle is the better experience; notify-and-download is less to maintain.

### Packaging and CI

- Universal `.app`, zipped (Sparkle prefers zip) and/or in a DMG for the site.
- GitHub Actions `macos-15` or newer (`macos-26` for the macOS 26 SDK, needed
  for `NSGlassEffectView`): `xcodebuild test` on `SnapkitCore`, archive, sign
  with the self-signed certificate, Sparkle signature if chosen, upload on
  `mac-v*` tags. Secrets only in GitHub Actions secrets.
- `scripts/update-mac.sh --local` gets a native variant.
- Site: the Mac download shows Electron as stable and native as beta once the
  first native beta is out (site change in `site/src/components/Download.astro`
  and `site/src/lib/release.ts`).

## 7. Milestones

Rough effort, one developer with an AI assistant.

| Phase | Scope | Effort |
|---|---|---|
| 0. Baseline | Measure Electron (launch, hotkey→dim, memory, size); `mac/` project; CI builds an empty universal menu-bar app with the self-signed cert; shared fixtures; Electron update checker and site ignore `mac-v*` tags | 3–4 days |
| 1. MVP | Menu bar, capture hotkey, pooled overlay with rebuild + watchdog, all displays/Spaces/full screen, select + handles, copy (exact PNG) and save (naming rule), Esc, pencil/arrow/rect/text basics, undo, reads `settings.json` | 2–3 weeks |
| 2. Editor parity | All tools and variants, select/move/resize/restyle, snap, steps, blur, ruler, highlighter, text styles, style bar, toolbar order, tool keys | 3–4 weeks |
| 3. Around the capture | Full-screen and last-area, quick copy, floating preview, pins, notifications, compress, OCR | 2–3 weeks |
| 4. Background + history | Background editor, history store + panel, edit from history/preview | 2–3 weeks |
| 5. Settings + polish | Settings window, themes, launch at login, permission onboarding, updates, logging, accessibility | 2–3 weeks |
| 6. Beta release | First `mac-v` beta, site shows it as beta, migration check on real data | 1 week |

Total: roughly 3–4 months part-time to parity. The MVP is usable for dogfooding
after Phase 1.

## 8. Testing

Playwright drives Chromium pages and won't work on AppKit. Layers:

1. **Unit (Swift Testing / XCTest) on `SnapkitCore`**, with fixtures shared with vitest.
2. **Render tests:** draw a fixed `CaptureDoc` to PNG and compare with reference
   images (covers `annotate`, `ruler`, `fullscreen` visual checks).
3. **Test mode:** a debug launch argument that injects a fixed image instead of
   grabbing the screen, plus a small command channel to drive capture and read
   outputs. Snapzy has a local-socket CLI protocol that could serve as a model.
4. **XCUITest** for flows: capture → draw → copy, Settings, history keys, pins.
5. **Manual checklist** for Spaces, full-screen apps, displays, sleep/wake,
   permission prompts. Snapzy's overlay tests (coordinate spaces, pool
   presentation) are worth reading for what can be automated.

Port each e2e suite's checks to an equivalent, `safety` and `regressions` first.
CI has no Screen Recording permission, so real capture runs locally.

## 9. Risks and open questions

### Risks

- **Two Mac apps.** Each Mac feature lands in Electron and native while both ship.
- **Overlay bugs move, not vanish.** Snapzy's code shows the same invisible-overlay
  and lost-Spaces problems in native apps; plan for the pool rebuild and watchdog
  from Phase 1, not as later fixes.
- **Editor scope.** ~3,000 lines of React on Konva with many small behaviours
  (Esc steps back one level, slider drag = one undo step, text keeps keys).
  List them from the code before Phase 2.
- **`doc.json` rendering differences** between Konva and Core Graphics (text
  metrics) may shift reopened entries by a pixel or two.
- **Deprecated CG capture** may be removed in a future macOS; it's only a fallback.
- **Release crossover** if native releases aren't filtered out of Electron's
  update check before the first native release.
- **Compression licence** (libimagequant is GPL).

### Open questions

1. Updates: notify-and-download or Sparkle? (§6)
2. Self-signed certificate for native releases (and later for Electron)?
3. Same bundle id as Electron (one replaces the other) or a separate "Snapkit Beta"?
4. Release tags for native, e.g. `mac-v0.1.0-beta.1`, in this repo?
5. Compression: our own small MIT quantizer, or another approach?
6. Keep the custom themes (Gray, accent, Liquid Glass switch) or follow the system?
7. `features.ts`: generate the Swift list, or two lists plus a test?
8. Clean up Electron's Chromium caches when someone moves to native?
9. Reuse Snapzy code (BSD-3, with attribution) where it fits, or write everything ourselves?
