#!/bin/bash
# Commit + push local changes, wait for the GitHub build, then install the new
# Snapkit.app into /Applications and open it.
# Usage: ./scripts/update-mac.sh ["commit message"]
set -euo pipefail
cd "$(dirname "$0")/.."
REPO=sonbq-fsc/snapkit

if [ -n "$(git status --porcelain)" ]; then
  echo "==> Committing changes"
  git add -A
  git commit -q -m "${1:-Update}"
fi
echo "==> Pushing"
git push -q

SHA=$(git rev-parse HEAD)
echo "==> Waiting for the build to start"
RUN_ID=""
for _ in $(seq 1 30); do
  RUN_ID=$(gh run list --repo "$REPO" --commit "$SHA" --workflow build.yml --limit 1 --json databaseId -q '.[0].databaseId' 2>/dev/null || true)
  [ -n "$RUN_ID" ] && break
  sleep 4
done
[ -z "$RUN_ID" ] && { echo "Build didn't start. Check the Actions tab on GitHub."; exit 1; }

echo "==> Building (usually 3-6 minutes)"
gh run watch "$RUN_ID" --repo "$REPO" --interval 10 > /dev/null || true

TMP=$(mktemp -d)
if ! gh run download "$RUN_ID" --repo "$REPO" --name Snapkit-mac --dir "$TMP"; then
  echo "The Mac build failed. Run: gh run view $RUN_ID --repo $REPO --log-failed"
  exit 1
fi
DMG=$(ls "$TMP"/*.dmg | head -1)

echo "==> Installing"
osascript -e 'quit app "Snapkit"' 2>/dev/null || true
sleep 1
MNT="$TMP/mnt"
mkdir -p "$MNT"
hdiutil attach -nobrowse -quiet -mountpoint "$MNT" "$DMG"
rm -rf /Applications/Snapkit.app
cp -R "$MNT/Snapkit.app" /Applications/
hdiutil detach -quiet "$MNT"
xattr -cr /Applications/Snapkit.app
# Each unsigned build has a new signature, so the old Screen Recording grant
# no longer applies. Clear it so macOS asks cleanly.
tccutil reset ScreenCapture com.charios.snapkit > /dev/null 2>&1 || true
rm -rf "$TMP"

open /Applications/Snapkit.app
echo "==> Done. Press ⌘⇧2. If macOS asks, allow Screen Recording, then quit and reopen Snapkit."
