<div align="center">

  <img src="tauri-src/icons/icon.png" width="128" alt="Platter app icon" />

  <h1>Platter</h1>

  <p><b>Your iPod Classic, without iTunes.</b></p>

  <p>
    Browse, edit and grow the music library on a click-wheel iPod —<br/>
    imports, conversion, cover art and listening stats, all in one place.
  </p>

<p>
  <img src="https://img.shields.io/badge/macOS-14%2B-black?style=flat&logo=apple&logoColor=white" alt="macOS 14+" />
  <img src="https://img.shields.io/badge/Apple_Silicon-arm64-blue?style=flat" alt="Apple Silicon" />
  <img src="https://img.shields.io/badge/built_with-Tauri_2-FFC131?style=flat&logo=tauri&logoColor=white" alt="Tauri 2" />
  <img src="https://img.shields.io/badge/license-proprietary-lightgrey?style=flat" alt="License: proprietary" />
</p>

  <p>
    <a href="https://github.com/kolebayev/platter/releases/latest/download/Platter_macOS_arm64.dmg">
      <img src="https://img.shields.io/badge/Download-DMG-0A84FF?style=for-the-badge&logo=apple&logoColor=white" alt="Download the latest DMG" />
    </a>
  </p>

  <p>
    <a href="#installation"><b>Install guide</b></a>
    &nbsp;·&nbsp;
    <a href="#build-from-source">Build from source</a>
    &nbsp;·&nbsp;
    <a href="#safety">Safety</a>
    &nbsp;·&nbsp;
    <a href="#requirements">Requirements</a>
  </p>

</div>

> [!NOTE]
> Platter drives a real iPod Classic through **libgpod** — the same open-source
> engine gtkpod used — wrapped in a native macOS app. Plug the iPod in, and its
> library is yours to manage. No iTunes, no Music.app, no cloud.

## Features

### Library

- **Browse** the iPod grouped by artist, album or genre, with cover art and
  per-album track counts. The list is virtualized — a library of tens of
  thousands of tracks scrolls without breaking a sweat
- **Search** as you type across title, artist, album and genre
- **Edit** one track in the inspector, or select thousands (⌘-click,
  shift-click, per-artist and per-album select-all) and stamp artist, album,
  composer or genre across all of them in one apply
- **Cover art**: set or replace covers for any selection; albums missing art
  are counted right on their headers
- **Capacity gauge** shows what's free before and after every import

### Importing

- **Drag and drop** files or folders anywhere on the window
- **From Drive** scans a whole mounted disk and tells you exactly how many
  tracks an import would bring in before anything is copied
- MP3 and M4A/AAC import directly; **FLAC, WAV, AIFF, APE, WavPack, DSD and
  `.cue` album images are converted to Apple Lossless** automatically, tags
  and art included
- Long imports post a system notification when they finish while you're in
  another app

### Convert

- A standalone converter to iPod-ready formats — to the device or to a folder,
  with per-file size estimates, a live log, and formats probed from the
  bundled ffmpeg so nothing is offered that can't be produced

### Stats

- Lifetime plays, listening time, library coverage and top albums, read from
  the iPod's own play counts
- An **activity heatmap** of your listening, and a **share card** rendered to
  the clipboard as an image

### Devices

- Model detection from the iPod's own SysInfo — a Classic shows up as a
  Classic, with the right glyph and generation
- Devices Platter positively can't manage (iPhone/iPod Touch, 3rd/4th-gen
  Shuffle) are shown and labeled rather than hidden
- Eject from the toolbar; the last-connected iPod reconnects at launch

### Settings

- Light, dark, or follow-the-system theme
- Alternate Dock icons
- ⌘1 / ⌘2 / ⌘3 switch tabs, ⌘, opens Settings

## Safety

An iPod's database has no undo, so Platter is conservative by design:

- **Paired backups.** The iTunesDB and the device's Play Counts file are
  backed up together — at connect and again before writes. They are only
  coherent as a pair, and Platter never copies one without the other
- **Play counts survive.** Fresh plays recorded by the device are merged, then
  written back — nothing your iPod counted is lost
- **Edits coalesce** into a single database write after a short idle window,
  cutting flash wear; quitting waits for the write to finish
- **Failures are loud.** A background save that fails raises a persistent
  alert, not a log line. Crash and error logs land in
  `~/Library/Logs/com.kolebaev.platter/platter.log` — attach that file to bug
  reports

## Installation

