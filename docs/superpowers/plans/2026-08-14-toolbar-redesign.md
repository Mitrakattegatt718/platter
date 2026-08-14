# Toolbar Redesign Implementation Plan (Phase 1)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restructure the Platter toolbar into three fixed zones, turn the connected-device label into a drive picker, move library-only controls into the row above the track list, and unpin the artist header.

**Architecture:** Frontend only. The toolbar becomes a 3-column CSS grid so the centered tabs stop drifting when the left zone's width changes. A new `DriveSelect` dropdown replaces the static device label and absorbs Connect and Eject. A new `LibraryHeaderRow` absorbs Add and View and gains a selection state. Pure list/label logic is extracted to `src/lib/volumes.ts` and unit-tested; the components themselves are verified by running the app, matching this repo's existing posture (Vitest covers `src/lib` only — there is no component test harness and this plan does not add one).

**Tech Stack:** React 19, TypeScript, Tailwind, Base UI (`@base-ui/react`) via local `src/components/ui/*` wrappers, `@tanstack/react-virtual`, Vitest.

**Spec:** `docs/superpowers/specs/2026-08-14-toolbar-and-session-log-design.md` (Part 1 only. Part 2, the session log, is a separate plan and must not be started here.)

---

## File Structure

| File | Responsibility |
| --- | --- |
| `src/lib/volumes.ts` | **new** — pure helpers: mount-path → display label, volume list → iPods/others sections |
| `src/lib/volumes.test.ts` | **new** — tests for the above |
| `src/lib/testing.ts` | modify — add a `volume()` factory beside the existing `track()` |
| `src/components/DriveSelect.tsx` | **new** — toolbar drive picker; owns the Eject icon and the volume fetch |
| `src/components/LibraryHeaderRow.tsx` | **new** — the row above the track list; search/selection states, Add, View |
| `src/components/TrackList.tsx` | modify — render `LibraryHeaderRow`; delete the pinned-header machinery |
| `src/App.tsx` | modify — 3-column toolbar; wire both new components; drop the moved buttons |

---

## Task 1: Volume helpers

**Files:**
- Create: `src/lib/volumes.ts`
- Create: `src/lib/volumes.test.ts`
- Modify: `src/lib/testing.ts`

- [ ] **Step 1: Add a `volume()` factory to the existing test helpers**

Append to `src/lib/testing.ts`:

```ts
/** A VolumeInfo with every field at a neutral default, so a test names only
 * the fields it cares about. Keep this exhaustive — a missing field here turns
 * into an undefined that the real code never sees. */
export function volume(overrides: Partial<VolumeInfo> & { path: string }): VolumeInfo {
  return {
    isIpod: false,
    freeBytes: null,
    totalBytes: null,
    family: null,
    model: null,
    generation: null,
    unsupported: false,
    ...overrides,
  };
}
```

and extend its import on line 1 to:

```ts
import type { Track, VolumeInfo } from "./types";
```

- [ ] **Step 2: Write the failing test**

Create `src/lib/volumes.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { partitionVolumes, volumeLabel } from "./volumes";
import { volume } from "./testing";

describe("volumeLabel", () => {
  it("reduces a mount point to the name Finder shows", () => {
    expect(volumeLabel("/Volumes/PODSIM")).toBe("PODSIM");
    expect(volumeLabel("/Volumes/Ilia drive")).toBe("Ilia drive");
  });

  it("ignores a trailing slash", () => {
    expect(volumeLabel("/Volumes/PODSIM/")).toBe("PODSIM");
  });

  it("falls back to the input when there is no name to take", () => {
    // "/" trims to the empty string, and an empty toolbar label reads as a
    // rendering bug rather than as the root volume.
    expect(volumeLabel("/")).toBe("/");
    expect(volumeLabel("")).toBe("");
  });
});

describe("partitionVolumes", () => {
  it("splits iPods from everything else", () => {
    const { ipods, others } = partitionVolumes([
      volume({ path: "/Volumes/MOCKUSB" }),
      volume({ path: "/Volumes/PODSIM", isIpod: true }),
      volume({ path: "/Volumes/PODCLASSIC", isIpod: true }),
    ]);
    expect(ipods.map((v) => v.path)).toEqual(["/Volumes/PODSIM", "/Volumes/PODCLASSIC"]);
    expect(others.map((v) => v.path)).toEqual(["/Volumes/MOCKUSB"]);
  });

  it("keeps the order list_volumes returned inside each section", () => {
    // /Volumes order is stable between opens; re-sorting would make rows jump
    // around under the pointer as the menu reopens.
    const { ipods } = partitionVolumes([
      volume({ path: "/Volumes/Z", isIpod: true }),
      volume({ path: "/Volumes/A", isIpod: true }),
    ]);
    expect(ipods.map((v) => v.path)).toEqual(["/Volumes/Z", "/Volumes/A"]);
  });

  it("returns empty sections for an empty list", () => {
    expect(partitionVolumes([])).toEqual({ ipods: [], others: [] });
  });

  it("keeps unsupported devices in the iPods section", () => {
    // A Shuffle is still an iPod. It is shown and disabled, not hidden —
    // hiding it turns "this device is not supported" into "Platter did not
    // see my iPod", which is a worse bug report.
    const { ipods } = partitionVolumes([
      volume({ path: "/Volumes/PODSHUFFLE", isIpod: true, unsupported: true }),
    ]);
    expect(ipods).toHaveLength(1);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npm test -- volumes`
