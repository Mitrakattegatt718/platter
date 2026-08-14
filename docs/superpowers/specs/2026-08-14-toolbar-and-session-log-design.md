# Toolbar redesign and session log — design

Date: 2026-08-14
Status: approved, not yet implemented

## Problem

Two unrelated changes landed in one request, and they are kept apart here
because they fail differently. The first is a layout problem: the toolbar has
grown by accretion, mixing app-wide chrome (tabs, settings) with
library-specific actions (Add Songs, View) in one undifferentiated row, and the
connected device is a static label rather than something you can act on. The
second is an observability problem: the app has no log. Six `eprintln!` calls
across the whole backend and one `console.*` on the frontend is the entire
record of what happened, which makes a bug report from a user worth roughly
nothing — and the iTunesDB write path, the one place where a defect costs
someone their library, is the least observable part of it.

Part 1 is frontend-only. Part 2 adds a subsystem. They ship in that order:
part 2 does not start until part 1 is merged.

## Part 1 — toolbar and track list

### Toolbar layout

Three zones, laid out with `grid grid-cols-[1fr_auto_1fr]` rather than flex
with a spacer.

| zone | contents |
| --- | --- |
| left (`justify-self-start`) | `DriveSelect` → `CapacityGauge` |
| center (`justify-self-center`) | `ViewTabs` — Library / Convert / Stats |
| right (`justify-self-end`) | Log → Settings |

The grid matters. Today's row is a flex line with a `flex-1` spacer
(`App.tsx:509`), so the tabs sit wherever the content to their left ends. The
left zone's width is not stable — the volume name varies, and `42 GB free`
changes width after every import — which would walk the tabs sideways during
normal use. With three grid columns the center column is centered on the
window, and the side columns can breathe without moving it.

`Connect`, `Add Songs`, `Eject` and `View` all leave the toolbar. Where each
one goes is below. What remains in the toolbar is app-wide and identical on
every tab, so switching tabs no longer reflows the row.

### DriveSelect (new: `src/components/DriveSelect.tsx`)

Replaces the static `iPod (/Volumes/PODSIM)` label. Built on the existing
`DropdownMenu` primitives already imported by `App.tsx`.

Trigger label:

- library open → the volume's basename (`PODSIM`), not the full path
- nothing open → `No iPod`

Menu contents, in order:

1. Section `iPods` — volumes with `isIpod`
2. Section `Other volumes` — everything else
3. Separator
4. `Connect…` — opens the existing `MountPickerDialog`
5. `Eject` — the existing `eject()`, disabled when nothing is open

Each volume row shows its total capacity from `VolumeInfo.totalBytes`, right
aligned. That is where total capacity is surfaced: it is the number that tells
two devices apart before either is connected, and it does not change, so it
belongs to the identity of the row rather than to the live gauge.

Rows with `unsupported` are rendered disabled and carry the same explanation
the mount picker uses today (`MountPickerDialog.tsx:98-102`) — a Shuffle keeps
its library in iTunesSD, a Touch in neither, and clicking through to a libgpod
failure is not an answer.

Selecting a row calls the existing `connect()` in `App.tsx:321-331`. No new
backend command: `api.listVolumes()` already returns everything the menu needs.

The volume list is fetched when the menu opens, not polled. `list_volumes`
runs `statvfs` over every mount, and doing that on a timer to keep a closed
menu warm would spin the disks of every attached volume for nothing.

`MountPickerDialog` stays. It is still the only way to type a path by hand, and
`Connect…` is its entry point.

### Library header row (new: `src/components/LibraryHeaderRow.tsx`)

The row above the track list, currently the search field alone
(`TrackList.tsx:128-144`). It gains the two controls that left the toolbar and
a second state.

```
selection < 2   ⌕ Search title, artist or album        [+ Add]  [⊞ View ▾]
selection ≥ 2   ✓ 14 tracks selected                  [Deselect] [⊞ View ▾]
```

The button is labelled `Add`, not `Add Songs`. It sits directly above the track
list it adds to, where the toolbar gave it no such context, and the row has two
other controls competing for the same width.

The row stays inside `TrackList` rather than moving up to `App`. It is
extracted into its own file only to keep `TrackList.tsx` from growing past its
current 468 lines, not to change ownership.

Two behaviours worth stating because they are easy to get wrong:

- **The search text is preserved across the swap.** It lives in `App.tsx:105`
  and is not cleared when the row switches to selection mode; clearing a
  selection restores the field with the query still in it. A selection that
  silently discarded the user's query would be a data-loss bug in miniature.
- **`View` is present in both states.** Regrouping the list while a selection
  is active is a normal thing to do, and the selection survives it — `App.tsx`
  already recomputes `orderedIds` from groups without touching `selection`.

`Deselect` sets the selection to an empty set. The threshold is `≥ 2`: at one
selected track the row is not in the way of anything, and the single-track
editor on the right already makes the selection obvious.

### Sticky artist header — removed

Delete the pinned-header machinery from `TrackList.tsx`:

- `75-117` — the scroll-offset cursor, `groupRowIndices`, and the binary search
  that maps the cursor to its owning group
- `175-193` — the zero-height sticky wrapper and its mirrored `ArtistHeader`

The whole list scrolls with nothing pinned. Around 50 lines go, along with a
recomputation that ran on every scroll frame.

### Files touched, part 1

| file | change |
| --- | --- |
| `src/App.tsx` | toolbar restructured to a 3-column grid; `DriveSelect` wired; `Add Songs` / `View` / `Eject` removed from the header; grouping and sort state passed down |
| `src/components/DriveSelect.tsx` | new |
| `src/components/LibraryHeaderRow.tsx` | new |
| `src/components/TrackList.tsx` | sticky header removed; header row swapped for `LibraryHeaderRow`; new props for selection count, deselect, add, grouping, sort |
| `src/components/ViewTabs.tsx` | unchanged |
| `src/components/CapacityGauge.tsx` | unchanged |

## Part 2 — session log

### Goals

A record of what the app did since launch, readable in-app and exportable as
one file for a bug report. Cleared on every launch.

Non-goals: persistence across runs, log rotation, remote upload, a logging
framework. Nothing is written to disk unless the user exports.

### Where the buffer lives

The backend owns it, and streams to the frontend.

The alternative — a buffer in the webview fed by events — was rejected because
it loses exactly the records that matter most. Events emitted before the
frontend subscribes are dropped, and that window covers launch, the silent
auto-connect in `App.tsx:300-319`, and the first `open_library`. A webview
reload would also wipe the log. Both are debugging dead ends.

### Data model (new: `src-tauri/src/session_log.rs`)

```rust
enum Level  { Info, Warn, Error }
enum Source { Ui, Core }

struct Entry {
    seq: u64,          // monotonic, assigned by the store
    at_ms: u64,        // epoch millis, one clock for both sources
    level: Level,
    source: Source,
    scope: String,     // "app" | "device" | "library" | "import" | "convert" | "ui"
    message: String,
    detail: Option<String>,
}

struct SessionLog {
    entries: Mutex<VecDeque<Entry>>,
    next_seq: AtomicU64,
    started_at_ms: u64,
    streaming: AtomicBool,
}
```

Capped at 5000 entries, oldest dropped. At roughly 200 bytes an entry that is
about 1 MB, which is the point where a full log is still greppable and the cap
still covers a long session.

`seq` is assigned in the store rather than by either caller, so the ordering of
UI and backend records is decided by one counter rather than by two clocks.

**Lock discipline.** `SessionLog`'s mutex is its own and is never taken while
holding `Mutex<Library>` for longer than a `push_back`. `record()` must not
call anything that could take the library lock. This matters because
`CLAUDE.md` already forbids holding the library mutex across slow work, and a
log write inside the per-file import loop is exactly the kind of thing that
would quietly reintroduce that.

### Recording

```rust
pub fn record(app: &AppHandle, level: Level, source: Source,
              scope: &str, message: impl Into<String>, detail: Option<String>)
```

Pushes, then emits `log:entry` with the entry — but only when `streaming` is
true. `LogDialog` flips it via a `session_log_stream(enabled)` command on open
and close, so a closed dialog costs zero IPC. A 2000-file import would
otherwise emit 2000 events into a webview with no listener.

### Backend instrumentation — one seam

Every command already funnels through the `blocking()` helper
(`commands.rs:79-85`). It gets a logging sibling:

```rust
async fn blocking_logged<T>(app: &AppHandle, scope: &str, name: &str,
                            work: impl FnOnce() -> Result<T, String>) -> Result<T, String>
```

which records the command name, its duration, and whether it returned `Ok` or
`Err` (with the error string as `detail`). Twenty-five commands become
observable without editing twenty-five functions.

`get_artwork` is excluded. It fires once per visible cover and would drown
everything else.

Recorded explicitly, on top of the command-level records, because these are the
events a bug report actually turns on:

- `open_library` / `close_library` / `eject_ipod` — mount point, track count
- `backup_pair` — both iTunesDB and Play Counts, since per `CLAUDE.md` a backup
  of one is only coherent with a backup of the other from the same instant
- `itdb_write` — before and after, with duration
- import — one record per file, with the failure reason on failure
- convert — job start, completion, cancellation

### Frontend (new: `src/lib/sessionLog.ts`)

A batching queue: records accumulate and flush to the `log_ui` command every
250 ms, or immediately at 32 pending entries. Errors flush immediately —
an error is often followed by the user quitting, and a batched error record
that never left the queue is worse than no record.

What the frontend records: view switches, connect attempts and their outcome,
files dropped on the window, dialogs opened, and every error that reaches
`ErrorDialog`.

### LogDialog (new: `src/components/LogDialog.tsx`)

Opened from the toolbar. Virtualized with `@tanstack/react-virtual`, already a
dependency. Level filter, Copy, Export. Fetches the buffer once on open via
`session_log_read`, then appends from the `log:entry` stream.