[**Download the latest DMG**](https://github.com/kolebayev/platter/releases/latest/download/Platter_macOS_arm64.dmg)
— Apple Silicon, macOS 14+. Older versions and the changelog are on the
[releases page](https://github.com/kolebayev/platter/releases).
Between releases, every push to `main` leaves a build under **Artifacts** on
its [CI run](https://github.com/kolebayev/platter/actions/workflows/ci.yml) —
same recipe, downloadable with a GitHub account. Or
[build from source](#build-from-source).

1. Open the `.dmg` and drag Platter to Applications
2. Open Platter and connect your iPod
3. Click **Open Privacy Settings** when prompted and enable Platter under
   **Privacy & Security → Files & Folders → Removable Volumes**, then relaunch

> [!TIP]
> Builds are ad-hoc signed (no Developer ID), so macOS reports them as
> "damaged". Clear the quarantine flag once:
> `xattr -dr com.apple.quarantine /Applications/Platter.app`

## Build from source

### Prerequisites

- Rust (rustup) and Node 20+
- libgpod at `~/.local` (override with `LIBGPOD_PREFIX`) — not in Homebrew,
  build it from source; GLib chain from Homebrew (override with `BREW_PREFIX`).
  Its `configure` trips on two things a Mac with Homebrew has: it needs the
  perl carrying `XML::Parser` (macOS's `/usr/bin/perl`, not Homebrew's), and it
  asks pkg-config for `libplist` where Homebrew's module is `libplist-2.0`.
  `.github/workflows/build-dmg.yml` carries the working incantation for both
- `brew install dylibbundler` for self-contained bundles
- ffmpeg/ffprobe staged as sidecars: `tauri-src/binaries/` is gitignored, so a
  fresh clone must run `./scripts/stage-ffmpeg.sh` before its first build or
  `tauri build` fails on `externalBin`

### Develop

```sh
npm install
./scripts/stage-ffmpeg.sh     # once per clone; see the release caveat below
npm run tauri dev
```

### Tests

```sh
npm test              # Vitest over ui/lib
cargo test --manifest-path tauri-src/Cargo.toml   # includes the FFI ABI mirror test
```

### Distribute

```sh
npm run bundle        # tauri build, then scripts/bundle-dylibs.sh
```

`npm run tauri build` alone produces an app that **only runs on this
machine** — it still links libgpod from `~/.local` and GLib from Homebrew.
`bundle-dylibs.sh` copies those into `Contents/Frameworks`, rewrites install
names, re-signs, and packs a versioned `Platter_<version>_<arch>.dmg` with a
drag-to-`/Applications` layout. It exits non-zero if any shipped binary still
references a build-machine path, is missing a bundled dependency, or requires
a newer macOS than `tauri.conf.json` promises.

What stands between a local build and a public release:

- **ffmpeg licensing.** `stage-ffmpeg.sh` stages Homebrew's ffmpeg only with
  `ALLOW_GPL_FFMPEG=1` — a development-only escape hatch; that build is GPLv3
  and cannot ship under this repo's LICENSE. Build the LGPL configuration
  first — `.github/workflows/release.yml` carries the full configure line and
  builds it on every tagged release
- **Deployment targets.** Dylibs built on this machine floor at this machine's
  macOS. Rebuild dependencies with `MACOSX_DEPLOYMENT_TARGET=14.0`, or
  `bundle-dylibs.sh` refuses the bundle (`ALLOW_MINOS_MISMATCH=1` overrides
  for local-only builds)
- **Signing.** Set `SIGN_IDENTITY="Developer ID Application: …"` for
  `npm run bundle`, then notarize:
  `xcrun notarytool submit <dmg> --keychain-profile <profile> --wait` and
  `xcrun stapler staple Platter.app`

### Simulated iPod (PODSIM)

Development doesn't need a real Classic on the desk.
`~/VirtualPods/PodSim.dmg` is a read-write MS-DOS image seeded with a real
library through the app's own C bridge — 81 tracks, 6 artists, 13 albums,
cover art included:

```sh
hdiutil attach ~/VirtualPods/PodSim.dmg   # mounts /Volumes/PODSIM
```

It appears in Platter's disk list exactly like a real Classic. Requirements
learned the hard way: the image must be `UDRW` (compressed images mount
read-only), `iPod_Control/{Music/F00..F19,iTunes,Artwork}` must pre-exist
(libgpod 0.8.3 doesn't create them), and `iPod_Control/Device/SysInfo` needs a
real `ModelNumStr` (e.g. MB565) or artwork is silently not written. Re-seed
with `cargo run --example seed_podsim` (`--enrich` backfills plays and
bitrates, `--covers` replaces art in place).

## Requirements

- macOS 14 or later, Apple Silicon (no Intel build)
- A click-wheel iPod in disk mode — Classic 6th/7th generation is the primary
  target; models with an iTunesDB that libgpod recognizes also work
- Not supported: iPhone / iPod Touch (SQLite library) and 3rd/4th-generation
  Shuffle (a different iTunesSD layout)

## Privacy

Everything happens between your Mac and your iPod. Platter makes no network
requests, collects nothing, and phones nowhere — the app's content security
policy doesn't even permit a remote connection.

## License

Platter is source-available and proprietary — see [LICENSE](LICENSE). It
bundles LGPL components (libgpod, the GLib chain, and — in release builds — an
LGPL ffmpeg); their licenses and the relinking rights they grant are described
in [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md) and shipped inside the
app.

---

<div align="center">

**Ilia Kolebaev**

</div>