Expected: FAIL — `Failed to resolve import "./volumes"`.

- [ ] **Step 4: Write the implementation**

Create `src/lib/volumes.ts`:

```ts
import type { VolumeInfo } from "./types";

/** "/Volumes/PODSIM" → "PODSIM". The toolbar names the volume the way Finder
 * does; the full path stays in each menu row's tooltip, where it is available
 * without spending toolbar width on it. */
export function volumeLabel(mountPoint: string): string {
  const trimmed = mountPoint.replace(/\/+$/, "");
  const slash = trimmed.lastIndexOf("/");
  const name = slash === -1 ? trimmed : trimmed.slice(slash + 1);
  return name === "" ? mountPoint : name;
}

/** The drive menu's two sections. */
export interface VolumeSections {
  ipods: VolumeInfo[];
  others: VolumeInfo[];
}

/** Split for display. Order within each section is whatever list_volumes
 * returned — /Volumes order, which is stable between opens. */
export function partitionVolumes(volumes: VolumeInfo[]): VolumeSections {
  const ipods: VolumeInfo[] = [];
  const others: VolumeInfo[] = [];
  for (const v of volumes) {
    (v.isIpod ? ipods : others).push(v);
  }
  return { ipods, others };
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm test -- volumes`
Expected: PASS — 7 tests.

- [ ] **Step 6: Commit**

```bash
git add src/lib/volumes.ts src/lib/volumes.test.ts src/lib/testing.ts
git commit -m "feat(volumes): add drive label and section helpers"
```

---

## Task 2: DriveSelect component

**Files:**
- Create: `src/components/DriveSelect.tsx`

Not wired up yet — Task 4 puts it in the toolbar. Building it alone keeps that task to layout.

- [ ] **Step 1: Create the component**

Create `src/components/DriveSelect.tsx`:

