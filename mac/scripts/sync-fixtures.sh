#!/bin/bash
# Regenerate Sources/SnapkitCore/DefaultSettings.swift from the shared fixture
# fixtures/default-settings.json (the Electron app's macOS defaults, written by `npm run fixtures`).
# Run by build-app.sh; SnapkitChecks fails if the two differ.
set -euo pipefail
cd "$(dirname "$0")/.."
SRC=../fixtures/default-settings.json
OUT=Sources/SnapkitCore/DefaultSettings.swift
NEW=$({
  echo "// Generated from fixtures/default-settings.json by mac/scripts/sync-fixtures.sh: don't edit."
  echo "// That file is the Electron app's macOS defaults (defaultsFor('darwin') in src/shared/settings.ts)."
  echo
  echo 'let defaultSettingsJSON = #"""'
  cat "$SRC"
  echo '"""#'
})
if [ ! -f "$OUT" ] || [ "$NEW" != "$(cat "$OUT")" ]; then
  printf '%s\n' "$NEW" > "$OUT"
  echo "updated $OUT"
fi
