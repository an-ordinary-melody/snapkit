#!/bin/bash
# Builds the native Mac release on this Mac (it has the "Snapkit Self-Signed" certificate and the
# Sparkle private key in its Keychain; neither is ever committed) and packages it for a GitHub release:
#   dist-mac/Snapkit-<version>-mac.dmg  the site's download (universal: Apple Silicon and Intel)
#   dist-mac/Snapkit-<version>.zip      what Sparkle downloads to update in place
#   site/public/appcast.xml             the update feed, served by the site (commit it)
# Usage: scripts/release-mac.sh   (version from package.json; then attach the dmg and zip to v<version>)
set -euo pipefail
cd "$(dirname "$0")/.."
VERSION=$(node -p "require('./package.json').version")
REPO=an-ordinary-melody/snapkit
OUT=$PWD/dist-mac
rm -rf "$OUT" && mkdir -p "$OUT"

mac/scripts/build-app.sh release
APP=$PWD/mac/build/Snapkit.app
[[ "$(codesign -dvv "$APP" 2>&1)" == *"Authority=Snapkit Self-Signed"* ]] || { echo "$APP isn't signed with Snapkit Self-Signed"; exit 1; }
[ "$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$APP/Contents/Info.plist")" = "$VERSION" ] || { echo "version mismatch"; exit 1; }
/usr/libexec/PlistBuddy -c 'Print :SUFeedURL' "$APP/Contents/Info.plist" >/dev/null || { echo "no Sparkle feed in Info.plist"; exit 1; }

# The DMG: the app and a shortcut to Applications to drag it onto.
STAGE=$(mktemp -d)
trap 'rm -rf "$STAGE"' EXIT
ditto "$APP" "$STAGE/Snapkit.app"
ln -s /Applications "$STAGE/Applications"
hdiutil create -quiet -volname "Snapkit" -srcfolder "$STAGE" -fs HFS+ -format UDZO "$OUT/Snapkit-$VERSION-mac.dmg"

# The Sparkle zip (signed with the EdDSA key) and a one-item feed pointing at the release.
mac/scripts/sparkle-release.sh "$APP" "$OUT" "https://github.com/$REPO/releases/download/v$VERSION" "https://github.com/$REPO/releases/tag/v$VERSION"
mv "$OUT/appcast.xml" site/public/appcast.xml
ls -la "$OUT" site/public/appcast.xml