```tsx
import { useEffect, useState } from "react";
import { ChevronsUpDown, HardDrive, Smartphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { api } from "@/lib/api";
import { formatBytes } from "@/lib/format";
import { partitionVolumes, volumeLabel } from "@/lib/volumes";
import type { VolumeInfo } from "@/lib/types";

/** The eject glyph. Lives here rather than in App because this menu is now the
 * only place that ejects. */
function EjectIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="size-4">
      <path d="M5 13 L12 5 L19 13 Z" strokeLinejoin="round" />
      <line x1="5" y1="18" x2="19" y2="18" strokeLinecap="round" />
    </svg>
  );
}

/** Total size, not free space: it is the number that tells two devices apart
 * before either is connected, and unlike free space it does not move. */
function capacityLabel(volume: VolumeInfo): string {
  return volume.totalBytes === null ? "" : formatBytes(volume.totalBytes);
}

/** The connected device, as something you can act on. Replaces the static
 * "iPod (/Volumes/…)" label and absorbs the Connect and Eject buttons that
 * used to sit on the right of the toolbar. */
export function DriveSelect({
  mountPoint,
  busy,
  onConnect,
  onEject,
  onConnectManually,
}: {
  mountPoint: string | null;
  busy: boolean;
  /** Resolves true when the library opened. */
  onConnect: (mountPoint: string) => Promise<boolean>;
  onEject: () => void;
  onConnectManually: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [volumes, setVolumes] = useState<VolumeInfo[]>([]);

  // Fetched when the menu opens, never polled: list_volumes runs statvfs over
  // every mount, and doing that on a timer would spin every attached disk to
  // keep a closed menu warm.
  useEffect(() => {
    if (!open) return;
    let alive = true;
    api
      .listVolumes()
      .then((next) => alive && setVolumes(next))
      .catch(() => alive && setVolumes([]));
    return () => {
      alive = false;
    };
  }, [open]);

  const { ipods, others } = partitionVolumes(volumes);

  const row = (volume: VolumeInfo) => (
    <DropdownMenuItem
      key={volume.path}
      // Positively identified as a device with no iTunesDB. Shown and
      // disabled, not hidden — clicking through to a libgpod failure is not an
      // answer, and hiding it reads as "Platter didn't see my iPod".
      disabled={volume.unsupported || busy}
      title={
        volume.unsupported
          ? `${volume.model ?? "This device"} doesn't use an iTunesDB, so Platter can't manage it`
          : volume.path
      }
      onClick={() => void onConnect(volume.path)}
    >
      {volume.isIpod ? <Smartphone /> : <HardDrive />}
      <span className="truncate">{volumeLabel(volume.path)}</span>
      <span className="ml-auto shrink-0 pl-3 text-xs tabular-nums text-muted-foreground">
        {volume.unsupported ? "Not supported" : capacityLabel(volume)}
      </span>
    </DropdownMenuItem>
  );

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="sm"
            className="min-w-0"
            title={mountPoint ?? "No iPod connected"}
          >
            <span className="truncate font-mono text-sm font-semibold">
              {mountPoint ? volumeLabel(mountPoint) : "No iPod"}
            </span>
            <ChevronsUpDown className="shrink-0 opacity-60" />
          </Button>
        }
      />
      <DropdownMenuContent align="start" className="min-w-64">
        {/* Each label lives INSIDE a group: the wrapper maps DropdownMenuLabel
            onto Base UI's GroupLabel, which reads group context and throws
            without one. */}
        {ipods.length > 0 && (
          <DropdownMenuGroup>
            <DropdownMenuLabel>iPods</DropdownMenuLabel>
            {ipods.map(row)}
          </DropdownMenuGroup>
        )}
        {others.length > 0 && (
          <DropdownMenuGroup>
            <DropdownMenuLabel>Other volumes</DropdownMenuLabel>
            {others.map(row)}
          </DropdownMenuGroup>
        )}
        {volumes.length > 0 && <DropdownMenuSeparator />}
        <DropdownMenuItem onClick={onConnectManually}>
          Connect&hellip;
        </DropdownMenuItem>
        <DropdownMenuItem disabled={mountPoint === null || busy} onClick={onEject}>
          <EjectIcon /> Eject
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npm run typecheck`
Expected: no output, exit 0. (The component is unused; TypeScript does not warn about that.)

- [ ] **Step 3: Commit**

```bash
git add src/components/DriveSelect.tsx
git commit -m "feat(toolbar): add drive select component"
```

---

## Task 3: LibraryHeaderRow, and move Add and View into it

**Files:**
- Create: `src/components/LibraryHeaderRow.tsx`
- Modify: `src/components/TrackList.tsx` (replace the search row at `128-144`; add props)
- Modify: `src/App.tsx` (remove the Add Songs button and the View dropdown from the header; pass the new props)

All three in one commit: moving a control means removing it from the old place in the same change, or the build has it in two places at once.

- [ ] **Step 1: Create the row component**

Create `src/components/LibraryHeaderRow.tsx`:

