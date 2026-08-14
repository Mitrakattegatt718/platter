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
APP="${1:-$BUNDLE/macos/Platter.app}"
BIN="$APP/Contents/MacOS/platter-tauri"
FRAMEWORKS="$APP/Contents/Frameworks"

[ -x "$BIN" ] || { echo "error: $BIN not found — run 'npm run tauri build' first" >&2; exit 1; }

# Refuse to run twice against the same build. dylibbundler runs with -od
# ("overwrite output dir"): a second pass empties Contents/Frameworks and then
# cannot refill it, because the binaries now reference @executable_path paths it
# can no longer resolve back to the originals. What is left still passes an
# install-name check — nothing points at /opt/homebrew any more — while having
# no libraries at all. Fail loudly instead of shipping that.
if otool -L "$BIN" | tail -n +2 | grep -q '@executable_path/../Frameworks/'; then
  echo "error: $(basename "$APP") has already been bundled." >&2
  echo "       Re-running would wipe Contents/Frameworks. Rebuild first:" >&2
  echo "           npm run bundle" >&2
  exit 1
fi

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
# Every Mach-O we ship — the three executables AND the whole copied-in dylib
# chain — has to satisfy both halves. Checking only the executables, or only the
# install names, is how a bundle that cannot possibly run still gets a green
# tick: "no /opt/homebrew references" is equally true of an app whose
# Frameworks directory is empty.
BAD='/opt/homebrew|/usr/local/Cellar|/Users/'
fail=0

[ -d "$FRAMEWORKS" ] && [ -n "$(ls -A "$FRAMEWORKS" 2>/dev/null)" ] || {
  echo "error: $FRAMEWORKS is empty — dylibbundler copied nothing" >&2
  exit 1
}

while IFS= read -r macho; do
  case "$(file -b "$macho")" in *Mach-O*) ;; *) continue ;; esac
  name="$(basename "$macho")"
  # tail -n +2 drops otool's header line, which is the binary's OWN path. This
  # repo lives under /Users, so grepping the header made the check match itself
  # and fail every run no matter how clean the dependencies were.
  deps="$(otool -L "$macho" | tail -n +2 | awk '{print $1}')"

  if printf '%s\n' "$deps" | grep -qE "$BAD"; then
    echo "error: $name still references a build-machine path" >&2
    printf '%s\n' "$deps" | grep -E "$BAD" | sed 's/^/       /' >&2
    fail=1
  fi

  while IFS= read -r dep; do
    case "$dep" in
      @executable_path/../Frameworks/*)
        lib="${dep#@executable_path/../Frameworks/}"
        [ -e "$FRAMEWORKS/$lib" ] || {
          echo "error: $name needs $lib, which is not in Contents/Frameworks" >&2
          fail=1
        } ;;
    esac
  done <<< "$deps"
done < <(find "$APP/Contents/MacOS" "$FRAMEWORKS" -type f)

[ "$fail" -eq 0 ] || exit 1

echo "==> Repacking DMG"
DMG="$BUNDLE/dmg/Platter_self-contained.dmg"
mkdir -p "$BUNDLE/dmg"
rm -f "$DMG"
hdiutil create -volname Platter -srcfolder "$APP" -ov -format UDZO "$DMG" > /dev/null

echo "==> Done"
echo "    app: $APP"
echo "    dmg: $DMG"
