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
cd mac && swift test                 # unit tests on SnapkitCore (ports of the vitest cases)
node mac/e2e/run.mjs [suite …]        # flows in test mode (all suites by default)
node mac/scripts/parity-coverage.mjs  # every Electron e2e check mapped (docs/native-mac-testing.md §2)
node mac/e2e/scene.mjs fixtures/scenes <out> --compare <electron-out>   # screenshots vs Electron
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
| `Tests/SnapkitCoreTests` | Unit tests (Swift Testing) |
| `Sources/snapkitctl` | Sends test commands to a running debug build |
| `e2e/run.mjs` | Flow checks |

Shared with the Electron app: `fixtures/default-settings.json` and `fixtures/features.json` (written by
`npm run fixtures`). `scripts/sync-fixtures.sh` (run by `build-app.sh`) generates the native defaults from
the first; the unit tests fail if either file and the Swift side differ.

The toolbar icons are Lucide's (ISC licence), drawn from the same SVG paths the Electron app uses.

## Credits

Sparkle (MIT), UPNG.js (MIT), Lucide (ISC) and Snapzy (BSD-3-Clause, ideas): see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). The app lists them under Settings → About → Acknowledgements.

## Updates (Sparkle)

Release builds update through [Sparkle 2](https://sparkle-project.org). A build gets Sparkle when
`scripts/sparkle.env` (or the environment) has both `SPARKLE_PUBLIC_KEY` and `SPARKLE_FEED_URL`;
otherwise it keeps the GitHub-releases check (notify and download). Debug builds have neither.

One-time setup (yours; the private key never goes in the repo):

1. Download Sparkle's tools (`Sparkle-<version>.tar.xz` from its GitHub releases) and run
   `bin/generate_keys`. It keeps the private key in your login keychain and prints the public key.
2. Put the public key in `scripts/sparkle.env` as `SPARKLE_PUBLIC_KEY` (not a secret).
3. Export the private key (`bin/generate_keys -x private-key.txt`), save it as the GitHub Actions
   secret `SPARKLE_PRIVATE_KEY`, keep an offline backup, then delete the file. Losing it means
   existing installs can't verify updates any more.
4. Decide where `appcast.xml` and the zips live and set `SPARKLE_FEED_URL` (release work).

Per release: `scripts/build-app.sh release`, then
`SPARKLE_PRIVATE_KEY=… scripts/sparkle-release.sh build/Snapkit.app <out> <download-base-url>` writes the
signed zip and `appcast.xml`. `node mac/e2e/sparkle-update.mjs` tests the whole path with a throwaway key:
an older build finds, downloads, verifies and installs a newer one, and refuses one signed with another key.

The app is signed with the hardened runtime plus `com.apple.security.cs.disable-library-validation`
(`Snapkit.entitlements`): ad-hoc and self-signed builds have no Apple team, and without it the app
can't load its own Sparkle.framework.