```tsx
import { CheckCircle2, LayoutGrid, Plus, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { TrackGrouping, TrackSort } from "@/lib/types";
import { GROUPING_LABELS, SORT_LABELS } from "@/lib/types";

/** The row above the track list. Two states.
 *
 * At two or more selected tracks the search field is replaced by a selection
 * summary and a way out of it. One selected track keeps the search row: the
 * editor on the right already makes a single selection obvious, and swapping
 * this early would take the field away for a selection the user is about to
 * replace with the next click.
 *
 * The search text is NOT cleared by the swap — it lives in App and comes back
 * with the field. A selection that silently discarded the query would be a
 * small data-loss bug, and the user has no way to know it happened.
 *
 * View stays in both states. Regrouping with a selection active is ordinary,
 * and the selection survives it: App recomputes its ordering from the groups
 * without touching the selected set. */
export function LibraryHeaderRow({
  searchValue,
  onSearchChange,
  selectedCount,
  onDeselectAll,
  onAdd,
  addDisabled,
  grouping,
  onGroupingChange,
  sort,
  onSortChange,
}: {
  searchValue: string;
  onSearchChange: (value: string) => void;
  selectedCount: number;
  onDeselectAll: () => void;
  onAdd: () => void;
  addDisabled: boolean;
  grouping: TrackGrouping;
  onGroupingChange: (grouping: TrackGrouping) => void;
  sort: TrackSort;
  onSortChange: (sort: TrackSort) => void;
}) {
  const selecting = selectedCount >= 2;
  return (
    <div className="flex items-center gap-1.5 border-b bg-muted/30 px-3 py-2">
      {selecting ? (
        <>
          <CheckCircle2 className="size-4 shrink-0 text-primary" />
          <span className="truncate text-sm">{selectedCount} tracks selected</span>
          <div className="flex-1" />
          <Button
            variant="ghost"
            size="sm"
            title="Clear the selection"
            onClick={onDeselectAll}
          >
            Deselect
          </Button>
        </>
      ) : (
        <>
          <Search className="size-4 shrink-0 text-muted-foreground" />
          <input
            className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            placeholder="Search title, artist or album"
            value={searchValue}
            onChange={(e) => onSearchChange(e.target.value)}
          />
          {searchValue && (
            <button
              className="text-muted-foreground hover:text-foreground"
              onClick={() => onSearchChange("")}
            >
              <X className="size-4" />
            </button>
          )}
          <Button
            variant="ghost"
            size="sm"
            disabled={addDisabled}
            title="Import MP3/M4A directly, or convert FLAC, WAV and other lossless files to Apple Lossless — or drag files and folders onto the track list"
            onClick={onAdd}
          >
            <Plus /> Add
          </Button>
        </>
      )}

      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="ghost"
              size="sm"
              title="Group the track list by artist, album or genre, and choose its sort order"
            >
              <LayoutGrid /> View
            </Button>
          }
        />
        {/* Each label lives INSIDE its radio group: Base UI's GroupLabel reads
            group context and throws without one. */}
        <DropdownMenuContent align="end">
          <DropdownMenuRadioGroup
            value={grouping}
            onValueChange={(v) => onGroupingChange(v as TrackGrouping)}
          >
            <DropdownMenuLabel>Group By</DropdownMenuLabel>
            {Object.entries(GROUPING_LABELS).map(([value, label]) => (
              <DropdownMenuRadioItem key={value} value={value}>
                {label}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
          <DropdownMenuSeparator />
          <DropdownMenuRadioGroup
            value={sort}
            onValueChange={(v) => onSortChange(v as TrackSort)}
          >
            <DropdownMenuLabel>Sort By</DropdownMenuLabel>
            {Object.entries(SORT_LABELS).map(([value, label]) => (
              <DropdownMenuRadioItem key={value} value={value}>
                {label}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
```

- [ ] **Step 2: Swap the row into TrackList**

In `src/components/TrackList.tsx`, replace the whole search-row block (currently lines `128-144`, from `<div className="flex items-center gap-1.5 border-b bg-muted/30 px-3 py-2">` through its closing `</div>`) with:

```tsx
      <LibraryHeaderRow
        searchValue={searchValue}
        onSearchChange={onSearchChange}
        selectedCount={selection.size}
        onDeselectAll={onDeselectAll}
        onAdd={onAdd}
        addDisabled={addDisabled}
        grouping={grouping}
        onGroupingChange={onGroupingChange}
        sort={sort}
        onSortChange={onSortChange}
      />
```

Add the import beside the existing component imports near the top:

```tsx
import { LibraryHeaderRow } from "@/components/LibraryHeaderRow";
```

Remove `Search` and `X` from the `lucide-react` import on line 3 — the row owns them now. That line becomes:

