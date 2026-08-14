# Ideas — AI features & monetization

Captured from a design session. Not a spec; decisions here are provisional.

## Part 1 — AI features

### Framing

Three separable subsystems. P0 is a prerequisite for both others.

- **P0 — provider layer.** Credentials, LLM client, model selection, cost display.
- **P1 — metadata agent.** Fill genre/year, fetch cover art, clean junk filenames.
- **P2 — library chat.** Ask questions about the library in plain language.

Decided order: **P0 + P2 first.** Smallest complete slice, proves the provider
layer, no destructive writes.

### What is and isn't possible

"Connect your Claude/ChatGPT account" is not available. Consumer subscriptions
(Pro, Plus) expose no API for third-party desktop apps, and there is no OAuth
flow to hook into. The workable model is **bring-your-own API key**, stored in
the macOS Keychain.

For P1, the LLM is a matcher, not a source of truth:

- Good at: parsing junk filenames (`01_трек.mp3`, `VA - Best of 90s`), picking
  the right match from candidates, normalizing free text to the Classic's genre
  menu, batch judgment.
- Bad at: knowing real release years and labels. Cannot produce real cover art.
- So: catalog lookup (MusicBrainz / iTunes Search / Cover Art Archive) supplies
  candidates and images; the LLM disambiguates and normalizes; the user reviews
  a diff; existing `set_field` / `set_artwork` do the writing.

### P0 — provider layer

All LLM code lives in Rust. New `src-tauri/src/llm/` (`mod.rs`, `anthropic.rs`,
`openai_compat.rs`, `keychain.rs`). The webview never sees a key and never
talks to a provider. Rust has no official Anthropic SDK, so this is raw HTTPS
via `reqwest` — the sanctioned path, not a shortcut.

`LlmProvider` trait is provider-neutral: conversation state uses our own types
(`Turn`, `ToolCall`, `ToolResult`); each impl serializes to its own wire format.
Tool schemas are plain JSON Schema, shared between providers.

**Two impls only.** Anthropic native, plus one OpenAI-compatible client with a
configurable `base_url`. That second one covers OpenAI, Moonshot (Kimi),
DashScope (Qwen), DeepSeek, Groq, Together, OpenRouter, and local Ollama /
LM Studio — same wire format, different endpoint. Settings offers presets plus
a custom field.

Ollama is worth shipping as an option: the library never leaves the Mac. Not the
default — small local models fumble multi-step tool loops, which is the feature.

Integration tax is real: "OpenAI-compatible" diverges on streaming tool-call
deltas. Some emit index-keyed fragments, some send whole calls, some emit
malformed JSON mid-stream. Budget one accumulator that tolerates all three, and
treat "supports parallel tool calls" as a per-preset flag.

Keychain via the `keyring` crate, service `com.platter.tauri`. Commands:
`llm_set_key`, `llm_has_key -> bool`, `llm_clear_key`, `llm_test`. There is
deliberately no `llm_get_key` — the key cannot cross the IPC boundary.

