# Native macOS Snapkit: plan

Status: proposal, no app code yet. Decisions taken so far are in §0; the rest
marked **Open** are for Son.

A Swift app for macOS (AppKit + some SwiftUI, ScreenCaptureKit, Vision) that
matches what the Electron app does today (v0.2.0-beta.14) and reads its data.
If it works well, it **replaces** the Electron app on Mac; Electron stays the
Windows version. Release details come later: the focus now is the app itself.

## 0. Decisions

| Question | Decision |
|---|---|
| Native or keep fixing Electron | Keep Electron while native is built; native replaces Electron on Mac once it works well |
| Windows | Stays Electron; no native Windows plan |
| Minimum macOS | 14 (Sonoma) |
| Intel Macs | Yes, universal binary (arm64 + x86_64) |
| Apple Developer ID signing / notarization | No. Releases are signed with a self-signed certificate (§6) |
| Update mechanism | Sparkle 2 |
| Bundle id | Same as Electron, `com.charios.snapkit`, so the native app replaces it in place (Debug builds use `com.charios.snapkit.dev`, §5) |
| Release tags, site download, beta channel | Later, once the app works |
| Compression | MIT-compatible library or our own: port UPNG.js's quantizer (MIT, what Electron uses today) |
| Appearance | Same options as Electron: System / Light / Dark / Gray, Liquid Glass switch, accent (§3) |
| Tool list (`features.ts`) | Hand-written Swift list, checked against a JSON export of `features.ts` by a test (§5) |
| Electron's Chromium caches | Removed once, after the first successful native launch, when the Electron app is gone (§5) |
| Reusing Snapzy code | Yes where it fits, with credits in the repo, the app and the site FAQ (§2) |

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

### Reusing Snapzy code, and credits

Decision: reuse Snapzy code where it fits. Likely candidates: the overlay pool and
its presentation watchdog, Space-churn rebuild, the Carbon hotkey wrapper,
coordinate-space helpers for capture rects, `SMAppService` login item wrapper.
Never macshot code (GPL).

BSD-3-Clause asks for three things, and the plan covers each:

1. **Keep the copyright notice in source:** reused files keep Snapzy's notice at
   the top plus a line saying what we changed (`// Based on Snapzy's
   AreaSelectionWindow.swift, BSD-3-Clause, see THIRD_PARTY_NOTICES.md`).
2. **Reproduce it with the binary:** `THIRD_PARTY_NOTICES.md` in the repo with
   Snapzy's full licence text, also copied into the app bundle's Resources (the
   app itself shows no credits; credits live on GitHub, decided 2026-11-08).
3. **No endorsement:** we don't use the Snapzy name to promote Snapkit; we only
   credit it.

The same notices file lists the other open-source parts: Sparkle (MIT), UPNG.js
(MIT, compression), and any others added later.

Credits beyond what the licence requires:

- **GitHub:** a "Credits" section in the README naming Snapzy (with link) and what
  was based on it, and the notices file linked from there.
- **Landing page FAQ:** a Q&A such as "Is Snapkit built on other open-source
  apps?", answering that the Mac app reuses parts of Snapzy (BSD-3) and learned from
  other open-source screenshot tools, with links. Added to the site when the first
  native release ships (release work comes later).

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
- Compress: Electron uses UPNG.js (MIT) in a worker: quantize to at most 256
  colours, then encode an indexed PNG. Native ports UPNG's quantizer to Swift
  (same algorithm, so outputs match Electron closely, and its MIT licence fits),
  runs it off the main thread, and encodes the indexed PNG with ImageIO.
  `smallest` first resizes HiDPI captures to 1× with Core Graphics. libimagequant
  and pngquant are GPL, so they're out.
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

### Appearance (same options as Electron)

Electron today (`theme.ts`, `settingsWindow.ts`): `appearance.mode` is System,
Light, Dark or Gray; `glass` turns Liquid Glass panels on or off; `accent` is a
colour for the selected tool, switches and main buttons ('' = the theme's own:
white in glass, gray in dark). System follows macOS's light/dark live. Gray is
Snapkit's own: the dark theme with lighter surfaces. Native windows and menus
(Settings window material, dialogs, context menus) follow light/dark, with Gray
treated as dark.

Native keeps exactly these options and maps them like this:

| Setting | Native |
|---|---|
| System | Windows get no fixed appearance (`appearance = nil`), so they follow macOS live, including Auto (light by day, dark at night). Our own colours come from tokens with light and dark values, resolved per appearance (`NSColor(name:dynamicProvider:)`), so they switch at the same moment as system controls. |
| Light / Dark | `NSAppearance(named: .aqua / .darkAqua)` on every Snapkit window, panel and menu. |
| Gray | `.darkAqua` for system parts (menus, dialogs, pop-ups), plus our lighter gray surface tokens on Snapkit's own panels, as in Electron. |
| Liquid Glass on | macOS 26: `NSGlassEffectView` / SwiftUI `.glassEffect()`, the real system glass. macOS 14–15: `NSVisualEffectView` with a HUD/popover material (frosted blur, no refraction). So glass looks somewhat different by macOS version. |
| Liquid Glass off | Solid panel colours from the tokens. |
| Accent | Our own controls use it. System controls (switches, sliders, buttons in Settings) get it as their tint. '' keeps the theme's own, as in Electron. |

