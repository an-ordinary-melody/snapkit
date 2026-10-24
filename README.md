# Snapkit

A minimal screenshot tool for macOS and Windows. Lightshot-style capture with
annotation, beautify, pin and history. Every feature can be turned on or off
in settings.

## Status

| Phase | What | State |
|---|---|---|
| 0 | Project, tray / menu bar, global hotkey, CI builds | ✅ |
| 1 | Capture mode: freeze screens, select / move / resize area, copy & save | ✅ |
| 2 | Smart toolbars (auto-placed outside or inside the selection) | ✅ |
| 3 | Annotations (pen, arrow, shapes, text, blur, steps, undo) | ✅ |
| 4 | Background, padding, radius presets + apply-on-copy | ✅ |
| 5 | Pin to screen | ✅ |
| 6 | Capture history (floating panel, copy back) | ✅ |
| 7 | Settings UI + full customization | ✅ |
| 8 | Launch at login, update notifications | ✅ |

## Using it

- **Capture:** `⌥⇧Z` on macOS or `Alt+Shift+Z` on Windows, or click the tray icon. (A capture hotkey set to a capture-mode shortcut such as `⌘⇧Z`, Redo, steps aside while capturing.)
- **Full screen:** `⌘⇧9` (`Ctrl+Shift+9`), or Capture Full Screen in the menu bar, grabs the whole screen under the pointer straight into the floating preview (Copy, Edit, Pin from there) and history, with no selection step. It can also copy right away (Settings → General). Change or turn off the shortcut in Settings → Shortcuts.
- **Select:** drag to select. Drag inside the selection to move it, and drag the handles to resize. Arrow keys nudge the selection (hold Shift for 10px; hold Alt to resize).
- **Copy:** `⌘C` / `Ctrl+C` or `Enter`.
- **Save:** `⌘S` / `Ctrl+S`. Asks where to save, starting in the last folder you used (`Pictures/Snapkit` the first time). Set `save.askLocation` to `false` to save straight to the folder.
- **Quick area capture** (Settings → General → After a capture, off by default): the area you draw is copied the moment you let go, with no adjusting or drawing step. The background default and the floating preview still apply.
- **Cancel:** `Esc` or right-click. If capture mode ever gets stuck, press the capture hotkey (`⌥⇧Z`) again: it always closes it (unless it's set to a capture-mode shortcut; then use Esc). It also closes by itself after 3 minutes without any input.
- **Annotate:** pick a tool from the vertical bar, or press its letter: `P` pencil, `L` line, `A` arrow, `R` rectangle, `E` ellipse, `H` highlighter, `T` text, `N` numbered step (click to drop the next number; the palette sets the badge color), `B` blur. Press the letter again (or click the tool) to go back to moving the selection. Hold Shift for straight pencil/highlighter strokes, lines at 45° and square boxes. Right-click the rectangle (or ellipse) tool for more shapes: filled rectangle, ellipse, filled ellipse, line. Right-click the arrow for a two-way arrow (a head at each end). Buttons with a small corner mark have such a menu.
- **Zoom in the editor:** Ctrl + scroll up zooms the background editor's preview in around the pointer (on a Mac ⌘ + scroll up, or a trackpad pinch), up to 2 output pixels per screen pixel. Hold **Space** and drag to move around, like Photoshop's hand tool (scrolling works too). Ctrl+0 (⌘0) fits it again, Ctrl + / Ctrl − step in and out, and the % badge in the corner also fits.
- **Edit what you drew:** click a shape to select it, then drag to move it, drag its handles to resize, drag an arrow's ends, change its color/width in the style bar, or press Delete. Arrow keys nudge it. While dragging (including a text box you're still typing in), shapes snap to line up with each other and the capture area (pink guides); hold ⌘ to place freely.
- **Text:** click to type. `Enter` adds a line; `⌘Enter` / `Ctrl+Enter` or `Esc` finishes (you stay in capture mode). Drag the blue frame to move the box while typing. Click text (or near it) to select and drag it; double-click to edit it again. Style (one at a time): plain, stroke (an outline, white by default), light background (black text) or dark background (white text), each with its own color swatch for the stroke or background; plus size. Text has its own color, separate from the other tools. A subtle drop shadow (10% by default) and the stroke width are in settings (`annotate.text.shadow`, `annotate.text.strokeWidth`).
- **Style bar:** colors (the rainbow swatch opens a custom color picker; custom colors are remembered until Snapkit quits), stroke width, text options, and blur (default) / pixelate with a strength slider. A blur area updates live while you move or resize it. The color square in the tool bar opens the color picker.
- **Highlighter:** has its own light colors (`annotate.highlighterPalette`).
- **Undo / redo:** `⌘Z` / `⇧⌘Z` (`Ctrl+Z` / `Ctrl+Shift+Z`).
- Hover any button for its name and shortcut.
- **History:** `⌘⇧1` (or History… in the menu bar) opens a panel of your recent copies, saves and pins. Click or Enter copies one again; E edits it (drawings and background still editable), P pins, S saves, F stars, Delete removes, Esc closes. It keeps the last 10 by default, with a size limit and an age limit (Settings → General → History; up to 30 captures / 2 GB). Starred ones are never removed by the limits. Drag a capture out of the panel to drop it into another app as a PNG file. The window can be resized (it remembers the size). The Clear History button clears it (keep starred, or everything after a second click); Settings shows the folder too. Pause History is in the menu-bar menu. Plan and details: [docs/history.md](docs/history.md).
- **Floating preview (pin):** the pin button in the action bar turns it on for this capture (green dot); `pin.afterCopy` sets whether captures start with it on. With it on, after you copy (button or `⌘C`) the result stays as a small preview in the bottom-right corner, like Shottr. Hover it for **Copy** and **Edit**; Edit (or double-click) reopens it in the full editor with your drawings and background still editable, and **Done** puts the edited result back in the preview. Drag the image into another app to drop it as a PNG; drag the move handle (top) to move the preview. Its pin icon turns it into a full-size **pin**: always on top (every Space, over full-screen apps), drag to move, scroll to zoom, ⌥ + scroll for opacity, ⌥-drag into other apps, hover bar with zoom/opacity/copy/save, right-click menu, `Esc` to close. "Close All Pins" is in the menu-bar menu.
- **Background (beautify):** the image button in the action bar turns the background on or off for this capture; it's highlighted with a green dot while on. While it's on, copy and save include it. It starts on or off according to `beautify.applyOnCopy`.
- **Edit background:** the magic-wand button opens a full editor with a live preview and all the drawing tools, so you can finish the image there. Choose Gradient or Color (Image comes later): the colors in use are shown with editable hex values, a random button and a hue slider, above 32 gradient or 32 color presets. Also: settings presets, output size (Auto, 1:1, 16:9, 4:3, 9:16 or custom px), padding / corners / shadow. The switch at the top previews with or without the background. Esc steps back one level (stops typing, then deselects, then leaves the editor); Copy, Save or Done.

