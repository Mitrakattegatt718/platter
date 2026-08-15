#!/usr/bin/env bash
# Rebuild the whole app icon set from the two source renders in
# tauri-src/icons/sources/.
#
# dark.png is the app's real icon: it becomes icon.icns and every sized PNG,
# so Finder, Launchpad and Spotlight show it too — and so does the Dock once
# the process is gone. light.png ships as the single alternate in icons/alt/ and
# is only ever applied to the Dock of a running app — see
# tauri-src/src/app_icon.rs for why macOS allows nothing more than that.
#
# Needs python3 with Pillow. Run from anywhere.
set -euo pipefail

cd "$(dirname "$0")/.."
SRC=tauri-src/icons/sources
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

# The renders are 360x363 — neither square nor anywhere near the 1024 an .icns
# wants. Pad to a square canvas first: the generator stretches a non-square
# input rather than letterboxing it, which visibly skews the click wheel.
python3 - "$SRC" "$TMP" <<'PY'
import sys
from PIL import Image

src, out = sys.argv[1], sys.argv[2]
for name in ("light", "dark"):
    im = Image.open(f"{src}/{name}.png").convert("RGBA")
    w, h = im.size
    side = max(w, h)
    canvas = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    canvas.paste(im, ((side - w) // 2, (side - h) // 2), im)
    canvas.resize((1024, 1024), Image.LANCZOS).save(f"{out}/{name}_1024.png", optimize=True)
    # 512 is plenty for the Dock (256px at 2x) and keeps the base64 preview
    # the picker fetches over IPC small.
    canvas.resize((512, 512), Image.LANCZOS).save(f"{out}/{name}_512.png", optimize=True)
    print(f"{name}: {w}x{h} -> square {side} -> 1024 + 512")
PY

npm run tauri -- icon "$TMP/dark_1024.png"

# The generator emits iOS and Android sets unconditionally. This app is macOS
# only, and 64x64.png is referenced by nothing in tauri.conf.json.
rm -rf tauri-src/icons/ios tauri-src/icons/android tauri-src/icons/64x64.png

# The alternate set is exactly what is in tauri-src/icons/alt/, and app_icon.rs
# pulls those in with include_bytes!. A file left over from an earlier layout
# would not be compiled in, only confusing — drop it rather than leave it next to the
# one that is live.
rm -f tauri-src/icons/alt/dark.png
cp "$TMP/light_512.png" tauri-src/icons/alt/light.png

echo
echo "done. bundle icon <- sources/dark.png, icons/alt/light.png <- sources/light.png"
echo "rebuild with: npm run bundle"
