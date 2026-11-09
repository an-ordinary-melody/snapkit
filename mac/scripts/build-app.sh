#!/bin/bash
# Build Snapkit.app from the Swift package.
#   mac/scripts/build-app.sh            debug build: "Snapkit Dev.app", bundle id com.charios.snapkit.dev,
#                                       its own data folder, test hooks on
#   mac/scripts/build-app.sh release    release build: "Snapkit.app", com.charios.snapkit, universal (arm64 + x86_64)
# Output: mac/build/<name>.app, signed with "Snapkit Self-Signed" when the Keychain has it, else ad-hoc
# (SIGN_IDENTITY picks another). Sparkle keys come
# from scripts/sparkle.env. Set DEVELOPER_DIR to pick a toolchain.
set -euo pipefail
cd "$(dirname "$0")/.."
MODE=${1:-debug}
scripts/sync-fixtures.sh
VERSION=$(node -p "require('../package.json').version" 2>/dev/null || echo 0.0.0)

if [ "$MODE" = release ]; then
  NAME="Snapkit"; ID="com.charios.snapkit"
  ARCHS="--arch arm64 --arch x86_64"
  st=0; out=$(swift build -c release $ARCHS --product Snapkit 2>&1) || st=$?
  echo "$out" | grep -vE "PlatformPath|xcrun: error" || true
  [ $st = 0 ] || { echo "build failed"; exit 1; }
  BIN=$(swift build -c release $ARCHS --show-bin-path 2>/dev/null)/Snapkit
else
  NAME="Snapkit Dev"; ID="com.charios.snapkit.dev"
  st=0; out=$(swift build --product Snapkit 2>&1) || st=$?
  echo "$out" | grep -vE "PlatformPath|xcrun: error" || true
  [ $st = 0 ] || { echo "build failed"; exit 1; }
  BIN=$(swift build --show-bin-path 2>/dev/null)/Snapkit
fi
[ -x "$BIN" ] || { echo "build failed: no $BIN"; exit 1; }

APP="build/$NAME.app"
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
cp "$BIN" "$APP/Contents/MacOS/Snapkit"
# SwiftPM's build system records the deployment target (14.0) as the SDK the app was built with, so
# macOS draws its controls the pre-macOS 26 way (no Liquid Glass knob on sliders and switches). Record
# the SDK actually used; the minimum macOS stays as built.
MINOS=$(otool -l "$BIN" | awk '/LC_BUILD_VERSION/{f=1} f&&/minos/{print $2; exit}')
SDKV=$(xcrun --sdk macosx --show-sdk-version)
vtool -set-build-version macos "$MINOS" "$SDKV" -replace -output "$APP/Contents/MacOS/Snapkit" "$APP/Contents/MacOS/Snapkit"
cp ../resources/trayTemplate.png ../resources/trayTemplate@2x.png "$APP/Contents/Resources/"
cp ../build/AppIcon.icns "$APP/Contents/Resources/AppIcon.icns"
# The pictures under the Liquid Glass Settings window (made with InstantGradient, whose exports are ours to use).
cp Resources/glass-light.jpg Resources/glass-dark.jpg "$APP/Contents/Resources/"
# The licences of the open-source parts travel with every copy (MIT/ISC require it); not shown in the app.
cp THIRD_PARTY_NOTICES.md "$APP/Contents/Resources/"
# Sparkle.framework (updates), next to the binary it was linked against; ditto keeps its symlinks.
mkdir -p "$APP/Contents/Frameworks"
ditto "$(dirname "$BIN")/Sparkle.framework" "$APP/Contents/Frameworks/Sparkle.framework"
# Debug builds (com.charios.snapkit.dev) never update from the release feed: they get Sparkle keys only
# when SPARKLE_FEED_URL is given (e2e/sparkle-update.mjs sets its own in Info.plist).
GIVEN_FEED=${SPARKLE_FEED_URL:-}
. scripts/sparkle.env
[ "$MODE" = release ] || SPARKLE_FEED_URL=$GIVEN_FEED
SPARKLE_KEYS=""
if [ -n "$SPARKLE_PUBLIC_KEY" ] && [ -n "$SPARKLE_FEED_URL" ]; then
  SPARKLE_KEYS="<key>SUPublicEDKey</key><string>$SPARKLE_PUBLIC_KEY</string>
  <key>SUFeedURL</key><string>$SPARKLE_FEED_URL</string>
  <key>SUEnableAutomaticChecks</key><false/>"
fi
cat > "$APP/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleIdentifier</key><string>$ID</string>
  <key>CFBundleName</key><string>$NAME</string>
  <key>CFBundleDisplayName</key><string>$NAME</string>
  <key>CFBundleExecutable</key><string>Snapkit</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>$VERSION</string>
  <key>CFBundleVersion</key><string>$VERSION</string>
  <key>CFBundleIconFile</key><string>AppIcon</string>
  <key>LSMinimumSystemVersion</key><string>14.0</string>
  <key>LSUIElement</key><true/>
  <key>LSAppNapIsDisabled</key><true/>
  <key>NSHighResolutionCapable</key><true/>
  <key>NSScreenCaptureUsageDescription</key><string>Snapkit needs to record the screen to take screenshots.</string>
  $SPARKLE_KEYS
</dict>
</plist>
PLIST
# Inside out, as Sparkle's docs say: its helpers, the framework, then the app.
# The self-signed certificate when this Mac has it (same signature every build, so macOS keeps the
# Screen Recording permission); otherwise ad-hoc ("-"). SIGN_IDENTITY overrides both.
CERT="Snapkit Self-Signed"
if [ -z "${SIGN_IDENTITY:-}" ] && security find-identity -p codesigning 2>/dev/null | grep -q "\"$CERT\""; then SIGN_IDENTITY="$CERT"; fi
SIGN=${SIGN_IDENTITY:--}
FW="$APP/Contents/Frameworks/Sparkle.framework/Versions/B"
codesign -f -s "$SIGN" -o runtime "$FW/XPCServices/Installer.xpc"
codesign -f -s "$SIGN" -o runtime --preserve-metadata=entitlements "$FW/XPCServices/Downloader.xpc"
codesign -f -s "$SIGN" -o runtime "$FW/Autoupdate"
codesign -f -s "$SIGN" -o runtime "$FW/Updater.app"
codesign -f -s "$SIGN" -o runtime "$APP/Contents/Frameworks/Sparkle.framework"
codesign -f -s "$SIGN" -o runtime --entitlements Snapkit.entitlements "$APP"
echo "$APP"
