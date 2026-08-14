#!/usr/bin/env bash
# Create mock removable volumes for testing device detection and drive import.
#
# Two kinds:
#
#   iPods    — UDRW FAT32 images with the iPod_Control layout and a SysInfo
#              carrying a real ModelNumStr, which is all libgpod needs to
#              identify a device (gpod_probe_device in bridging/GpodHelpers.c).
#              They hold no tracks; the point is the picker's model column and
#              the unsupported-device path. For a fixture with a real library
#              use PodSim + `cargo run --example seed_podsim`.
#
#   drives   — plain volumes with generated audio and no iPod_Control at all:
#              a USB stick laid out the way a person would, and a generic MP3
#              player with the MUSIC/ layout those use. These are what exercise
#              "Import from Drive" and the FLAC-to-ALAC conversion path.
#
# The model numbers below come from libgpod's own table, not from guesswork: it
# stores them abbreviated (MB145 -> "B145"), so SysInfo needs the full form.
#
# Caveat worth knowing: a real Touch never mounts as a disk at all, so that one
# is synthetic and exists purely to exercise the "identified but unmanageable"
# branch. A Shuffle really does mount like this.
#
# Usage: ./make-mock-devices.sh [create|attach|detach|destroy]
set -euo pipefail

DIR="$HOME/VirtualPods"
SIZE=128m
FFMPEG="$(cd "$(dirname "$0")" && pwd)/src-tauri/binaries/ffmpeg-aarch64-apple-darwin"

# name|volume label (<=11 chars for FAT)|ModelNumStr|what it should identify as
IPODS=(
  "MockRegular|PODREGULAR|M9282|Grayscale, Regular 4th Gen, 20 GB - manageable"
  "MockClassic|PODCLASSIC|MB145|Classic (Silver), 160 GB - manageable"
  "MockShuffle|PODSHUFFLE|MA546|Shuffle (Silver) 2nd Gen, 1 GB - supported via iTunesSD"
  "MockTouch|PODTOUCH|MA623|Touch (Silver), 8 GB - UNSUPPORTED"
)

DRIVES=(
  "MockUsbStick|MOCKUSB|plain USB stick, human folder layout"
  "MockPlayer|MOCKPLAYER|generic MP3 player, MUSIC/ layout"
)

# Short sine tones rather than real music: the scanner and tag reader only care
# that the container and tags are valid, and 3 seconds keeps a whole mock drive
# under a megabyte. Distinct frequencies make it obvious which file is playing
# if one ever ends up on a device.
make_track() {
    local out=$1 title=$2 artist=$3 album=$4 tracknr=$5 codec=$6 freq=$7
    mkdir -p "$(dirname "$out")"
    local args=(-hide_banner -loglevel error -y
        -f lavfi -i "sine=frequency=$freq:duration=3:sample_rate=44100" -ac 2
        -metadata "title=$title" -metadata "artist=$artist"
        -metadata "album=$album" -metadata "albumartist=$artist"
        -metadata "track=$tracknr" -metadata "date=2024" -metadata "genre=Electronic")
    case "$codec" in
        mp3)  args+=(-c:a libmp3lame -b:a 192k) ;;
        flac) args+=(-c:a flac) ;;
        *) echo "unknown codec $codec" >&2; return 1 ;;
    esac
    "$FFMPEG" "${args[@]}" "$out"
}

populate_usb() {
    local root=$1/Music
    local f=220
    local n=1
    for t in Harbour Lantern Undertow; do
        make_track "$root/Blue Signal/Night Harbour/0$n $t.mp3" \
            "$t" "Blue Signal" "Night Harbour" "$n" mp3 "$f"
        f=$((f + 40)); n=$((n + 1))
    done
    # FLAC on purpose: this is the album that has to convert to Apple Lossless
    # on import, which is the slower and more interesting path.
    n=1
    for t in Longwave Meridian Drift; do
        make_track "$root/The Meridians/Long Wave/0$n $t.flac" \
            "$t" "The Meridians" "Long Wave" "$n" flac "$f"
        f=$((f + 40)); n=$((n + 1))
    done
    n=1
    for t in Grain Static; do
        make_track "$root/Nova Static/Grain/0$n $t.mp3" \
            "$t" "Nova Static" "Grain" "$n" mp3 "$f"
        f=$((f + 40)); n=$((n + 1))
    done
}

