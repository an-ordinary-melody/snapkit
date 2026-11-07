#!/bin/bash
# Package a release build for Sparkle: zip it, sign the zip with the EdDSA private key, and write a
# one-item appcast.xml. Where the zip and appcast are hosted is release work (not decided yet).
#   mac/scripts/sparkle-release.sh <Snapkit.app> <out-dir> <download-base-url> [notes-url]
# The private key: your login Keychain on this Mac (where generate_keys put it; macOS may ask to
# allow access), or SPARKLE_PRIVATE_KEY (base64, e.g. a GitHub Actions secret), which is written to a
# temporary file for sign_update and deleted after. Sparkle's tools are downloaded from its release.
# Versions with a "-" (0.3.0-beta.1) go to the "beta" channel, which only beta users see.
set -euo pipefail
APP=${1:?app}; OUT=${2:?out dir}; BASE=${3:?download base url}; NOTES=${4:-}
cd "$(dirname "$0")/.."
SPARKLE_VERSION=$(sed -n 's/.*sparkle-project\/Sparkle.*from: "\([0-9.]*\)".*/\1/p' Package.swift)

WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
curl -fsSL "https://github.com/sparkle-project/Sparkle/releases/download/$SPARKLE_VERSION/Sparkle-$SPARKLE_VERSION.tar.xz" -o "$WORK/sparkle.tar.xz"
mkdir "$WORK/sparkle" && tar -xJf "$WORK/sparkle.tar.xz" -C "$WORK/sparkle"

INFO="$APP/Contents/Info.plist"
VERSION=$(/usr/libexec/PlistBuddy -c "Print :CFBundleVersion" "$INFO")
SHORT=$(/usr/libexec/PlistBuddy -c "Print :CFBundleShortVersionString" "$INFO")
MIN=$(/usr/libexec/PlistBuddy -c "Print :LSMinimumSystemVersion" "$INFO")
/usr/libexec/PlistBuddy -c "Print :SUPublicEDKey" "$INFO" >/dev/null 2>&1 || { echo "$APP has no SUPublicEDKey: set it in scripts/sparkle.env"; exit 1; }

mkdir -p "$OUT"
ZIP="Snapkit-$SHORT.zip"
ditto -c -k --sequesterRsrc --keepParent "$APP" "$OUT/$ZIP"
# sign_update prints: sparkle:edSignature="…" length="…"
if [ -n "${SPARKLE_PRIVATE_KEY:-}" ]; then
  ( umask 077; printf '%s' "$SPARKLE_PRIVATE_KEY" > "$WORK/key" )
  ATTRS=$("$WORK/sparkle/bin/sign_update" --ed-key-file "$WORK/key" "$OUT/$ZIP")
  rm -f "$WORK/key"
else
  ATTRS=$("$WORK/sparkle/bin/sign_update" "$OUT/$ZIP") || { echo "no private key: set SPARKLE_PRIVATE_KEY or run generate_keys on this Mac"; exit 1; }
fi

CHANNEL=""
case "$SHORT" in *-*) CHANNEL="      <sparkle:channel>beta</sparkle:channel>" ;; esac
NOTES_TAG=""
[ -n "$NOTES" ] && NOTES_TAG="      <sparkle:releaseNotesLink>$NOTES</sparkle:releaseNotesLink>"
cat > "$OUT/appcast.xml" <<XML
<?xml version="1.0" encoding="utf-8"?>
<rss version="2.0" xmlns:sparkle="http://www.andymatuschak.org/xml-namespaces/sparkle">
  <channel>
    <title>Snapkit</title>
    <item>
      <title>$SHORT</title>
      <pubDate>$(LC_ALL=C date -u "+%a, %d %b %Y %H:%M:%S +0000")</pubDate>
      <sparkle:version>$VERSION</sparkle:version>
      <sparkle:shortVersionString>$SHORT</sparkle:shortVersionString>
      <sparkle:minimumSystemVersion>$MIN</sparkle:minimumSystemVersion>
$CHANNEL
$NOTES_TAG
      <enclosure url="$BASE/$ZIP" type="application/octet-stream" $ATTRS/>
    </item>
  </channel>
</rss>
XML
echo "$OUT/$ZIP"
echo "$OUT/appcast.xml"