## Installing the builds

Download the latest installer from the [Releases](https://github.com/an-ordinary-melody/snapkit/releases) page.
Every push to `main` also builds both installers (the **Actions** tab → latest run →
**Artifacts**).

**Icons:** the app and tray icons are generated from the logo SVGs in `branding/` (kept out of the repo) with `npx electron scripts/make-icons.cjs`: the hand from `Snapkit Black.svg` on the blue gradient becomes the app icon and the Windows tray icon, `Snapkit Mac Negative.svg` the macOS menu-bar icon. The script also writes `build/AppIcon.icon`, an Icon Composer document for the macOS 26 Liquid Glass icon; compile it with **Actions → Mac icon (Liquid Glass) → Run workflow** (needs Xcode 26) and commit the artifact's `Assets.car` and `AppIcon.icns` to `build/`.

**Releasing:** set the version in `package.json` (`npm version 0.2.0-beta.2 --no-git-tag-version`),
write `release-notes/v<version>.md`, commit, then tag and push (`git tag v0.2.0-beta.2 && git push origin v0.2.0-beta.2`).
CI builds both installers and publishes the Release with those notes. To test on Windows, run **Actions → E2E (Windows) → Run workflow** (it runs the suites at 100% and 150% display scaling). A version with a dash
(`-beta.1`) is published as a GitHub pre-release.

**Updates:** Snapkit checks GitHub releases once a day (Settings → About; betas are offered only to people running a beta)
and shows a notification and an "Update available" item in the menu-bar menu.
It downloads the new installer for you to open; nothing installs by itself.
**Launch at login** is in Settings → General; on macOS 13+ you may need to allow
it in System Settings → General → Login Items.

### macOS (unsigned)

1. Open the `.dmg` and drag Snapkit to Applications.
2. Remove the download quarantine, either way:
   - Open Snapkit once. When macOS blocks it, go to **System Settings → Privacy & Security** and click **Open Anyway**.
   - Or run this in Terminal: `xattr -cr /Applications/Snapkit.app`
3. Grant **Screen & System Audio Recording** permission when asked, then quit and reopen Snapkit.
   After installing an update, macOS may ask again. If Snapkit is listed but
   captures only show the wallpaper, remove it from the list with **–** and add it back.

The current build is Apple Silicon only (arm64).

### Windows (unsigned)

Run the setup `.exe`. If SmartScreen warns you, click **More info → Run anyway**.

## Development

```bash
npm install
npm run dev        # run with hot reload
npm test           # unit tests
npm run e2e        # every end-to-end suite with its checks (macOS, ~3 min; shows capture windows)
npm run typecheck
npm run build:mac  # or build:win (run on that OS)
```

**Before a release run `npm test` and `npm run e2e`.** `e2e/run-all.mjs` runs each suite below and checks
its output against the expected results, each labeled with the bug or feature it guards, so a bug fixed
once fails the run if it comes back. Run some suites only with `node e2e/run-all.mjs snap textedit`.
When you fix a bug, add a check for it there (or in `e2e/regressions.mjs`).

Linux smoke test (Xvfb): `npm run build && xvfb-run -a node e2e/smoke.mjs`

Annotation test (macOS or Linux, uses its own profile and briefly shows the capture overlay): `npm run build && node e2e/annotate.mjs /tmp/snapkit-e2e`

Pin test: `npm run build && node e2e/pin.mjs /tmp/snapkit-pin`

Settings test: `npm run build && node e2e/settings.mjs /tmp/snapkit-settings`

Safeguards test (stuck overlay, idle timeout, hotkey toggle): `npm run build && node e2e/safety.mjs /tmp/snapkit-safety`

History test: `npm run build && node e2e/history.mjs /tmp/snapkit-history`

Smart align test (snapping in capture mode and the editor): `npm run build && node e2e/snap.mjs /tmp/snapkit-snap`

Hotkeys and Gray theme test (defaults, stepping aside in capture mode, taking a shortcut back when the app holding it quits): `npm run build && node e2e/hotkeys.mjs /tmp/snapkit-hotkeys`

Text editing test (click into text, drag it): `npm run build && node e2e/textedit.mjs /tmp/snapkit-textedit`

Regression checks for older bugs (Esc with the color picker open, text styles recoloring tools, editing from the preview): `npm run build && node e2e/regressions.mjs /tmp/snapkit-regressions`

Full-screen capture and clear history test: `npm run build && node e2e/fullscreen.mjs /tmp/snapkit-fullscreen`

Install a build on this Mac without waiting for GitHub: `./scripts/update-mac.sh --local "message"`

### Layout

- `src/shared/features.ts`: **feature registry**. Every tool and action is declared here, and the toolbars render from it filtered by settings.
- `src/shared/settings.ts`: settings schema, defaults and merge logic.
- `src/main/`: tray, hotkey, overlay window manager, pins, settings window, copy/save.
- `src/main/capture/`: swappable screen capture engines. Each engine implements `CaptureEngine` (`types.ts`); `order.ts` sets the order per OS (fastest first, always-available last) with automatic fallback, and Settings → About → Capture engine can force one. Today: `node-screenshots` (native) and Electron's `desktopCapturer`. A new engine (e.g. ScreenCaptureKit or DXGI) is one file plus a line in `index.ts`.
- `src/main/security.ts`: IPC is only accepted from Snapkit's own pages; windows can't navigate, open windows or embed webviews. All windows run sandboxed with context isolation; the packaged app has Electron fuses set (no run-as-Node, no Node debug flags, code only from app.asar).
- `docs/history.md`: the plan for capture history (what's kept, limits and clearing).
- `src/renderer/src/overlay/`: capture-mode UI. `layout.ts` holds the toolbar placement algorithm and has unit tests.
- `src/renderer/src/overlay/annotate/`: annotations. `model.ts` is the plain-data shape model and undo history (unit tested); `AnnotationLayer.tsx` draws and edits shapes with Konva; `StyleBar.tsx` is the color/width/text options bar. Per-tool defaults live under `annotate` in settings.
- `src/renderer/src/overlay/beautify/`: background/padding/radius/shadow. `layout.ts` is the geometry (unit tested), `render.ts` draws it, `BackgroundEditor.tsx` is the full editor. Presets live under `beautify.presets` in settings; a preset background can be `solid`, `gradient` or `image` (a local file path).

**Settings window:** menu-bar menu → Settings…, or `⌘⇧2` from any app (also from capture mode; change it in Shortcuts). Sections: General (launch at login first, then floating preview and background defaults, saving with file naming — a text plus the date and/or a counting number before or after it, default `Snapkit <date and time>` — notifications), Shortcuts (capture, full screen, history and settings hotkeys, a letter per tool), Appearance (Light / Gray / Dark (the default) / System, Liquid Glass on or off, highlight color, dim, selection color, size label), Toolbar (show/hide, drag or move up/down each tool and action, with a preview; tools with styles show as a group), Tools (the five quick colors and five highlighter colors, line widths, arrow and shape defaults, text, steps, blur, highlighter), Background (the default background's padding, corners, shadow and angle; gradient and color libraries for the editor — edit, reorder, add, delete, reset, make one the default; optionally remember the last background used) and About (version, logs, settings file, reset all). Changes save and apply immediately; each section can be reset on its own.

Theme: `appearance.mode` is `dark` (default), `gray` (a lighter dark), `light` or `system`; `appearance.glass` turns Liquid Glass on or off (default). `appearance.accent` sets a highlight color (default blue `#0a84ff`; empty uses the theme's: white in glass, gray in dark).

Settings are stored in `settings.json` in the app's data folder (`~/Library/Application Support/Snapkit` on macOS). Only values you change are written there; everything else follows the defaults in `src/shared/settings.ts`.

## Website

The landing page lives in `site/` (Astro, React islands for the demos) and deploys on Vercel
(free Hobby plan) as a project with Root Directory `site`.

The site needs Node 22.23.4 or newer (`site/.nvmrc`; the app itself still builds on Node 20):

```bash
cd site
nvm use            # or put Node 22 first on PATH
npm install
npm run dev        # http://localhost:4321
npm run build && npm run check   # build, then check it in Chrome and in Safari's engine on an iPhone profile
```

- The changelog comes from `release-notes/*.md` and the background presets from `src/shared/settings.ts`:
  `scripts/sync-data.mjs` copies them into `site/src/data/` on every dev/build run (commit the result).
  Only versions published on GitHub show up.
- The download buttons point at the newest GitHub release, looked up at build time. The release job calls a
  Vercel deploy hook (repository secret `VERCEL_DEPLOY_HOOK`) so the site rebuilds after each release.
- `npm run check` needs Chrome and, once, `npx playwright-core install webkit` (Safari's engine).
- Roadmap: `site/src/data/roadmap.json`. Share image: `node scripts/og.mjs` with the site running.
- `?moment=m-bg` (or `m-copy`, …) freezes the hero demo at that moment.
- Security: `scripts/csp.mjs` runs after every build and adds a Content-Security-Policy to each page (only this
  site's files, plus the exact inline scripts by hash; no eval). `site/vercel.json` adds clickjacking protection
  and the other headers. `npm run check <url>` also checks the headers on a deployed site.

## License

[MIT](LICENSE)