populate_player() {
    local root=$1
    local f=300
    local n=1
    for t in "Field Notes" "Second Light" "Passage"; do
        make_track "$root/MUSIC/KESTREL - FIELD NOTES/00$n - $t.mp3" \
            "$t" "Kestrel" "Field Notes" "$n" mp3 "$f"
        f=$((f + 35)); n=$((n + 1))
    done
    n=1
    for t in "Second Pass" "Return"; do
        make_track "$root/MUSIC/KESTREL - SECOND PASS/00$n - $t.mp3" \
            "$t" "Kestrel" "Second Pass" "$n" mp3 "$f"
        f=$((f + 35)); n=$((n + 1))
    done
    # Players usually carry these too. Neither holds audio, so both are here to
    # confirm the scanner ignores what it should.
    mkdir -p "$root/RECORD"
    mkdir -p "$root/PLAYLISTS"
    printf 'MUSIC/KESTREL - FIELD NOTES/001 - Field Notes.mp3\n' > "$root/PLAYLISTS/all.m3u"
    printf 'mock player\n' > "$root/README.txt"
}

mount_image() {
    local name=$1 label=$2
    local dmg="$DIR/$name.dmg"
    if [ -f "$dmg" ]; then
        echo "  $name: image exists, skipping create"
    else
        hdiutil create -size "$SIZE" -fs "MS-DOS FAT32" -volname "$label" \
            -type UDIF -layout NONE "$dmg" >/dev/null
        echo "  $name: created $dmg"
    fi
    [ -d "/Volumes/$label" ] || hdiutil attach "$dmg" >/dev/null
}

create_ipod() {
    local name=$1 label=$2 model=$3
    mount_image "$name" "$label"

    # libgpod 0.8.3 does not create these itself.
    mkdir -p "/Volumes/$label/iPod_Control/iTunes" \
             "/Volumes/$label/iPod_Control/Artwork" \
             "/Volumes/$label/iPod_Control/Device"
    for i in $(seq -w 0 19); do
        mkdir -p "/Volumes/$label/iPod_Control/Music/F$i"
    done

    # Only ModelNumStr is load-bearing; the rest is shaped like a real SysInfo
    # so the file doesn't look synthetic if a human opens it.
    cat > "/Volumes/$label/iPod_Control/Device/SysInfo" <<EOF
BoardHwName: iPod
pszSerialNumber: MOCK$(echo "$model" | tr -d 'M')000
ModelNumStr: $model
VisibleBuildID: 0x2100000
EOF
    echo "  $name: mounted /Volumes/$label  ModelNumStr=$model"
}

create_drive() {
    local name=$1 label=$2
    mount_image "$name" "$label"
    if [ ! -x "$FFMPEG" ]; then
        echo "  $name: ffmpeg sidecar missing — run ./stage-ffmpeg.sh first" >&2
        return 1
    fi
    case "$label" in
        MOCKUSB)    populate_usb "/Volumes/$label" ;;
        MOCKPLAYER) populate_player "/Volumes/$label" ;;
    esac
    local count
    count=$(find "/Volumes/$label" -type f \( -name '*.mp3' -o -name '*.flac' \) | wc -l | tr -d ' ')
    echo "  $name: mounted /Volumes/$label  $count audio files"
}

all_labels() {
    for d in "${IPODS[@]}" "${DRIVES[@]}"; do
        IFS='|' read -r _ label _ <<< "$d"
        echo "$label"
    done
}

cmd=${1:-create}
mkdir -p "$DIR"

case "$cmd" in
  create|attach)
    for d in "${IPODS[@]}"; do
        IFS='|' read -r name label model desc <<< "$d"
        echo "$desc"
        create_ipod "$name" "$label" "$model"
    done
    for d in "${DRIVES[@]}"; do
        IFS='|' read -r name label desc <<< "$d"
        echo "$desc"
        create_drive "$name" "$label"
    done
    echo
    echo "mounted mock volumes:"
    ls -d /Volumes/POD* /Volumes/MOCK* 2>/dev/null || true
    ;;
  detach)
    for label in $(all_labels); do
        if [ -d "/Volumes/$label" ]; then
            hdiutil detach "/Volumes/$label" >/dev/null && echo "  detached $label"
        fi
    done
    ;;
  destroy)
    "$0" detach
    for d in "${IPODS[@]}" "${DRIVES[@]}"; do
        IFS='|' read -r name _ <<< "$d"
        rm -f "$DIR/$name.dmg" && echo "  removed $DIR/$name.dmg"
    done
    ;;
  *)
    echo "usage: $0 [create|attach|detach|destroy]" >&2
    exit 2
    ;;
esac
