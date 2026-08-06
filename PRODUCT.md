# Product

## Register

product

## Users

Owners of a click-wheel iPod Classic (6th/7th gen) who keep music on a real
device rather than a streaming service. They connect the iPod over USB in
disk-use mode, mount it as a FAT32 volume, and want to add, edit, and remove
tracks the way iTunes used to allow — without relying on Apple's software,
which dropped Classic support entirely. Most sessions are short and
task-focused: import a batch of files, fix a few tags, swap cover art, eject
safely. The user is comfortable around the filesystem and Finder but should
never have to think about the `iTunesDB` format itself.

## Product Purpose

A native macOS app, built on libgpod, that reads and writes the iPod's
`iTunesDB` / `ArtworkDB` directly. It imports MP3/M4A files (auto-reading tags
and embedded artwork via AVFoundation), edits title/artist/album/genre/track
#/year on existing tracks, sets or replaces cover art per track, removes
tracks, and writes the updated databases back to the device. Success is a
valid, browsable library on the iPod — proper Artist/Album/Genre menus on the
device — after every save, with no data lost and a clean eject.

## Brand Personality

Calm · Capable · Quiet. The app stays out of the way; the user's library is
the focus. It is honest about what it is doing (which device, how much space,
what is staged, what has been written) and never performs. Voice is plain
and direct — no marketing tone, no exclamation, no theatre.

## Anti-references

Not a generic web SaaS. The rounded, pastel, emoji-heavy, card-grid web-app
look does not belong on a Mac and would betray the native framing. The app
should not feel like a marketing landing page, a Notion-style "empty
illustration" generator, or a skeuomorphic retro-kitsch gadget. It is a
tool that belongs in the Mac dock next to Finder.

## Design Principles

- **Native by default.** The app borrows system chrome, spacing, and
  typography rather than imposing a web-app aesthetic. Dark grey, not black;
  system fonts; window and panel proportions that sit comfortably next to
  native Mac apps.
- **Honest about the work.** Real state is surfaced plainly — the connected
  device, remaining capacity, staged vs. written changes, safety warnings.
  No hidden complexity, no false reassurance.
- **Quiet competence.** The interface stays calm even when empty. The
  library is the focus; chrome recedes. Nothing shouts for attention that
  doesn't earn it.
- **Respect the device.** Every action reflects what actually happens to the
  iPod's database. Safety (eject, backup, valid writes) is woven into the
  flow, not bolted on.

## Accessibility & Inclusion

Deployment target macOS 14. Standard system contrast and reduced-motion
expectations apply; the native font stack and dark/light palettes are tuned
for legibility (dark theme bottoms out at a Mac-native grey, not a void).
Keyboard-driven flows (⌘S to save, ⌘-click multi-select) are first-class.
Placeholder and muted text must meet body-contrast thresholds, not default to
illegible gray.
