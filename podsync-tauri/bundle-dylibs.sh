#!/usr/bin/env bash
# Makes the built .app self-contained: copies libgpod and its GLib dependency
# chain (from ~/.local and Homebrew) into Contents/Frameworks and rewrites the
# install names, so the app runs on Macs without those libraries. Then
# re-signs and repacks the DMG, since the one tauri build produced contains
# the un-patched app.
#
# Run after `npm run tauri build`:
#   ./bundle-dylibs.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BUNDLE="$ROOT/src-tauri/target/release/bundle"
APP="${1:-$BUNDLE/macos/PodSync.app}"
BIN="$APP/Contents/MacOS/podsync-tauri"
FRAMEWORKS="$APP/Contents/Frameworks"

[ -x "$BIN" ] || { echo "error: $BIN not found — run 'npm run tauri build' first" >&2; exit 1; }

echo "==> Bundling dylibs into $FRAMEWORKS"
dylibbundler -od -b \
  -x "$BIN" \
  -d "$FRAMEWORKS" \
  -p '@executable_path/../Frameworks/' \
  -s "$HOME/.local/lib" \
  -s "$(brew --prefix)/lib" \
  > /dev/null

echo "==> Re-signing"
codesign --force --deep --sign - "$APP"

echo "==> Repacking DMG"
DMG="$BUNDLE/dmg/PodSync_self-contained.dmg"
mkdir -p "$BUNDLE/dmg"
rm -f "$DMG"
hdiutil create -volname PodSync -srcfolder "$APP" -ov -format UDZO "$DMG" > /dev/null

echo "==> Done"
echo "    app: $APP"
echo "    dmg: $DMG"
