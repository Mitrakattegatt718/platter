import { memo, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { CircleDashed, Circle, CheckCircle2 } from "lucide-react";
import { Highlight } from "@/components/Highlight";
import { ArtworkThumb } from "@/components/ArtworkThumb";
import { LibraryHeaderRow } from "@/components/LibraryHeaderRow";
import { formatDuration } from "@/lib/format";
import { rowGroupId, type AlbumSubgroup, type ListRow, type TrackGroup } from "@/lib/grouping";
import type { Track, TrackGrouping, TrackSort } from "@/lib/types";
import { cn } from "@/lib/utils";

/** One grid definition shared by the column heading and every row — the two
 * can't drift apart. (The SwiftUI app needed runtime geometry measurement for
 * this; here it's a single class string.) */
const COLUMNS =
  "grid grid-cols-[minmax(0,1fr)_120px_120px_80px_30px_40px_40px_36px_36px] items-center gap-2 px-4";

type SelState = "all" | "some" | "none";

function TrackListImpl({
  rows,
  searchValue,
  searchQuery,
  onSearchChange,
  selection,
  onRowClick,
  collapsedGroups,
  collapsedAlbums,
  onToggleGroup,
  onToggleAlbum,
  onToggleAlbumSelection,
  onToggleGroupSelection,
  isDropTarget,
  onDeselectAll,
  onAdd,
  addDisabled,
  grouping,
  onGroupingChange,
  sort,
  onSortChange,
}: {
  rows: ListRow[];
  /** Live input value. */
  searchValue: string;
  /** Deferred value the visible rows were computed from — used for highlight
   * so marks always match the rows on screen. */
  searchQuery: string;
  onSearchChange: (value: string) => void;
  selection: Set<string>;
  onRowClick: (trackId: string, event: React.MouseEvent) => void;
  collapsedGroups: Set<string>;
  collapsedAlbums: Set<string>;
  onToggleGroup: (id: string) => void;
  onToggleAlbum: (id: string) => void;
  onToggleAlbumSelection: (album: AlbumSubgroup) => void;
  onToggleGroupSelection: (group: TrackGroup) => void;
  isDropTarget: boolean;
  /* Flat props rather than one grouped object on purpose: this component is
   * memo'd (see the note above the export) so progress ticks and dialog state
   * in App don't re-render a virtualized list of thousands of rows. An object
   * literal would be a new identity on every App render and would defeat that;
   * primitives and useCallback'd handlers do not. */
  onDeselectAll: () => void;
  onAdd: () => void;
  addDisabled: boolean;
  grouping: TrackGrouping;
  onGroupingChange: (grouping: TrackGrouping) => void;
  sort: TrackSort;
  onSortChange: (sort: TrackSort) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  /** Section under the pointer. Rows are absolutely positioned siblings, so
   * hovering "the artist section and everything inside it" can't be a CSS
   * :hover on an ancestor — each row reports its section id instead. */
  const [hoveredGroup, setHoveredGroup] = useState<string | null>(null);

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (index) => {
      const row = rows[index];
      if (row.kind === "artist") return 80;
      if (row.kind === "album") return row.first ? 52 : 72;
      return 29;
    },
    getItemKey: (index) => {
      const row = rows[index];
      if (row.kind === "artist") return `ar:${row.group.id}`;
      if (row.kind === "album") return `al:${row.album.id}`;
      return row.track.id;
    },
    overscan: 12,
  });

  /** Selection state per header, computed once per (rows, selection) change.
   * Inline recounting ran on EVERY render — including each hover-state change
   * as the pointer crossed rows — and a genre group can hold tens of
   * thousands of tracks. */
  const selStates = useMemo(() => {
    const selStateOf = (tracks: Track[]): SelState => {
      let selected = 0;
      for (const t of tracks) if (selection.has(t.id)) selected++;
      if (selected === tracks.length) return "all";
      return selected > 0 ? "some" : "none";
    };
    const map = new Map<string, SelState>();
    for (const row of rows) {
      if (row.kind === "artist") map.set(`ar:${row.group.id}`, selStateOf(row.group.tracks));
      else if (row.kind === "album") map.set(`al:${row.album.id}`, selStateOf(row.album.tracks));
    }
    return map;
  }, [rows, selection]);

  return (
    <div className="relative flex h-full min-w-0 flex-col">
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

      <div
        className={cn(
          COLUMNS,
          "border-b py-1 text-[11px] font-medium text-muted-foreground/80",
        )}
      >
        <span>Title</span>
        <span>Artist</span>
        <span>Album</span>
        <span>Genre</span>
        <span className="text-center">#</span>
        <span className="text-center">Year</span>
        <span className="text-right">Time</span>
        <span className="text-right">kbps</span>
        <span className="text-right" title="Plays recorded by the iPod">
          Plays
        </span>
      </div>

      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto select-none"
        onMouseLeave={() => setHoveredGroup(null)}
      >
        <div
          className="relative w-full"
          style={{ height: virtualizer.getTotalSize() + 24 }}
        >
          {virtualizer.getVirtualItems().map((item) => {
            const row = rows[item.index];
            const groupId = rowGroupId(row);
            return (
              <div
                key={item.key}
                data-index={item.index}
                ref={virtualizer.measureElement}
                className="absolute top-0 left-0 w-full"
                style={{ transform: `translateY(${item.start}px)` }}
                onMouseEnter={() => setHoveredGroup(groupId)}
              >
                {row.kind === "artist" ? (
                  <ArtistHeader
                    group={row.group}
                    collapsed={collapsedGroups.has(row.group.id)}
                    selState={selStates.get(`ar:${row.group.id}`) ?? "none"}
                    hovered={hoveredGroup === groupId}
                    query={searchQuery}
                    onToggle={onToggleGroup}
                    onToggleSelection={onToggleGroupSelection}
                  />
                ) : row.kind === "album" ? (
                  <AlbumHeader
                    album={row.album}
                    first={row.first}
                    collapsed={collapsedAlbums.has(row.album.id)}
                    selState={selStates.get(`al:${row.album.id}`) ?? "none"}
                    hovered={hoveredGroup === groupId}
                    query={searchQuery}
                    onToggle={onToggleAlbum}
                    onToggleSelection={onToggleAlbumSelection}
                  />
                ) : (
                  <TrackRow
                    track={row.track}
                    isSingle={row.isSingle}
                    selected={selection.has(row.track.id)}
                    query={searchQuery}
                    onRowClick={onRowClick}
                  />
                )}
              </div>
            );
          })}
        </div>
      </div>

      {isDropTarget && (
        <div className="pointer-events-none absolute inset-1 rounded-lg border-2 border-dashed border-primary" />
      )}
    </div>
  );
}