Things "system theme" brings on Mac that Electron mostly ignores, and which
native should respect:

- **Reduce Transparency** (Accessibility): glass and blur become solid
  automatically for system materials; our own glass falls back to solid too.
- **Increase Contrast:** stronger borders on system controls; our tokens get
  high-contrast variants for separators and outlines.
- **System accent colour** (System Settings → Appearance): affects system
  controls when our accent is ''. Electron ignores it. To look the same as
  Electron, '' maps to the theme's own accent, not the system one. (Offering
  "System accent" as an extra choice could come later.)

The annotation colours and the dim are never themed: drawings must look the same
in every theme.

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
- **Electron's leftover caches.** The Electron app leaves Chromium folders next
  to our data (`Cache`, `Code Cache`, `GPUCache`, `DawnGraphiteCache`,
  `DawnWebGPUCache`, `Local Storage`, `Session Storage`, `blob_storage`, …,
  often tens of MB). Native removes exactly that list, once, after its first
  successful launch and only when no Electron Snapkit is installed or running.
  It never touches `settings.json`, `last-area.json` or `history/`, and logs
  what it removed.

### Replacing Electron on Mac

- **Same bundle id and name** (`com.charios.snapkit`, `Snapkit.app`): the native
  app installs over the Electron one, and Login Items, notifications and the data
  folder carry over. Screen Recording carries over only if the signing identity
  stays the same, which it won't on the first switch from ad-hoc (§6), so
  expect one re-grant then.
- **During development:** Debug builds use `com.charios.snapkit.dev` and their own
  data folder (`Snapkit Dev`) so they never clash with the installed Electron app,
  with a launch option to read a copy of the real folder for migration testing.
  Only one should run at a time anyway (both grab the same hotkeys); the dev build
  warns if Electron Snapkit is running.
- **Release mechanics (later):** how the first native build reaches Electron
  users. Electron's update checker (`pickRelease` in `src/shared/version.ts`)
  takes the highest version and the first `.dmg`, so the switch can be a normal
  release: an Electron user gets the native DMG as their next update. The
  version numbering, beta period and site wording are decided when the app is
  ready.

### What can be shared

No shared runtime, so sharing is by **format and tests**: JSON fixtures in
`fixtures/` loaded by both vitest and Swift tests for `mergeSettings`,
`applyPatch`, `toolbarOrder`, `toPrune`, `fileName`/`uniqueName`, annotation
geometry and beautify layout. Since Windows stays on Electron, `features.ts`,
`settings.ts` and the fixtures remain shared for good, so a feature added to one
app is visible to the other's tests.

`features.ts` → Swift: a hand-written Swift list (labels, letters, variants,
defaults), plus `npm run fixtures:export` writing `fixtures/features.json` and
`fixtures/default-settings.json` from the TypeScript. A Swift test compares ids,
order, defaults, variants and hints with those files. This avoids a code
generator in the Xcode build, and a mismatch fails the tests instead of drifting.

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

Decision: self-signed certificate for native from its first release. (The
same would help the Electron Mac build; that is a separate change.) **Decided: yes.**

How it would work:

1. Once, on a Mac: create a code signing certificate in Keychain Access
   (Certificate Assistant → Create a Certificate, type Code Signing, valid 10 years)
   named e.g. "Snapkit Self-Signed". Export it with its private key as a `.p12`
   with a password.
2. Store the `.p12` (base64) and its password as GitHub Actions secrets, and a
   backup somewhere safe offline. Losing it means a new identity, so one more
   Screen Recording re-grant for everyone.
3. CI imports it into a temporary keychain and signs the app with it (hardened
   runtime on). A check compares the build's designated requirement with the last
   release's and fails if it changed.
4. Users: first install still shows Gatekeeper's warning (the certificate isn't
   from Apple). After that, Sparkle updates install without warnings, and Screen
   Recording keeps working.

Local Debug builds keep Xcode's own signing; only releases use the certificate.

### Updates: Sparkle 2 (decided)

The two options that were compared:

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

