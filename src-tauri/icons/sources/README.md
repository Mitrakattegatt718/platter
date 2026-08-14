# Icon sources

The two renders every other icon in the repo is derived from. Everything in
`../` (`icon.icns`, `icon.png`, `32x32.png`, `Square*Logo.png`, `../alt/dark.png`)
is generated — edit these two and re-run `./regenerate.sh`, never the outputs.

| file        | role                                                          |
| ----------- | ------------------------------------------------------------- |
| `light.png` | The app's real icon. Becomes `icon.icns` and every sized PNG.  |
| `dark.png`  | The one alternate. Applied to the Dock at runtime only.        |

Light is the default because it *is* the bundle icon — the picker's first tile
has `id: None`, and AppKit restores the bundle icon when handed nil. That's
also why Finder and Spotlight always show light: macOS has no iOS-style
alternate-icon API, and rewriting `Contents/Resources/icon.icns` to change them
would break the code signature. `../../src/app_icon.rs` has the full reasoning.

## Adding an icon

1. Drop the render in here.
2. Add a 512px copy to `../alt/` (`regenerate.sh` shows the squaring + resize).
3. Add one line to `ICONS` in `../../src/app_icon.rs`.

`app_icon::tests::the_picker_offers_exactly_light_and_dark` will fail until you
update it — that's deliberate, since a new entry appears in the picker with no
other code change.

Ids are persisted in `settings.json`, so renaming one silently resets anyone
who had it selected.

## `icon.icns` always shows up dirty

The icns encoder is not byte-reproducible: two runs over the same input produce
files of identical size that decode to identical pixels (verified — 0 differing
pixels of 1024×1024) but differ byte-for-byte. So `regenerate.sh` dirties
`icon.icns` in git every time, with nothing visual behind it. Check out the old
file rather than committing the churn unless the art actually changed.

## Known limitations

- The renders are **360×363**, upscaled to 1024. Edges are softer than a native
  1024 export would be. Re-export at 1024 (or @4x) and rerun if that matters.
- The art is **full-bleed** — it reaches the canvas edge, while macOS system
  icons carry roughly 10% transparent margin. It therefore reads slightly
  larger than its neighbours in the Dock. Deliberate, not a bug.