/* Spacing spec, carried over from the SwiftUI insets tuned by hand:
 * artist header pt-8 (32px) pb-6 (24px); album header pt-5 (20px, first album
 * 0 — the artist header's bottom already spaces it) pb-3 (12px); track rows
 * py-1 (4px). */

/** The shell re-renders on progress ticks, busy-count changes, panel resizes
 * and dialog state — none of which reach the list. Every prop below is already
 * a stable identity (memoized rows, useCallback handlers), so memo turns those
 * into no-ops. `searchValue` still changes per keystroke, which is correct:
 * the search field lives in here. */
export const TrackList = memo(TrackListImpl);

const SELECTION_ICONS = { all: CheckCircle2, some: CircleDashed, none: Circle } as const;

/** Revealed only while the pointer is inside the owning artist section. The
 * pointer-events guard matters: an invisible but clickable target sitting at
 * the right edge of a header would swallow clicks meant for its collapse
 * toggle. Keyboard focus still reaches it, and brings the visuals back. */
function SelectAllButton({
  selState,
  hovered,
  title,
  onSelect,
}: {
  selState: SelState;
  hovered: boolean;
  title: string;
  onSelect: () => void;
}) {
  const Icon = SELECTION_ICONS[selState];
  return (
    <button
      className={cn(
        // Opacity only — no transform. A control that slides in draws more
        // attention than a select-all affordance deserves, and the header's
        // baseline would visibly shift under it.
        "shrink-0 transition-opacity motion-reduce:transition-none",
        selState === "all" ? "text-primary" : "text-muted-foreground",
        // Asymmetric: quick to arrive so it feels responsive to the pointer,
        // slower to leave so crossing a gap between rows doesn't flicker.
        hovered
          ? "opacity-100 duration-150 ease-out"
          : "pointer-events-none opacity-0 duration-300 ease-in focus-visible:pointer-events-auto focus-visible:opacity-100",
      )}
      title={title}
      onClick={(e) => {
        e.stopPropagation();
        onSelect();
      }}
    >
      <Icon className="size-4" />
    </button>
  );
}

