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
| 8 | Launch at login, update notifications | ⏳ |

## Using it

- **Capture:** `⌘⇧2` on macOS or `Ctrl+Shift+2` on Windows, or click the tray icon.
- **Select:** drag to select. Drag inside the selection to move it, and drag the handles to resize. Arrow keys nudge the selection (hold Shift for 10px; hold Alt to resize).
- **Copy:** `⌘C` / `Ctrl+C` or `Enter`.
- **Save:** `⌘S` / `Ctrl+S`. Asks where to save, starting in the last folder you used (`Pictures/Snapkit` the first time). Set `save.askLocation` to `false` to save straight to the folder.
- **Cancel:** `Esc` or right-click.
- **Annotate:** pick a tool from the vertical bar, or press its letter: `P` pencil, `L` line, `A` arrow, `R` rectangle, `E` ellipse, `H` highlighter, `T` text, `N` numbered step (click to drop the next number; the palette sets the badge color), `B` blur. Press the letter again (or click the tool) to go back to moving the selection. Hold Shift for straight pencil/highlighter strokes, lines at 45° and square boxes. Right-click the rectangle (or ellipse) tool for more shapes: filled rectangle, ellipse, filled ellipse, line; right-click the arrow to switch between an open head (the default) and a filled one. Buttons with a small corner mark have such a menu.
- **Edit what you drew:** click a shape to select it, then drag to move it, drag its handles to resize, drag an arrow's ends, change its color/width in the style bar, or press Delete. Arrow keys nudge it. While dragging, shapes snap to line up with each other and the capture area (pink guides); hold ⌘ to place freely.
- **Text:** click to type. `Enter` adds a line; `⌘Enter` / `Ctrl+Enter` or `Esc` finishes (you stay in capture mode). Drag the blue frame to move the box while typing. Click text (or near it) to select and drag it; double-click to edit it again. Style (one at a time): plain, stroke (an outline, white by default), light background (black text) or dark background (white text), each with its own color swatch for the stroke or background; plus size. Text has its own color, separate from the other tools. A subtle drop shadow (10% by default) and the stroke width are in settings (`annotate.text.shadow`, `annotate.text.strokeWidth`).
- **Style bar:** colors (the rainbow swatch opens a custom color picker; custom colors are remembered until Snapkit quits), stroke width, text options, and blur (default) / pixelate with a strength slider. A blur area updates live while you move or resize it. The color square in the tool bar opens the color picker.
- **Highlighter:** has its own light colors (`annotate.highlighterPalette`).
- **Undo / redo:** `⌘Z` / `⇧⌘Z` (`Ctrl+Z` / `Ctrl+Shift+Z`).
- Hover any button for its name and shortcut.
- **History:** `⌘⇧1` (or History… in the menu bar) opens a panel of your recent copies, saves and pins. Click or Enter copies one again; E edits it (drawings and background still editable), P pins, S saves, F stars, Delete removes, Esc closes. It keeps the last 5 by default, with a size limit and an age limit (Settings → General → History; up to 100 captures / 2 GB). Starred ones are never removed by the limits. The same section shows the folder and clears history. Pause History is in the menu-bar menu. Plan and details: [docs/history.md](docs/history.md).
- **Floating preview (pin):** the pin button in the action bar turns it on for this capture (green dot); `pin.afterCopy` sets whether captures start with it on. With it on, after you copy (button or `⌘C`) the result stays as a small preview in the bottom-right corner, like Shottr. Hover it for **Copy** and **Edit**; Edit (or double-click) reopens it in the full editor with your drawings and background still editable, and **Done** puts the edited result back in the preview. Drag the image into another app to drop it as a PNG; drag the move handle (top) to move the preview. Its pin icon turns it into a full-size **pin**: always on top (every Space, over full-screen apps), drag to move, scroll to zoom, ⌥ + scroll for opacity, ⌥-drag into other apps, hover bar with zoom/opacity/copy/save, right-click menu, `Esc` to close. "Close All Pins" is in the menu-bar menu.
- **Background (beautify):** the image button in the action bar turns the background on or off for this capture; it's highlighted with a green dot while on. While it's on, copy and save include it. It starts on or off according to `beautify.applyOnCopy`.
- **Edit background:** the magic-wand button opens a full editor with a live preview and all the drawing tools, so you can finish the image there. Choose Gradient or Color (Image comes later): the colors in use are shown with editable hex values, a random button and a hue slider, above 32 gradient or 32 color presets. Also: settings presets, output size (Auto, 1:1, 16:9, 4:3, 9:16 or custom px), padding / corners / shadow. The switch at the top previews with or without the background. Esc steps back one level (stops typing, then deselects, then leaves the editor); Copy, Save or Done.

## Installing the builds

Every push to `main` builds both installers. Open the **Actions** tab, select
the latest run, and download from the **Artifacts** section. Tagging a
version (`git tag v0.1.0 && git push --tags`) also creates a Release with the
installers attached.

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
npm run typecheck
npm run build:mac  # or build:win (run on that OS)
```

Linux smoke test (Xvfb): `npm run build && xvfb-run -a node e2e/smoke.mjs`

Annotation test (macOS or Linux, uses its own profile and briefly shows the capture overlay): `npm run build && node e2e/annotate.mjs /tmp/snapkit-e2e`

Pin test: `npm run build && node e2e/pin.mjs /tmp/snapkit-pin`

Settings test: `npm run build && node e2e/settings.mjs /tmp/snapkit-settings`

History test: `npm run build && node e2e/history.mjs /tmp/snapkit-history`

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

**Settings window:** menu-bar menu → Settings… (`⌘,`, also from capture mode). Sections: General (floating preview and background defaults, saving with file naming — a text plus the date and/or a counting number before or after it, default `Snapkit <date and time>` — notifications), Shortcuts (capture hotkey, a letter per tool), Appearance (Light / Dark / System, Liquid Glass on or off, highlight color, dim, selection color, size label), Toolbar (show/hide, drag or move up/down each tool and action, with a preview; tools with styles show as a group), Tools (the five quick colors and five highlighter colors, line widths, arrow and shape defaults, text, steps, blur, highlighter), Background (the default background's padding, corners, shadow and angle; gradient and color libraries for the editor — edit, reorder, add, delete, reset, make one the default; optionally remember the last background used) and About (version, logs, settings file, reset all). Changes save and apply immediately; each section can be reset on its own.

Theme: `appearance.mode` is `system` (default), `light` or `dark`; `appearance.glass` turns Liquid Glass on (default) or off. `appearance.accent` sets a highlight color (default: white in glass, gray in dark).

Settings are stored in `settings.json` in the app's data folder (`~/Library/Application Support/Snapkit` on macOS). Only values you change are written there; everything else follows the defaults in `src/shared/settings.ts`.