**Anthropic defaults:** `claude-sonnet-5`, `max_tokens: 8192`,
`output_config: {effort: "medium"}`, streaming. Adaptive thinking stays on
(Sonnet 5's default) — disabling it makes the model measurably less willing to
reach for tools. No `temperature` / `top_p`; Sonnet 5 rejects them with a 400.
`cache_control: {type: "ephemeral"}` on the last system block; system + tools is
~1.5k stable tokens, over Sonnet 5's 1024-token cache minimum, so every turn
after the first reads the prefix at ~0.1x. Model is user-switchable in Settings.

Roughly 3k in / 300 out per tool-using turn — about $0.008 on Sonnet 5.

### P2 — library chat

**UI:** bottom drawer, ⌘K toggle, drag-resizable height. Track list and
inspector both stay visible. Transcript is ephemeral — in memory, cleared when
the library closes. Footer shows tokens and dollar cost per turn.

**Tools** (execute in Rust against the existing `SharedLibrary` mutex):

| Tool | Args | Returns |
|---|---|---|
| `library_stats` | `group_by?: genre\|artist\|album\|year` | counts, totals, capacity, missing-artwork/field tallies |
| `search_tracks` | `query?`, `artist?`, `album?`, `genre?`, `year_min?`, `year_max?`, `has_artwork?`, `missing_field?`, `limit=50` | compact rows |
| `list_albums` | `artist?` | album, artist, trackCount, year, artworkCount |
| `get_track` | `id` | full `Track` |
| `select_tracks` | `ids[]` (≤500) | emits `chat:select`; list highlights rows |

`select_tracks` is the interesting one. "Select every track with no genre" →
rows light up → the user fixes them with the existing `BulkEditPanel`. Chat
becomes a query language for the list; the human still performs every write.
No tag writes, no deletes this pass.

System prompt carries only small stable context: mount point, track count,
capacity, `COMMON_GENRES`, and that the device is a Classic. The library is
never dumped into context — the model queries it.

Agent loop caps at 8 iterations. Parallel tool calls run concurrently and all
results return in a single user message (Anthropic degrades parallel calling
otherwise).

Frontend: `ChatDrawer.tsx`, `useChat.ts` (owns all chat state),
`SettingsDialog.tsx`. Tool calls render as one quiet line —
`⚙ search_tracks · 47 results` — not a JSON blob. `App.tsx` is 598 lines
already; it gains only the drawer mount, the ⌘K handler, and its existing
selection setter passed down.

**Errors:** missing key → inline prompt with a Settings button, not a toast.
Offline → chat says so, nothing else degrades. 401 → "Key rejected." 429 →
honor `retry-after`, one auto-retry. 529 → two retries with backoff.
`stop_reason: "refusal"` → surface plainly, never retry. Library closed
mid-turn → cancel in flight, disable drawer.

**Testing:** per-tool Rust unit tests against a fixture built from
`examples/seed_podsim.rs`; a `MockProvider` returning scripted turns to test the
agent loop with zero network (iteration cap, parallel calls, error results,
refusal); golden-JSON snapshot of the Anthropic request body and tool schemas.

### P3 — listening history & "Wrapped"

The iPod has been recording playback stats the whole time and nothing surfaces
them. `Itdb_Track` already carries `playcount`, `recent_playcount`,
`time_played`, `rating`, `skipcount`, `last_skipped`, and `bookmark_time`.

**The C bridge exposes none of it.** `GpodTrackInfo` in `GpodBridge.h` stops at
`has_artwork`. First step is widening the struct and copying the fields in
`gpod_tracks_collect()`:

```c
int       rating;             // 0-100, 20 per star
int       playcount;          // lifetime
int       recent_playcount;   // since last sync
long long time_played;        // Unix epoch, 0 = never
int       skipcount;
long long last_skipped;
```

`time_played` gets the same treatment as the existing `time_added` — libgpod
hands back `time_t`, so the Mac-epoch conversion is already done.

**Fresh plays live outside `iTunesDB`.** The device writes
`iPod_Control/iTunes/Play Counts` during playback. On connect it must be read,
merged into the tracks, and **deleted** — otherwise the same plays are counted
again on the next connect. iTunes did this silently. Whether libgpod's
`itdb_parse()` handles it automatically is version-dependent; check the
installed headers before designing around it.

**There is no play history in the database — only a running total and a
last-played date.** So "what did I listen to in March" is not recoverable from
the device.

That gap is the feature. Snapshot every track's `playcount` into a local SQLite
store on each connect, and the deltas between snapshots become a real listening
history the iPod never kept. Everything stays on the Mac; nothing is uploaded.

On top of that:

- **Wrapped-style recap** — top artists, albums, and tracks for a year or a
  season; total listening time; biggest jumps; what got rated 5 and then never
  played again; what has sat at zero plays since import. Stats computed locally
  in Rust; the AI section writes the narrative around them.
- **New chat tools** for P2 — `top_played`, `never_played`,
  `listening_history(range)`. Turns the chat from a metadata browser into
  something that can answer "what did I actually wear out this summer".
- **Ratings should be bidirectional.** Stars set on the device arrive through
  the same `Play Counts` file; add `gpod_set_track_rating()` so they can also be
  set from the app.

Caveat: Rockbox keeps its own runtime database and never writes `Play Counts`,
so time spent booted into Rockbox is invisible here. Another reason to detect
`.rockbox/` on the volume and say so in the UI.

### Verify before implementing

Training data predates current releases — check these against vendor docs rather
than assuming:

1. OpenAI / Moonshot / DashScope base URLs, current model IDs, pricing, and
   whether each honors `tool_choice` and parallel tool calls
2. `keyring` crate version and its macOS 14 behavior
3. `effort: "medium"` vs `"low"` — tune after the first real run
4. Whether the installed libgpod reads and clears
   `iPod_Control/iTunes/Play Counts` inside `itdb_parse()`, or whether that is
   the caller's job — function names differ across versions, so read the
   headers rather than trusting a remembered signature

## Part 2 — distribution and the App Store

### The app cannot ship on the Mac App Store as written

Five blockers, none of them AI. The chat feature is App Store-clean; the app
around it is not.

| Where | Code | Sandbox verdict |
|---|---|---|
| `commands.rs:142` | `Command::new("diskutil")` | Blocked — no exec of system binaries |
| `convert.rs` ×6 | `Command::new(ffmpeg)`, `ffprobe`, `/usr/bin/which` | Blocked, and execs a Homebrew binary outside the bundle |
| `commands.rs:79` | `read_dir("/Volumes")` + `join("iPod_Control").exists()` | Auto-detect dies; statting inside an unselected volume is denied |
| `bundle-dylibs.sh` | libgpod bundled | **LGPL-2.1** — the unresolved relink-vs-App-Store conflict |
| `tauri.conf.json` | `com.local.platter.tauri`, `codesign --sign -` | Placeholder bundle ID, ad-hoc signature |

Writing to the iPod is the one that's solvable —
`com.apple.security.files.user-selected.read-write` plus app-scoped bookmarks,
since `MountPickerDialog` already exists.

A full MAS port means: AVFoundation/AudioToolbox conversion instead of ffmpeg
(the app already uses AVFoundation for tags, so this is native, sandbox-safe,
and license-free), DiskArbitration instead of `diskutil`, explicit pick plus
security-scoped bookmarks instead of auto-detect, and resolving libgpod —
which likely means reimplementing the iTunesDB/ArtworkDB writer in Rust.
Estimate that last one in months, not days.

**Decision: Developer ID + notarized DMG.** Keeps subprocess ffmpeg, keeps
`diskutil` eject, keeps auto-detect, sidesteps LGPL, skips review. Follow-up
task: real Developer ID cert, `--options runtime`, sign each bundled dylib with
the team ID. Ad-hoc `--deep --sign -` will not notarize.

### Monetization

Market: iPod Classic 6th/7th gen owners who still sync, underserved since iTunes
died. Small but committed. Comparables — iMazing (~$50), Waltr (~$40 one-time),
CopyTrans (Windows). A one-time price of **$25–35** is defensible, and none of
those competitors have an AI feature.

Structural point: everything in this app is a one-time utility **except** the AI
feature, which is the only part with a recurring-cost story. That determines
which pricing models are honest.

**Phase 1 — direct sale, ship now.** Notarized DMG, one-time license key, sold
through Paddle or Lemon Squeezy (merchant of record, so they handle VAT).
~5% fees vs Apple's 15%, no review, no port, works with today's codebase.
Sparkle for updates. AI ships as bring-your-own-key: zero marginal cost to you,
zero App Store §3.1.1 exposure. Downside is discovery — you own all the
marketing.

**Phase 2 — App Store as a discovery channel, only if Phase 1 shows traction.**
Free download plus a single non-consumable IAP "Pro" unlock (batch operations,
AI features, artwork fetch). Apple takes 15% under the Small Business Program
(<$1M/yr), not 30%. Gate this behind the port cost: a few months of work for a
niche utility's store revenue is a real judgment call, not an obvious yes.

**Phase 3 — only if AI usage turns out heavy.** You proxy the LLM and sell
consumable credit packs via IAP ("500 AI actions"). This is the one model where
the App Store genuinely helps monetization, because Apple handles billing for a
consumable. Costs: you run a backend, hold provider keys, and own abuse
handling. Large operational step up from a local-only app.

**Wrapped as an acquisition channel.** The P3 recap is the only part of this app
that produces something a user would voluntarily post. An exportable year-end
image — top artists, hours listened, oldest track still in rotation — is free
marketing for a product whose hardest problem is discovery, and the "all
computed locally, nothing uploaded" angle is a real differentiator against the
service it borrows its shape from. Costs nothing per user. Worth building before
paying for ads.

**Notes and traps**

- Subscription is a hard sell for a local utility with no server costs. Don't,
  unless you land on Phase 3.
- BYO-key is a §3.1.1 gray zone on MAS. Many such apps ship. Reduce risk: no
  "Buy credits" button opening a vendor's billing page — show the URL as
  copyable text.
- Dual distribution (limited on MAS, full direct) invites trouble. Apple
  restricts linking out to your own store, and the External Purchase Link
  entitlement carries its own commission and jurisdiction limits.
- Open-ended AI chat sometimes draws age-rating scrutiny. Keeping the system
  prompt scoped to library queries with read-only tools supports the argument
  that this is a query interface, not a chatbot. Keep it that way.
- Privacy nutrition label must declare track metadata sent to a third party, and
  you need a privacy policy URL. The Ollama preset is a genuine answer for
  privacy-sensitive users.
