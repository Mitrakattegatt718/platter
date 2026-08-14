# Platter — working notes

Tauri 2 + React app that manages a click-wheel iPod Classic through libgpod via
a hand-written C bridge. macOS only.

## Build and run

- Cargo is **not** on `PATH` here. Export it first:
  `export PATH="$HOME/.rustup/toolchains/stable-aarch64-apple-darwin/bin:$PATH"`
- **Always build releases with `npm run bundle`**, never bare `npm run tauri build`.
  The bare build produces an app that links `~/.local` and `/opt/homebrew` and
  runs on this machine only; `bundle-dylibs.sh` is what makes it self-contained.
- `bundle-dylibs.sh` is **not idempotent** and refuses to run twice. dylibbundler
  runs with `-od`, so a second pass empties `Contents/Frameworks` and then cannot
  refill it — the binaries by then point at `@executable_path` paths it can no
  longer resolve. Rebuild before bundling again.
- A bare `tauri build` after a bundle leaves a stale `_CodeSignature`, and the
  `.app` then fails to launch from Finder with LaunchServices error `-600`.
  Running `npm run bundle` fixes it, because bundling re-signs last.
- `src-tauri/binaries/` is gitignored. A fresh clone must run `./stage-ffmpeg.sh`
  before its first build or `externalBin` fails.
- Quit the app with `pkill -x platter-tauri`. AppleScript
  `tell application "platter-tauri"` silently fails — the bundle is named
  Platter, the process is platter-tauri.

## Invariants — break these and a user loses data

- **The FFI struct mirror.** `GpodTrackInfo`, `GpodTrackEdit` and `GpodImportSpec`
  are mirrored field-for-field by hand in `gpod.rs`. Change one side and you must
  change the other; `gpod::tests::repr_c_mirrors_match_the_header` compares sizes
  and offsets against the C bridge and is the only thing guarding this. Run
  `cargo test` after touching either side.
- **`art_gen`.** The artwork cache is keyed on raw `Itdb_Track` pointers, which
  are reused across library opens. The generation counter is what makes a cached
  entry safe; never insert without re-checking the generation captured at
  extraction time.
- **Play Counts is positional.** Entries in `iPod_Control/iTunes/Play Counts`
  match iTunesDB tracks by position, not by id. Any backup of one is only
  coherent with a backup of the other taken at the same instant — `backup_pair`
  in `library.rs` copies both together, at connect and then on a cadence, and
  always before a write. Never back up one without the other. `itdb_write`
  deletes the file, so plays the device wrote after we opened are lost unless
  they were backed up first.
- **libgpod is not thread-safe.** Every call goes through the single
  `Mutex<Library>`. Commands run inside the `blocking()` helper
  (`commands.rs`) so FFI and subprocesses never stall a tokio worker.
- Do not hold the library mutex across a slow operation (a USB copy, an ffmpeg
  run, a full DB write) — the whole UI blocks behind it. The import loop takes
  the lock **per file** for this reason, and re-resolves the db handle inside
  every iteration: a close or eject between files frees it, so a handle cached
  across an unlock is a use-after-free waiting to happen.

## Testing

- `npm test` — Vitest over the pure modules in `src/lib`. Fast, no browser.
- `cargo test` — includes the ABI mirror test and the convert/cue parsing suite.
- Fixture iPod: `hdiutil attach ~/VirtualPods/PodSim.dmg` mounts `/Volumes/PODSIM`.
  Re-seed with `cargo run --example seed_podsim` (`--enrich`, `--covers`).
  The volume must be `UDRW`, must pre-create `iPod_Control/{Music/F00..F19,iTunes,Artwork}`
  (libgpod 0.8.3 does not), and needs a real `ModelNumStr` in
  `iPod_Control/Device/SysInfo` or artwork is silently not written.
- `commands.rs`, `library.rs` and `tags.rs` have **no tests**. That is the
  riskiest gap in the repo — it is the iTunesDB write path.

## Environment facts worth not rediscovering

- **Homebrew has no libgpod.** It is built from source and lives at `~/.local`
  (override with `LIBGPOD_PREFIX`). CI has to build it.
- ffmpeg/ffprobe **are** bundled as Tauri sidecars; `convert.rs` prefers the
  bundled pair over `PATH`. The ones staged on this machine are Homebrew's
  **GPLv3** build — fine locally, but they must not ship. See
  `docs/ffmpeg-build.md` for the LGPL configure line.
- The shell is zsh, so `shopt` is unavailable and an unmatched glob is an error
  rather than a literal.
- `otool -L` prints the file's own path as its first line. Filtering its output
  for build-machine paths without `tail -n +2` makes the check match itself.
- Every icon in `src-tauri/icons/` is **generated**. The two sources live in
  `icons/sources/`; `./icons/sources/regenerate.sh` rebuilds the whole set.
  `npm run tauri -- icon` also emits `ios/` and `android/` unconditionally —
  the script deletes them, this app is macOS only. The icns encoder is not
  byte-reproducible, so `icon.icns` shows up modified after every run even when
  the pixels are identical.
- macOS has **no alternate-app-icon API**. `NSApplication`'s
  `applicationIconImage` swaps the Dock tile and nothing else; Finder,
  Launchpad and Spotlight follow `Contents/Resources/icon.icns`, and rewriting
  that in a built bundle breaks the signature `bundle-dylibs.sh` re-signs last.
  Tauri exposes no setter for it either, hence the direct objc2 call in
  `app_icon.rs`.