Decision: Sparkle. Built into the app in Phase 5 (update check UI, EdDSA public
key in `Info.plist`, "Check for Updates…" in the menu, the existing
`updates.autoCheck` setting mapped to Sparkle's automatic checks). Where the feed
is hosted, the beta/stable channels, and the CI signing step are release work and
come later.

Status (2026-11-08): built in. Sparkle 2.10 is linked and embedded; release builds use it when
`mac/scripts/sparkle.env` has the public key and feed URL, else they fall back to the GitHub check.
Betas go to a `beta` channel offered only to people on a beta. `mac/scripts/sparkle-release.sh`
signs a zip and writes the appcast; `mac/e2e/sparkle-update.mjs` tests an update end to end with a
throwaway key. Waiting on: the key pair (you), feed hosting and CI (release work).

### Packaging and CI

- Universal `.app`, zipped for Sparkle, plus a DMG for the site (later).
- Now: GitHub Actions on a `macos-15` or newer runner (`macos-26` for the macOS 26
  SDK, needed for `NSGlassEffectView`) runs `xcodebuild test` and builds the app
  on every PR touching `mac/`, uploading the unsigned build as an artifact.
- Later (release work): sign with the self-signed certificate, Sparkle signature,
  appcast update, attach to the GitHub release, site download. Secrets only in
  GitHub Actions secrets.
- `scripts/update-mac.sh --local` gets a native variant for daily use.

## 7. Milestones

Rough effort, one developer with an AI assistant.

| Phase | Scope | Effort |
|---|---|---|
| 0. Baseline | Measure Electron (launch, hotkey→dim, memory, size); `mac/` project; CI builds an empty universal menu-bar app (unsigned until release work); shared fixtures | 3–4 days |
| 1. MVP | Menu bar, capture hotkey, pooled overlay with rebuild + watchdog, all displays/Spaces/full screen, select + handles, copy (exact PNG) and save (naming rule), Esc, pencil/arrow/rect/text basics, undo, reads `settings.json` | 2–3 weeks |
| 2. Editor parity | All tools and variants, select/move/resize/restyle, snap, steps, blur, ruler, highlighter, text styles, style bar, toolbar order, tool keys | 3–4 weeks |
| 3. Around the capture | Full-screen and last-area, quick copy, floating preview, pins, notifications, compress, OCR | 2–3 weeks |
| 4. Background + history | Background editor, history store + panel, edit from history/preview | 2–3 weeks |
| 5. Settings + polish | Settings window, themes, launch at login, permission onboarding, updates, logging, accessibility | 2–3 weeks |
| 6. Ready to replace Electron | Migration check on real data, full parity run, daily use as the only Mac Snapkit. Release work (signing, feed, site) planned then | 1 week + daily use |

Total: roughly 3–4 months part-time to parity. The MVP is usable for dogfooding
after Phase 1.

## 8. Testing

Full plan: **[native-mac-testing.md](native-mac-testing.md)**. In short:

- **Layers:** Swift unit tests on `SnapkitCore`; image-output tests (exact sizes,
  padding/shadow probes, compression, clipboard bytes); XCUITest flows in a
  Debug-only test mode that uses a fixed screen image instead of a real grab;
  visual parity against Electron; timing and a 24 h soak; a manual checklist.
- **Parity:** every one of the ~150 checks in `e2e/run-all.mjs` is mapped to a
  native test or marked N/A with a reason; `scripts/parity-coverage.mjs` fails if
  one is missing. Shared JSON fixtures in `fixtures/` are run by both vitest and
  the Swift tests.
- **UI/UX:** both apps render the same scenes (overlay, every tool, editor,
  preview, pins, History, Settings, in each theme), diffed with thresholds and a
  reviewed baseline; layout tokens extracted from Electron's CSS into
  `fixtures/ui-tokens.json`, which native builds from and tests against.
- **Workflow:** the same three tiers as Electron (`mac:test` + area suites per
  change, backlog, full run before release), CI on macOS runners without needing
  Screen Recording, real capture locally, and a release gate tied to parity.

Testing adds roughly 6–7 weeks across the phases.

## 9. Risks and open questions

### Risks

- **Two Mac apps for a while.** Until native replaces Electron, a Mac feature
  added to Electron must be added to native too. Keeping new Mac features small
  in that period limits it.
- **Overlay bugs move, not vanish.** Snapzy's code shows the same invisible-overlay
  and lost-Spaces problems in native apps; plan for the pool rebuild and watchdog
  from Phase 1, not as later fixes.
- **Editor scope.** ~3,000 lines of React on Konva with many small behaviours
  (Esc steps back one level, slider drag = one undo step, text keeps keys).
  List them from the code before Phase 2.
- **`doc.json` rendering differences** between Konva and Core Graphics (text
  metrics) may shift reopened entries by a pixel or two.
- **Deprecated CG capture** may be removed in a future macOS; it's only a fallback.
- **Ported quantizer quality.** UPNG's quantizer is simpler than libimagequant;
  it's what Electron ships today, so parity is the bar, not "best possible".
- **Reused Snapzy code** is written for Snapzy's architecture (larger, with
  recording and a CLI); taking parts may pull in more than wanted. Take small,
  self-contained pieces and adapt them.

### Open questions

1. Later, with release work: version numbers, beta period, feed hosting, site
   wording for the switch from Electron.
