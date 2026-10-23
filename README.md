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
| 3 | Annotations (pen, arrow, shapes, text, blur, steps, undo) | ⏳ |
| 4 | Background, padding, radius presets + apply-on-copy | ⏳ |
| 5 | Pin to screen | ⏳ |
| 6 | Capture history (floating panel, copy back) | ⏳ |
| 7 | Settings UI + full customization | ⏳ |
| 8 | Launch at login, update notifications | ⏳ |

## Using it

- **Capture:** `⌘⇧2` on macOS or `Ctrl+Shift+2` on Windows, or click the tray icon.
- **Select:** drag to select. Drag inside the selection to move it, and drag the handles to resize. Arrow keys nudge the selection (hold Shift for 10px; hold Alt to resize).
- **Copy:** `⌘C` / `Ctrl+C` or `Enter`.
- **Save:** `⌘S` / `Ctrl+S`. Screenshots go to `Pictures/Snapkit` by default.
- **Cancel:** `Esc` or right-click.

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

### Layout

- `src/shared/features.ts`: **feature registry**. Every tool and action is declared here, and the toolbars render from it filtered by settings.
- `src/shared/settings.ts`: settings schema, defaults and merge logic.
- `src/main/`: tray, hotkey, screen capture (`node-screenshots` with a `desktopCapturer` fallback), overlay window manager, copy/save.
- `src/renderer/src/overlay/`: capture-mode UI. `layout.ts` holds the toolbar placement algorithm and has unit tests.