const ArtistHeader = memo(function ArtistHeader({
  group,
  collapsed,
  selState,
  hovered,
  query,
  onToggle,
  onToggleSelection,
}: {
  group: TrackGroup;
  collapsed: boolean;
  selState: SelState;
  hovered: boolean;
  query: string;
  onToggle: (id: string) => void;
  onToggleSelection: (group: TrackGroup) => void;
}) {
  const count = group.tracks.length;
  return (
    <div
      className="flex cursor-pointer items-center gap-1.5 px-4 pt-8 pb-6"
      onClick={() => onToggle(group.id)}
    >
      <span
        className={cn(
          "font-semibold transition-colors",
          collapsed ? "text-muted-foreground" : "text-foreground",
        )}
      >
        <Highlight text={group.title} query={query} />
      </span>
      <span className="text-xs tabular-nums text-muted-foreground/70">{count}</span>
      <div className="flex-1" />
      <SelectAllButton
        selState={selState}
        hovered={hovered}
        title="Select all tracks by this artist"
        onSelect={() => onToggleSelection(group)}
      />
    </div>
  );
});

/** Track count in both states, with the missing-art nudge appended. */
function albumSubtitle(album: AlbumSubgroup): string {
  const count = album.tracks.length;
  let text = `${count} track${count === 1 ? "" : "s"}`;
  if (album.missingArtCount > 0) {
    text += ` · ${album.missingArtCount} without art`;
  }
  return text;
}

const AlbumHeader = memo(function AlbumHeader({
  album,
  first,
  collapsed,
  selState,
  hovered,
  query,
  onToggle,
  onToggleSelection,
}: {
  album: AlbumSubgroup;
  first: boolean;
  collapsed: boolean;
  selState: SelState;
  hovered: boolean;
  query: string;
  onToggle: (id: string) => void;
  onToggleSelection: (album: AlbumSubgroup) => void;
}) {
  return (
    <div
      className={cn(
        "flex cursor-pointer items-center gap-2 px-4 pb-3 text-muted-foreground",
        first ? "pt-0" : "pt-5",
      )}
      onClick={() => onToggle(album.id)}
    >
      <ArtworkThumb
        trackId={album.artTrackId}
        size={40}
        missingCount={album.missingArtCount}
        className={cn("transition-opacity", collapsed && "opacity-50")}
      />
      <div className="min-w-0 flex flex-col gap-px">
        <span className="truncate text-xs font-semibold">
          <Highlight text={album.title} query={query} />
        </span>
        <span className="text-[9px] text-muted-foreground/70">
          {albumSubtitle(album)}
        </span>
      </div>
      <div className="flex-1" />
      <SelectAllButton
        selState={selState}
        hovered={hovered}
        title="Select all tracks in this album"
        onSelect={() => onToggleSelection(album)}
      />
    </div>
  );
});

/** Rules mirror the tuned List separators: a line above the first track, one
 * between tracks (each non-first row's border-t), and one below when the
 * album is a single track. */
const TrackRow = memo(function TrackRow({
  track,
  isSingle,
  selected,
  query,
  onRowClick,
}: {
  track: Track;
  isSingle: boolean;
  selected: boolean;
  query: string;
  onRowClick: (trackId: string, event: React.MouseEvent) => void;
}) {
  return (
    <div
      className={cn(
        COLUMNS,
        "cursor-default border-t py-1",
        isSingle && "border-b",
        selected ? "bg-primary/15" : "hover:bg-muted/50",
      )}
      onClick={(e) => onRowClick(track.id, e)}
    >
      <span className="truncate text-sm" title={track.title}>
        <Highlight text={track.title} query={query} />
      </span>
      <span className="truncate text-xs text-muted-foreground">
        <Highlight text={track.artist} query={query} />
      </span>
      <span className="truncate text-xs text-muted-foreground">
        <Highlight text={track.album} query={query} />
      </span>
      <span className="truncate text-xs text-muted-foreground">
        <Highlight text={track.genre} query={query} />
      </span>
      <span className="text-center text-xs tabular-nums text-muted-foreground/70">
        {track.trackNumber > 0 ? track.trackNumber : "—"}
      </span>
      <span className="text-center text-xs tabular-nums text-muted-foreground/70">
        {track.year > 0 ? track.year : "—"}
      </span>
      <span className="text-right text-xs tabular-nums text-muted-foreground/70">
        {formatDuration(track.durationMs)}
      </span>
      <span className="text-right text-xs tabular-nums text-muted-foreground/70">
        {track.bitrate > 0 ? track.bitrate : "—"}
      </span>
      <span className="text-right text-xs tabular-nums text-muted-foreground/70">
        {track.playCount > 0 ? track.playCount : "—"}
      </span>
    </div>
  );
});
