# Platter

Tauri 2 + React app for managing music on a click-wheel iPod Classic
(6th/7th gen), built on top of **libgpod**. Browse the iPod's library grouped
by artist/album/genre, search, single and bulk metadata editing, cover art,
imports with tag reading, capacity gauge, eject.

## Architecture

- `src-tauri/` — Rust backend. Compiles the libgpod C bridge at
  `src-tauri/bridging/GpodHelpers.c` via the `cc` crate (see `build.rs`).
  All libgpod calls are serialized behind a single `Mutex` (libgpod is not
  thread-safe).
- `src/` — React 19 + TypeScript + Tailwind v4 + shadcn/ui.

## Prerequisites

- Rust (rustup), Node 20+
- libgpod at `~/.local` (override with `LIBGPOD_PREFIX`); GLib chain from
  Homebrew (override prefix with `BREW_PREFIX`)
- `brew install dylibbundler` for self-contained bundles
- ffmpeg/ffprobe staged as sidecars — `src-tauri/binaries/` is gitignored, so a
  fresh clone must run `./stage-ffmpeg.sh` before its first build or
  `tauri build` fails on `externalBin`

## Develop

```sh
npm install
./stage-ffmpeg.sh     # once per clone; see Distribute for the release caveat
npm run tauri dev
```

## Distribute

```sh
npm run bundle        # tauri build, then bundle-dylibs.sh
```

`npm run tauri build` alone produces an app that **only runs on this machine** —
it still links libgpod from `~/.local` and GLib from Homebrew. `bundle-dylibs.sh`
is what copies those into `Contents/Frameworks`, rewrites the install names,
re-signs, and packs a versioned `Platter_<version>_<arch>.dmg` with a
drag-to-`/Applications` layout; it exits non-zero if any shipped binary still
references a build-machine path, is missing a bundled dependency, or requires a
newer macOS than `tauri.conf.json` promises. Always build through
`npm run bundle` so an un-patched app can never be mistaken for the artifact.

Tagged releases (`v*`) build the distributable DMG in CI
(`.github/workflows/release.yml`): libgpod and an **LGPL** ffmpeg are compiled
from source with `MACOSX_DEPLOYMENT_TARGET` pinned, so the artifact is
licensing-clean and runs on every macOS the bundle claims. **Apple Silicon
only** for now — there is no Intel build.

What still stands between a local build and a public release:

- **ffmpeg licensing.** `stage-ffmpeg.sh` will stage Homebrew's ffmpeg only with
  `ALLOW_GPL_FFMPEG=1`, which is a development-only escape hatch — that build is
  GPLv3 and cannot ship under this repo's LICENSE. Build the LGPL configuration
  in `docs/ffmpeg-build.md` first (the release workflow does exactly this).
- **Deployment targets.** Dylibs built on this machine floor at this machine's
  macOS. Rebuild dependencies with `MACOSX_DEPLOYMENT_TARGET=14.0`, or
  `bundle-dylibs.sh` will refuse the bundle (`ALLOW_MINOS_MISMATCH=1` overrides
  for local-only builds).
- **Signing.** Default is ad-hoc: downloaders see Gatekeeper's "damaged" dialog
  and must `xattr -dr com.apple.quarantine /Applications/Platter.app`. For real
  distribution set `SIGN_IDENTITY="Developer ID Application: …"` for
  `npm run bundle`, then notarize:
  `xcrun notarytool submit <dmg> --keychain-profile <profile> --wait` and
  `xcrun stapler staple Platter.app`.

Crash/debug logs land in `~/Library/Logs/com.kolebaev.platter/platter.log` —
ask for that file in bug reports. See `LICENSE` and `THIRD-PARTY-NOTICES.md`.

## Fixture: simulated iPod (PODSIM)

`~/VirtualPods/PodSim.dmg` is a read-write MS-DOS disk image seeded with a
real library through the app's own C bridge: 81 tracks / 6 artists / 13
albums (2–3 albums per artist), 12 albums with cover art, one album
intentionally artless (placeholder path). Mount and connect:

```sh
hdiutil attach ~/VirtualPods/PodSim.dmg   # mounts /Volumes/PODSIM
```

It shows up in the app's disks list with the iPod badge exactly like a real
Classic. Volume requirements (learned the hard way):

- `-format UDRW` — the default compressed image mounts read-only.
- `iPod_Control/{Music/F00..F19,iTunes,Artwork}` must pre-exist — libgpod
  0.8.3 does not create them.
- `iPod_Control/Device/SysInfo` with a real `ModelNumStr` (e.g. MB565) is
  required; without it libgpod assumes an unknown model and silently skips
  writing artwork on `itdb_write`.
- `src-tauri/examples/seed_podsim.rs` re-seeds a volume via the same
  GpodBridge FFI the app uses. Bitrates and play counts are invented
  deterministically (the stub audio has none); `--enrich` backfills them
  on an already-seeded volume in place. `--covers` replaces artwork in
  place — the covers on disk are real album art (`/tmp/podsim-src/covers`),
  fetched from the iTunes Search API and converted to PNG with `sips`.