```tsx
import { CircleDashed, Circle, CheckCircle2 } from "lucide-react";
```

Add these to `TrackListImpl`'s destructured parameters and to its prop type, beside the existing ones:

```tsx
  onDeselectAll,
  onAdd,
  addDisabled,
  grouping,
  onGroupingChange,
  sort,
  onSortChange,
```

```tsx
  onDeselectAll: () => void;
  onAdd: () => void;
  addDisabled: boolean;
  grouping: TrackGrouping;
  onGroupingChange: (grouping: TrackGrouping) => void;
  sort: TrackSort;
  onSortChange: (sort: TrackSort) => void;
```

and extend the type import on line 8:

```tsx
import type { Track, TrackGrouping, TrackSort } from "@/lib/types";
```

These are flat props rather than one grouped object on purpose. `TrackList` is
`memo`'d (see the comment above the export) so that progress ticks and dialog
state in `App` do not re-render a virtualized list of thousands of rows. An
object literal prop would be a new identity on every `App` render and would
defeat that; flat primitives and `useCallback`'d handlers do not.

- [ ] **Step 3: Remove the moved controls from the App header**

In `src/App.tsx`, delete the `Add Songs` button block (currently `519-529`) and the entire `View` `DropdownMenu` block (currently `539-580`), including the `{view === "library" && (` guards wrapping each.

- [ ] **Step 4: Pass the new props from App**

Add two callbacks beside the other selection callbacks (after
`toggleGroupSelection`, around line 444):

```tsx
  const deselectAll = useCallback(() => setSelection(new Set()), []);

  // Both of these are useCallback'd rather than written inline at the call
  // site: an inline arrow is a new identity on every App render, which is
  // exactly what TrackList's memo exists to avoid.
  const openImporter = useCallback(() => setShowImporter(true), []);
```

Extend the `<TrackList …>` element (currently `604-618`) with:

```tsx
                onDeselectAll={deselectAll}
                onAdd={openImporter}
                addDisabled={!isOpen || busy}
                grouping={grouping}
                onGroupingChange={setGrouping}
                sort={sort}
                onSortChange={setSort}
```

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: no output, exit 0.

Unused imports do not fail `tsc` here, so also confirm by eye that `LayoutGrid` and `Plus` are still referenced in `App.tsx`. They are not — remove them from its `lucide-react` import on line 14, leaving:

```tsx
import { Music, Settings, Usb } from "lucide-react";
```

`GROUPING_LABELS` / `SORT_LABELS` are likewise no longer used in `App.tsx`; delete line 66 (`import { GROUPING_LABELS, SORT_LABELS } from "@/lib/types";`). The `DropdownMenu*` import block (lines `25-33`) is also now unused in `App.tsx` — delete it whole.

Run `npm run typecheck` again after the deletions. Expected: no output, exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/components/LibraryHeaderRow.tsx src/components/TrackList.tsx src/App.tsx
git commit -m "feat(library): move add and view into the list header row"
```

---

## Task 4: Three-zone toolbar

**Files:**
- Modify: `src/App.tsx` (the `<header>` at `503-593`, and the `EjectIcon` helper at `85-92`)

- [ ] **Step 1: Replace the header**

In `src/App.tsx`, replace the entire `<header>` element with:

```tsx
      {/* Three grid columns, not a flex row with a spacer: the left zone's
          width moves (volume name, and "42 GB free" after every import) and a
          flex layout would walk the centered tabs sideways as it did. */}
      <header className="grid h-13 shrink-0 grid-cols-[1fr_auto_1fr] items-center gap-3 border-b px-4">
        <div className="flex min-w-0 items-center gap-1">
          <DriveSelect
            mountPoint={snapshot.mountPoint}
            busy={busy}
            onConnect={connect}
            onEject={eject}
            onConnectManually={() => setShowMountPicker(true)}
          />
          {isOpen && <CapacityGauge capacity={snapshot.capacity} />}
        </div>

        <ViewTabs view={view} onChange={setView} convertProgress={convertProgress} />

        <div className="flex items-center justify-end gap-1">
          <Button
            variant="ghost"
            size="sm"
            aria-label="Settings"
            title="App settings (⌘,)"
            onClick={() => setShowSettings(true)}
          >
            <Settings />
          </Button>
        </div>
      </header>
