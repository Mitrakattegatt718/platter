#!/usr/bin/env bash
# Rebuild the whole app icon set from the four source renders in
# tauri-src/icons/sources/.
#
# default.png is the app's real icon: it becomes icon.icns and every sized PNG,
# so Finder, Launchpad and Spotlight show it too — and so does the Dock once the
# process is gone. gray.png, dark.png and mono.png ship as alternates in
# icons/alt/ and are only ever applied to the Dock of a running app — see
# tauri-src/src/app_icon.rs for why macOS allows nothing more than that.
#
# Adding or removing a source here means editing the ICONS manifest in
# app_icon.rs to match; its tests assert the exact set the picker offers.
#
# Needs python3 with Pillow. Run from anywhere.
set -euo pipefail

cd "$(dirname "$0")/.."
SRC=tauri-src/icons/sources
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

# The alternates, in the order the picker lists them. `default` is handled
# separately: it is the bundle icon, not an alternate.
ALTS=(gray dark mono)

# Pad to a square canvas before resizing: the generator stretches a non-square
# input rather than letterboxing it, which visibly skews the click wheel. The
# current renders are already 1024x1024, so this is a no-op for them — it is
# here so a future non-square export doesn't silently ship distorted.
python3 - "$SRC" "$TMP" default "${ALTS[@]}" <<'PY'
import sys
from PIL import Image

src, out, names = sys.argv[1], sys.argv[2], sys.argv[3:]
for name in names:
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

npm run tauri -- icon "$TMP/default_1024.png"

# The generator emits iOS and Android sets unconditionally. This app is macOS
# only, and 64x64.png is referenced by nothing in tauri.conf.json.
#
# Nothing here touches icons/icon.icon — the macOS 26 Icon Composer bundle,
# Apple's format for Liquid Glass icons. `tauri icon` does not emit it; `tauri
# build` does, from icon.png. Deleting it here would mean every build recreated
# a directory this script had just removed.
rm -rf tauri-src/icons/ios tauri-src/icons/android tauri-src/icons/64x64.png

# The alternate set is exactly what is in tauri-src/icons/alt/, and app_icon.rs
# pulls those in with include_bytes!. A file left over from an earlier layout
# would not be compiled in, only confusing — clear the directory rather than
# leave strays next to the ones that are live.
rm -f tauri-src/icons/alt/*.png
for name in "${ALTS[@]}"; do
  cp "$TMP/${name}_512.png" "tauri-src/icons/alt/${name}.png"
done

echo
echo "done. bundle icon <- sources/default.png"
echo "     alternates <- ${ALTS[*]} (icons/alt/)"
echo "rebuild with: npm run bundle"
