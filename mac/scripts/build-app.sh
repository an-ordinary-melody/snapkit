#!/bin/bash
# Build Snapkit.app from the Swift package.
#   mac/scripts/build-app.sh            debug build: "Snapkit Dev.app", bundle id com.charios.snapkit.dev,
#                                       its own data folder, test hooks on
#   mac/scripts/build-app.sh release    release build: "Snapkit.app", com.charios.snapkit, universal (arm64 + x86_64)
# Output: mac/build/<name>.app, ad-hoc signed. Set DEVELOPER_DIR to pick a toolchain.
set -euo pipefail
cd "$(dirname "$0")/.."
MODE=${1:-debug}
VERSION=$(node -p "require('../package.json').version" 2>/dev/null || echo 0.0.0)

if [ "$MODE" = release ]; then
  NAME="Snapkit"; ID="com.charios.snapkit"
  ARCHS="--arch arm64 --arch x86_64"
  swift build -c release $ARCHS --product Snapkit 2>&1 | grep -vE "PlatformPath|xcrun: error" || true
  BIN=$(swift build -c release $ARCHS --show-bin-path 2>/dev/null)/Snapkit
else
  NAME="Snapkit Dev"; ID="com.charios.snapkit.dev"
  swift build --product Snapkit 2>&1 | grep -vE "PlatformPath|xcrun: error" || true
  BIN=$(swift build --show-bin-path 2>/dev/null)/Snapkit
fi
[ -x "$BIN" ] || { echo "build failed: no $BIN"; exit 1; }

APP="build/$NAME.app"
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
cp "$BIN" "$APP/Contents/MacOS/Snapkit"
cp ../resources/trayTemplate.png ../resources/trayTemplate@2x.png "$APP/Contents/Resources/"
cp ../build/AppIcon.icns "$APP/Contents/Resources/AppIcon.icns"
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
</dict>
</plist>
PLIST
codesign --force --sign - --options runtime "$APP" >/dev/null 2>&1
echo "$APP"
