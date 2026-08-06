# PodSync

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

## Develop

```sh
npm install
npm run tauri dev
```

## Distribute

```sh
npm run tauri build   # .app + .dmg in src-tauri/target/release/bundle/
./bundle-dylibs.sh    # copies libgpod + GLib into the .app, re-signs,
                      # repacks a self-contained DMG
```

Without `bundle-dylibs.sh` the app only runs on machines that have libgpod at
`~/.local` and GLib via Homebrew. The result is ad-hoc signed; for
distribution beyond your own machines it still needs a Developer ID
signature + notarization.

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
  GpodBridge FFI the app uses.