```

- [ ] **Step 2: Delete the local EjectIcon and add the DriveSelect import**

Delete the `EjectIcon` function (lines `85-92`) — `DriveSelect` carries its own copy now.

Add beside the other component imports:

```tsx
import { DriveSelect } from "@/components/DriveSelect";
```

The `lucide-react` import loses `Usb` (the Connect button is gone):

```tsx
import { Music, Settings } from "lucide-react";
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: no output, exit 0.

- [ ] **Step 4: Commit**

```bash
git add src/App.tsx
git commit -m "feat(toolbar): split into device, tabs and settings zones"
```

---

## Task 5: Unpin the artist header

**Files:**
- Modify: `src/components/TrackList.tsx`

- [ ] **Step 1: Delete the pinned-header machinery**

Remove three blocks from `src/components/TrackList.tsx`:

1. The scroll-cursor comment and computation — the block starting at the
   comment `// Section stays readable while scrolling:` through
   `if (row?.kind === "artist") activeGroup = row.group;` and its closing brace.
   That covers `vItems`, `scrollOffset`, `cursorIndex`, the `groupRowIndices`
   `useMemo`, and the binary search over it.
2. The sticky overlay JSX — the `{activeGroup && ( … )}` block inside the
   scroll container, including its zero-height wrapper comment.
3. `useMemo` from the React import on line 1, which `groupRowIndices` was the
   only user of. It becomes:

```tsx
import { memo, useRef, useState } from "react";
```

Everything else stays: `hoveredGroup`, `rowGroupId`, `ArtistHeader` and the
virtualizer are all still used by the normal (non-pinned) rows.

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: no output, exit 0. A leftover reference to `activeGroup` or
`virtualizer.scrollOffset` fails here — that is the check.

- [ ] **Step 3: Commit**

```bash
git add src/components/TrackList.tsx
git commit -m "refactor(library): unpin the artist header"
```

---

## Task 6: Verify the whole phase

**Files:** none — verification only.

- [ ] **Step 1: Full typecheck**

Run: `npm run typecheck`
Expected: no output, exit 0.

- [ ] **Step 2: Full test run**

Run: `npm test`
Expected: PASS, all files. `volumes.test.ts` contributes 7 tests;
`format.test.ts`, `grouping.test.ts` and `theme.test.ts` must be unchanged and
still passing.

- [ ] **Step 3: Run the app**

```bash
export PATH="$HOME/.rustup/toolchains/stable-aarch64-apple-darwin/bin:$PATH"
hdiutil attach ~/VirtualPods/PodSim.dmg
npm run tauri dev
```

Check each of these by hand — none of it is covered by a test, which is why
the list is explicit:

1. Toolbar reads `No iPod` on the left, tabs centered, gear on the right.
2. Open the drive menu: `iPods` section lists PODSIM / PODCLASSIC / PODREGULAR
   with total sizes; `Other volumes` lists MOCKUSB and the rest; PODSHUFFLE and
   PODTOUCH are present but greyed with the "doesn't use an iTunesDB" tooltip.
3. Click PODSIM — it connects, the trigger becomes `PODSIM`, the capacity gauge
   appears next to it.
4. Switch tabs Library → Convert → Stats. The tabs must not shift horizontally
   at any point, including right after an import changes the free-space text.
5. Library row: search filters; `Add` opens the importer; `View` changes
   grouping and sort.
6. Select two tracks (⌘-click). The row becomes `2 tracks selected` with
   `Deselect`; `View` is still there. Click `Deselect` — the selection clears
   **and the previous search text is back in the field**.
7. Scroll the list: the artist header scrolls away with its section, nothing
   pinned at the top.
8. Drive menu → `Eject`. Then `Connect…` opens the manual mount picker.

- [ ] **Step 4: Quit the app**

```bash
pkill -x platter-tauri
```

(`osascript`-style quits do not work here: the bundle is named Platter, the
process is `platter-tauri`.)

---

## Out of scope

Phase 2 — the session log, its `Log` toolbar button, `session_log.rs`,
`blocking_logged`, `LogDialog` and the JSONL export — is specified in the same
design document but is **not** part of this plan. The toolbar's right zone
holds only Settings until then.
