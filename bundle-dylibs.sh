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
# ONE invocation with three -x, never three invocations. -od means "overwrite
# the output directory": a second dylibbundler run against the same -d erases
# what the first produced, so splitting ffmpeg into its own call would silently
# delete libgpod and the GLib chain. The app would then fail at first iPod
# access rather than at build time.
#
# @executable_path resolves per spawned process, and all three binaries sit at
# Contents/MacOS — depth 1 — so the one prefix is correct for all of them.
FF_ARGS=()
for side in ffmpeg ffprobe; do
  if [ -x "$APP/Contents/MacOS/$side" ]; then
    FF_ARGS+=(-x "$APP/Contents/MacOS/$side")
  else
    echo "    note: $side sidecar not present — run ./stage-ffmpeg.sh to bundle it"
  fi
done

dylibbundler -od -b \
  -x "$BIN" \
  "${FF_ARGS[@]}" \
  -d "$FRAMEWORKS" \
  -p '@executable_path/../Frameworks/' \
  -s "$HOME/.local/lib" \
  -s "$(brew --prefix)/lib" \
  > /dev/null

echo "==> Re-signing"
# After dylibbundler, never before: it ad-hoc re-signs each binary it rewrites,
# and anything rewritten after the app is signed breaks the CodeResources seal.
codesign --force --deep --sign - "$APP"

echo "==> Verifying"
# A corrupted signature still executes until the tampered page faults in, so
# "ffmpeg -version worked" is not evidence the pipeline is sound.
codesign --verify --deep --strict "$APP"
for b in podsync-tauri ffmpeg ffprobe; do
  [ -x "$APP/Contents/MacOS/$b" ] || continue
  if otool -L "$APP/Contents/MacOS/$b" | grep -qE '/opt/homebrew|/usr/local/Cellar|/Users/'; then
    echo "error: $b still references a build-machine path" >&2
    otool -L "$APP/Contents/MacOS/$b" | grep -E '/opt/homebrew|/usr/local/Cellar|/Users/' >&2
    exit 1
  fi
done

echo "==> Repacking DMG"
DMG="$BUNDLE/dmg/PodSync_self-contained.dmg"
mkdir -p "$BUNDLE/dmg"
rm -f "$DMG"
hdiutil create -volname PodSync -srcfolder "$APP" -ov -format UDZO "$DMG" > /dev/null

echo "==> Done"
echo "    app: $APP"
echo "    dmg: $DMG"
