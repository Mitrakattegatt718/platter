#!/usr/bin/env bash
# Stages ffmpeg + ffprobe into tauri-src/binaries/ as Tauri sidecars, so the
# built .app carries them and the user needs no Homebrew install.
#
#   ./stage-ffmpeg.sh                 # take them from PATH / Homebrew
#   ./stage-ffmpeg.sh /path/to/build  # take them from a directory you built
#
# Tauri's externalBin wants the target triple appended to each filename;
# tauri-build strips it again when it copies them into Contents/MacOS.
#
# LICENSING — read this before shipping anything built with it.
# Homebrew's ffmpeg is configured --enable-gpl (it pulls in x264/x265), which
# makes it GPLv3. Putting that inside a closed-source app makes you a
# distributor with the full corresponding-source obligation, and rules out the
# Mac App Store. This script REFUSES a GPL build unless you set
# ALLOW_GPL_FFMPEG=1, which is only defensible for local development.
# See .github/workflows/release.yml for an LGPL configure line that loses nothing this
# app uses and is a third of the size.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEST="$ROOT/tauri-src/binaries"
TRIPLE="$(rustc -vV | sed -n 's/^host: //p')"
[ -n "$TRIPLE" ] || { echo "error: could not determine the rust host triple" >&2; exit 1; }

SRC_DIR="${1:-}"
resolve() {
  local name="$1"
  if [ -n "$SRC_DIR" ]; then
    echo "$SRC_DIR/$name"
  else
    command -v "$name" || return 1
  fi
}

mkdir -p "$DEST"
for name in ffmpeg ffprobe; do
  src="$(resolve "$name")" || { echo "error: $name not found" >&2; exit 1; }
  # Follow the Homebrew symlink so we copy the real Mach-O, not a link.
  src="$(readlink -f "$src" 2>/dev/null || python3 -c 'import os,sys;print(os.path.realpath(sys.argv[1]))' "$src")"
  [ -x "$src" ] || { echo "error: $src is not executable" >&2; exit 1; }
  cp -f "$src" "$DEST/$name-$TRIPLE"
  chmod +w "$DEST/$name-$TRIPLE"
  echo "staged $name  <- $src"
done

CONF="$("$DEST/ffmpeg-$TRIPLE" -hide_banner -buildconf 2>/dev/null || true)"
if grep -qE -- '--enable-(gpl|nonfree)' <<<"$CONF"; then
  if [ "${ALLOW_GPL_FFMPEG:-0}" = "1" ]; then
    echo "warning: staging a GPL/nonfree ffmpeg because ALLOW_GPL_FFMPEG=1." >&2
    echo "         Do not ship a DMG built from this. See .github/workflows/release.yml" >&2
    echo "         for the LGPL configure line." >&2
  else
    echo >&2
    echo "error: this ffmpeg is built with --enable-gpl or --enable-nonfree." >&2
    echo "       Bundling it would make Platter a GPLv3 distributor." >&2
    echo "       Build an LGPL ffmpeg (configure line in release.yml), or re-run with" >&2
    echo "       ALLOW_GPL_FFMPEG=1 for local development only." >&2
    rm -f "$DEST/ffmpeg-$TRIPLE" "$DEST/ffprobe-$TRIPLE"
    exit 1
  fi
fi

# Encoders the converter offers. A trimmed build that dropped one greys the
# format out at runtime rather than failing at the end of a long job, but it
# is better to know now.
for enc in alac aac flac pcm_s16be pcm_s16le; do
  "$DEST/ffmpeg-$TRIPLE" -hide_banner -encoders 2>/dev/null | grep -qE "^ [A-Z.]+ $enc " \
    || echo "warning: no '$enc' encoder — that output format will be unavailable" >&2
done
grep -q -- '--enable-libmp3lame' <<<"$CONF" \
  || echo "warning: no libmp3lame — MP3 output will be unavailable" >&2

echo "done. next: npm run tauri build && ./bundle-dylibs.sh"