The Log button is never disabled — not by a missing device, not by `busy`. A
log that becomes unreachable in the states you most want to inspect would
defeat its own purpose, and with nothing connected the buffer still holds the
launch and connect-failure records that explain why.

### Export format — JSONL

One JSON object per line. The first line is a header, every subsequent line is
an entry.

```jsonc
{"kind":"header","app":"Platter 0.1.0","os":"macOS 15.5","arch":"aarch64","startedAt":"2026-08-14T16:55:01.000Z","mountPoint":"/Volumes/PODSIM","device":{"model":"Classic (Black)","generation":"6"}}
{"seq":41,"at":"2026-08-14T16:55:12.340Z","level":"info","src":"core","scope":"library","msg":"open_library ok","detail":"/Volumes/PODSIM · 4231 tracks · 812ms"}
{"seq":42,"at":"2026-08-14T16:55:19.006Z","level":"warn","src":"core","scope":"import","msg":"skipped","detail":"/Users/me/Music/x.flac · unsupported sample rate"}
```

JSONL over a single JSON array or plain text: it greps and diffs like text,
streams without a parser holding the whole file, and a truncated export still
reads line by line up to the break. A truncated JSON array reads as nothing.

Written through `tauri-plugin-dialog`, already wired in `lib.rs:18`. Default
filename `platter-session-YYYYMMDD-HHMMSS.jsonl`.

The header's `mountPoint` and `device` come from the `VolumeInfo` of the
currently open volume, which `fsinfo.rs` already reads out of
`iPod_Control/Device/SysInfo`. With nothing connected both are `null` — the
header is still written, because "no device was attached" is itself an answer
to most of the questions an export gets opened to settle.

**Two implementation notes, because neither dependency exists in the tree:**

- No `chrono` or `time` crate. `at_ms` is stored as epoch millis from
  `SystemTime::now()`, and a local `iso8601_utc(ms) -> String` does the
  civil-from-days conversion. Around 20 lines, and it gets unit tests against
  known epochs rather than being trusted by eye.
- macOS version comes from `libc::sysctlbyname("kern.osproductversion")`.
  `libc` is already a dependency; this avoids both a new crate and a new
  `objc2-foundation` feature.

### Privacy

Paths and track titles are written in full, unredacted — that was an explicit
choice, since a debug log with the paths stripped out usually cannot answer the
question it was collected for. The consequence is that an export contains the
user's home directory name and their library's contents.

Because that consequence only bites after the file has been sent to someone,
the dialog states it next to the Export button rather than in a doc nobody
reads: the export contains full file paths and track names.

### Files touched, part 2

| file | change |
| --- | --- |
| `src-tauri/src/session_log.rs` | new — store, `record`, ISO-8601, export serialization |
| `src-tauri/src/commands.rs` | `blocking_logged`; `session_log_read`, `session_log_export`, `session_log_stream`, `log_ui` |
| `src-tauri/src/lib.rs` | manage `SessionLog`; register the new commands |
| `src-tauri/src/library.rs` | explicit records around `backup_pair` and `itdb_write` |
| `src/lib/sessionLog.ts` | new — batching queue, subscription |
| `src/lib/api.ts` | bindings for the four new commands |
| `src/lib/types.ts` | `LogEntry`, `LogLevel`, `LogSource` |
| `src/components/LogDialog.tsx` | new |
| `src/App.tsx` | Log button; error and view-switch records |

## Testing

Rust (`cargo test`):

- the ring buffer evicts oldest at the cap, and the cap holds under a burst
- `seq` is monotonic across interleaved `record` calls from several threads
- `iso8601_utc` matches known epochs, including a leap day and a year boundary
- export emits the header first, and every line parses as standalone JSON

TypeScript (`npm test`, Vitest over `src/lib`):

- `sessionLog.test.ts` — the queue flushes on the timer and at the size
  threshold, errors flush immediately, order is preserved across flushes

Neither part changes the FFI structs, so
`gpod::tests::repr_c_mirrors_match_the_header` is unaffected — but `cargo test`
runs it anyway, which is the point of it.

`commands.rs` and `library.rs` still have no tests, and this design does not add
any. `CLAUDE.md` names that the riskiest gap in the repo. Instrumenting the
write path does not close it; it does make the path observable when it goes
wrong, which is a different and lesser thing. Worth saying plainly rather than
letting the log stand in for coverage.

## Risks

- **Log volume during import.** One record per file over a large import is the
  worst case for both the ring buffer and the event stream. The cap bounds
  memory; `streaming` bounds IPC. A 5000-file import will evict its own early
  records — acceptable, and visible, because the buffer is ordered by `seq` and
  a gap is obvious.
- **Lock inversion.** Covered above: the log mutex is a leaf. Any future call
  that records while holding the library lock reintroduces the stall
  `CLAUDE.md` warns about.
- **Toolbar width.** Three grid columns with a wide left zone (a long volume
  name) and a wide right zone can squeeze the tabs at small window widths. The
  left trigger truncates with an ellipsis; the tabs never shrink.

## Phasing

1. Part 1, merged and checked in the running app.
2. Part 2, on top.
