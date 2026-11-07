# Snapkit for macOS (native)

The native Swift version of Snapkit's Mac app, built next to the Electron app until it can replace
it. Plan: [docs/native-mac-plan.md](../docs/native-mac-plan.md). Testing: [docs/native-mac-testing.md](../docs/native-mac-testing.md).

Status: Phase 1 (MVP). Menu bar, capture hotkey, capture mode on every display, selection with
handles and arrow-key nudging, Pencil / Arrow / Rectangle / Text, colours and stroke widths, undo /
redo, copy (exact PNG bytes) and save (naming rule and numbering), quick area capture. It reads the
same `settings.json` as the Electron app.

## Build and run

Needs Swift 5.10+ (the Command Line Tools are enough; Xcode works too).

```bash
mac/scripts/build-app.sh            # mac/build/Snapkit Dev.app (debug, test hooks on)
open "mac/build/Snapkit Dev.app"
```

`Snapkit Dev` has its own bundle id (`com.charios.snapkit.dev`) and data folder
(`~/Library/Application Support/Snapkit Dev`), so it never touches the installed Snapkit's files. The
first launch copies the real `settings.json` so it behaves like your Snapkit. It needs its own Screen
Recording permission. If the Electron Snapkit is running, both react to the same hotkeys: quit one, or
give the dev build another hotkey in its settings.json.

`mac/scripts/build-app.sh release` builds `Snapkit.app` (`com.charios.snapkit`, universal) for later
releases; don't run it next to the Electron app, it uses the same data folder.

## Test

```bash
cd mac && swift run SnapkitChecks     # unit checks on SnapkitCore (ports of the vitest cases)
node mac/e2e/run.mjs [suite …]        # flows in test mode: capture annotate output safety hotkeys
```

The flow checks run the debug app with a fixed test screen (`-SnapkitTestScreen`), an isolated
profile (`-SnapkitProfile`) and a private pasteboard (`-SnapkitTestPasteboard`), driven by
`snapkitctl` (see `Sources/Snapkit/TestHook.swift`). Capture mode really opens on screen while they run.
No Screen Recording permission is needed for either.

## Layout

| Path | What |
|---|---|
| `Sources/SnapkitCore` | Logic without UI: settings model and merge rules, feature registry, hotkey parsing, file naming, toolbar layout, annotation model, last area |
| `Sources/Snapkit` | The app: menu bar, hotkeys, capture windows (`OverlayPool`), capture mode (`OverlayView`), screen grabbing, output |
| `Sources/SnapkitChecks` | Unit checks (a plain executable until Xcode's test runner is set up) |
| `Sources/snapkitctl` | Sends test commands to a running debug build |
| `e2e/run.mjs` | Flow checks |

The toolbar icons are Lucide's (ISC licence), drawn from the same SVG paths the Electron app uses.
