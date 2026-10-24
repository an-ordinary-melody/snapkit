#!/bin/bash
# Commit + push local changes, then install the new Snapkit.app into
# /Applications and open it.
#
# Usage:
#   ./scripts/update-mac.sh ["commit message"]          wait for the GitHub build, install that
#   ./scripts/update-mac.sh --local ["commit message"]  build on this Mac (about a minute), install that;
#                                                       GitHub still builds the installers in the background
set -euo pipefail
cd "$(dirname "$0")/.."
REPO=sonbq-fsc/snapkit

LOCAL=0
if [ "${1:-}" = "--local" ]; then
  LOCAL=1
  shift
fi

if [ -n "$(git status --porcelain)" ]; then
  echo "==> Committing changes"
  git add -A
  git commit -q -m "${1:-Update}"
fi
echo "==> Pushing"
git push -q

TMP=$(mktemp -d)
trap 'hdiutil detach -quiet "$TMP/mnt" 2>/dev/null || true; rm -rf "$TMP"' EXIT

if [ "$LOCAL" = 1 ]; then
  echo "==> Building on this Mac"
  [ -d node_modules ] || npm ci
  npm run -s build:dir > "$TMP/build.log" 2>&1 || { tail -30 "$TMP/build.log"; echo "Local build failed (full log above)."; exit 1; }
  APP=$(ls -d dist/mac*/Snapkit.app | head -1)
else
  SHA=$(git rev-parse HEAD)
  echo "==> Waiting for the build to start"
  RUN_ID=""
  for _ in $(seq 1 30); do
    RUN_ID=$(gh run list --repo "$REPO" --commit "$SHA" --workflow build.yml --limit 1 --json databaseId -q '.[0].databaseId' 2>/dev/null || true)
    [ -n "$RUN_ID" ] && break
    sleep 4
  done
  [ -z "$RUN_ID" ] && { echo "Build didn't start. Check the Actions tab on GitHub."; exit 1; }

  echo "==> Building on GitHub (usually 3-6 minutes; if it's stuck in the queue, rerun with --local)"
  gh run watch "$RUN_ID" --repo "$REPO" --interval 10 > /dev/null || true

  if ! gh run download "$RUN_ID" --repo "$REPO" --name Snapkit-mac --dir "$TMP"; then
    echo "The Mac build failed. Run: gh run view $RUN_ID --repo $REPO --log-failed"
    exit 1
  fi
  DMG=$(ls "$TMP"/*.dmg | head -1)
  mkdir -p "$TMP/mnt"
  hdiutil attach -nobrowse -quiet -mountpoint "$TMP/mnt" "$DMG"
  APP="$TMP/mnt/Snapkit.app"
fi

echo "==> Installing"
osascript -e 'quit app "Snapkit"' 2>/dev/null || true
sleep 1
rm -rf /Applications/Snapkit.app
cp -R "$APP" /Applications/
xattr -cr /Applications/Snapkit.app
# Each unsigned build has a new signature, so the old Screen Recording grant
# no longer applies. Clear it so macOS asks cleanly.
tccutil reset ScreenCapture com.charios.snapkit > /dev/null 2>&1 || true

open /Applications/Snapkit.app
echo "==> Done. Press ⌥⇧Z (or your capture shortcut). If macOS asks, allow Screen Recording, then quit and reopen Snapkit."
