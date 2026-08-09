# Ideas — shareable library images

Captured from a design session. Not a spec; decisions here are provisional.

The common shape of every idea below: the app already has a working export
pipeline (`src/lib/shareCard.ts` draws a card on a 2× canvas and writes the PNG
to the clipboard), the library data is local and complete, and the output a
user would actually post somewhere is a picture. Each section is one artifact
type. Motivation and Appendix-level plumbing notes are shared at the end.

## Shared constraints

These apply to everything below; listed once.

- **No "streams".** The iPod knows plays, ratings and dates — honest units —
  not seconds-streamed. Every card must describe what the device recorded, and
  copy should say "plays", not borrow streaming-service phrasing. This is also
  the actual differentiator: computed locally, nothing uploaded.
- **Quiet output.** No gradients-as-text, no confetti, no angle-rotated cards.
  A share image should look like a well-set page with bars and type, matching
  `PRODUCT.md` (calm, capable, quiet). The odd one out is noted where it risks
  kitsch.
- **Canvas 2D only, never DOM rasterization.** Our tokens are oklch; html2canvas
  and friends choke on them. `shareCard.ts` already demonstrated the workable
  path: hardcoded light/dark parallel palettes, system font stack, `fit()`
  truncation with ellipsis. Build on it, don't add a dependency.
- **Deterministic content.** No shuffles. If a card shows "top albums", ties
  break by album title, and the same library renders the same card twice. A
  user re-exporting after fixing tags should see *their change*, not noise.

## S1 — Cover grid poster ("the wall")

The most recognizable artifact: an N×N grid of album covers, enemy of
text-heavy sharing. Two selection rules worth offering:

- **Most played** — `topAlbums` from `stats.ts`, covers via artwork. True "what
  you wore out".
- **Recently added** — newest `dateAdded`, covers via artwork. "What's new on
  the Pod" — good when the user's taste story is discovery, not rotation.

Layout: square canvas, grid with a 2px hairline of background color between
tiles (reads as a poster, not a screenshot). Header strip at top or none at all
— a pure grid with no chrome is the strongest export here; the app name can
live in one corner at ≤10px. Grid size before render is a quick capability
check: how many of the candidate albums actually have artwork. If < 60% of the
top-N would be artwork, offer "include text tiles" rather than shipping a grid
full of placeholders — a wall of grey squares shares poorly.

**Effort blocker: bulk artwork.** Today `get_artwork` is one IPC round trip per
(track, size), each miss doing a pixbuf decode + PNG encode + base64 under the
library lock. A 10×10 grid is up to 100 of those. Add
`get_artworks(ids, size) -> Vec<(id, Option<dataUrl>)>` doing the loop under
one lock acquisition, reusing the existing `art_cache`. That command unblocks
this whole document; without it every cover-based idea is a hundred invites
for the IPC queue.

**Data URLs are canvas-safe** (not tainted), so tiles can draw straight from
`cachedArtwork` results.

## S2 — Library DNA card

A portrait/landscape card answering "what shape is this library" with no
covers at all — works even on a library with zero artwork:

- Genre composition as a single 100% horizontal bar, one segment per top genre
  (top 6 + "other"), colors from a fixed qualitative ramp.
- Decade histogram (7 columns, play-weighted or count-weighted toggle).
- Chip row: formats (MP3 / ALAC / AAC), average bitrate, total size,
  % with artwork.
- One line of honest curiosities: oldest track, longest track, most-played
  track.

This is the fallback artifact for libraries where covers are sparse, and the
lightest to render — all data is already in `Track`. Good second build.

## S3 — Selection card ("what I'm packing")

The Library view already has multi-select. On a selection ≥ 1,
`Export → copy as image`: a card listing the selected tracks (title — artist,
with a small star for rated ≥ 80?) framed as "taking these". It's the only
idea where the user chooses the content, which changes the sharing dynamic —
requests, road-trip mixes, "your turn" exchanges. Also the only one that works
wordlessly for users whose libraries have no play data yet.

Effort is small: selection → stats-less renderer, same canvas pipeline.

## S4 — Recap extensions (the P3 lineage)

The Stats tab's Copy Snapshot shipped the static version. The ideas-ai doc's P3
noted that real time windows require snapshotting play counts on connect.
Worth keeping the wishlist here next to the other image exports:

- Season/year recap once the SQLite snapshot history exists
  ("this summer on the iPod").
- "Biggest climber" — artist whose delta grew most between snapshots.
- "Neglected five-stars" — rated ≥ 80, zero plays in window. Shares well
  because it's confessional, and it's genuinely data only a local tool has.

Don't build these on the static data alone; a recap without a window is just
the stats card again.

## S5 — Type-grid poster (artists as tiles)

When covers run out, artist names set large in a weighted grid (most-played
biggest, typographic hierarchy instead of imagery). Tag-artboard look. Risk:
this drifts toward "designed poster" territory fast; keep it to 2–3 type sizes
and one accent. Worth prototyping after S1, not before.

## S6 — Device card (flagged: kitsch risk)

iPod Classic outline, screen showing current stats or top track, as a share
image. PRODUCT.md bans skeuomorphic retro-kitsch **in the app UI**; an export
artifact has more room because it's not on-screen every session. If attempted:
flat vector, no gloss, no brushed metal, and the Classic drawn from its own
geometry. If it can't be restrained, don't ship it — a bad version of this
poisons the exact audience it targets.

## Export destinations & formats

Clipboard is shipped and covers most sharing (paste into Messages, Notes,
Telegram, Slack). Remaining decisions:

- **Save as file.** Anchor downloads are unreliable in the webview. Real path:
  `tauri-plugin-dialog` save prompt + a tiny Rust command taking bytes and a
  path (or hand the canvas PNG to Rust as bytes and let Rust both prompt and
  write). ~20 lines, no fs plugin.
- **Aspect presets.** Square (1200×1200) for feeds, portrait (1080×1920) for
  stories. The grid scales trivially; cards need per-aspect layout passes.
  Ship square first.
- **Copy vs. airdrop.** A "Share…" button could shell out to
  `NSSharingServicePicker` — native and covers AirDrop/Mail — but that's
  App Store-shaped polish; clipboard + save-as covers the same ground with no
  new bridge.

## Performance notes

- Decode covers lazily: render visible-first rows of the grid, keep total
  decode under ~150 tiles, reuse `cachedArtwork`. Never block the paint for a
  cover that hasn't arrived — draw hairline cells first, fill as data lands,
  snapshot the canvas only when the user clicks export.
- Record the "rendered" state (stats hash + theme) and cache the last Blob;
  re-exports without a library change are free.
- 2× DPR is the floor for text clarity; 3× above 1200px costs memory for
  invisible gain.

## Suggested order

1. **Bulk-artwork command** (unblocks everything visual)
2. **S1 cover grid** — most shareable per line of code
3. **S2 library DNA** — cheap, and covers the no-artwork case
4. **S3 selection card** — multiplies Library view's value
5. S5/S6 only if the first three prove anyone shares these at all

Ties back to the monetization note in `ideas-ai-and-monetization.md`:
shareable exports are the acquisition channel that costs nothing per user. The
honesty angle — "your device counted this, on your disk, no account" — is the
caption that writes itself in the footer of every card.
