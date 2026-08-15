# Icon sources

The four renders every other icon in the repo is derived from. Everything in
`../` (`icon.icns`, `icon.png`, `32x32.png`, `Square*Logo.png`) and everything
in `../alt/` is generated — edit these four and re-run
`scripts/regenerate-icons.sh` from the repo root, never the outputs.

| file          | role                                                           |
| ------------- | -------------------------------------------------------------- |
| `default.png` | The app's real icon. Becomes `icon.icns` and every sized PNG.   |
| `gray.png`    | Alternate. Applied to the Dock at runtime only.                 |
| `dark.png`    | Alternate. Applied to the Dock at runtime only.                 |
| `mono.png`    | Alternate. Applied to the Dock at runtime only.                 |

`default.png` is the bundle icon, so it is what Finder, Launchpad and Spotlight
show, and what the Dock falls back to once the process exits. The picker's
first tile is `id: None` and AppKit restores the bundle icon when handed nil,
which is why "Default" needs no artwork of its own in `../alt/`.

The alternates only ever reach the running app's Dock tile: macOS has no
iOS-style alternate-icon API, and rewriting `Contents/Resources/icon.icns` to
change the rest would break the code signature. `../../src/app_icon.rs` has the
full reasoning.

## Adding an icon

1. Drop the render in here.
2. Add its name to `ALTS` in `scripts/regenerate-icons.sh` and re-run it.
3. Add one line to `ICONS` in `../../src/app_icon.rs`.

`app_icon::tests::the_picker_offers_the_four_shipped_icons` will fail until you
update it — that's deliberate, since a new entry appears in the picker with no
other code change.

Ids are persisted in `settings.json`, so renaming one silently resets anyone who
had it selected. (An id that no longer exists is not fatal: the setup hook logs
a warning, falls back to the bundle icon and clears the stored value.)

## `icon.icns` always shows up dirty

The icns encoder is not byte-reproducible: two runs over the same input produce
files of identical size that decode to identical pixels (verified — 0 differing
pixels of 1024×1024) but differ byte-for-byte. So `regenerate-icons.sh` dirties
`icon.icns` in git every time, with nothing visual behind it. Check out the old
file rather than committing the churn unless the art actually changed.

## Known limitations

- The art is **full-bleed** — it reaches the canvas edge, while macOS system
  icons carry roughly 10% transparent margin. It therefore reads slightly
  larger than its neighbours in the Dock. Deliberate, not a bug.
