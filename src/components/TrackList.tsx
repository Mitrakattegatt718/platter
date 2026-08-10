import { memo, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { CircleDashed, Circle, Search, X, CheckCircle2 } from "lucide-react";
import { Highlight } from "@/components/Highlight";
import { ArtworkThumb } from "@/components/ArtworkThumb";
import { formatDuration } from "@/lib/format";
import { rowGroupId, type AlbumSubgroup, type ListRow, type TrackGroup } from "@/lib/grouping";
import type { Track } from "@/lib/types";
import { cn } from "@/lib/utils";

/** One grid definition shared by the column heading and every row — the two
 * can't drift apart. (The SwiftUI app needed runtime geometry measurement for
 * this; here it's a single class string.) */
const COLUMNS =
  "grid grid-cols-[minmax(0,1fr)_120px_120px_80px_30px_40px_40px_36px_36px] items-center gap-2 px-4";

type SelState = "all" | "some" | "none";

export function TrackList({
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

  // Section stays readable while scrolling: a pinned copy of the current
  // group header covers the scrollport top. Rows in this list are absolutely
  // positioned siblings, so the header itself can never stick — the overlay
  // mirrors it instead, and flips to the next group the moment that header's
  // top edge crosses the top (while its body slides hidden underneath).
  const vItems = virtualizer.getVirtualItems();
  const scrollOffset = virtualizer.scrollOffset ?? 0;
  let cursorIndex = vItems.length > 0 ? vItems[0].index : -1;
  for (const item of vItems) {
    // The cursor is the row intersecting the scrollport's top edge; overscan
    // rows above it start before the offset, so the last such item wins.
    if (item.start <= scrollOffset) cursorIndex = item.index;
    else break;
  }

  /** Row indices of every group header, for mapping the cursor to its
   * owning section without walking rows back one by one. */
  const groupRowIndices = useMemo(() => {
    const indices: number[] = [];
    rows.forEach((row, i) => {
      if (row.kind === "artist") indices.push(i);
    });
    return indices;
  }, [rows]);

  let activeGroup: TrackGroup | null = null;
  if (cursorIndex >= 0) {
    // Last group header at or before the cursor owns the section under it.
    let lo = 0;
    let hi = groupRowIndices.length - 1;
    let found = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (groupRowIndices[mid] <= cursorIndex) {
        found = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    const row = found >= 0 ? rows[groupRowIndices[found]] : null;
    if (row?.kind === "artist") activeGroup = row.group;
  }

  const selStateOf = (tracks: Track[]): SelState => {
    let selected = 0;
    for (const t of tracks) if (selection.has(t.id)) selected++;
    if (selected === tracks.length) return "all";
    return selected > 0 ? "some" : "none";
  };

  return (
    <div className="relative flex h-full min-w-0 flex-col">
      <div className="flex items-center gap-1.5 border-b bg-muted/30 px-3 py-2">
        <Search className="size-4 shrink-0 text-muted-foreground" />
        <input
          className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
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
      </div>

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
        {/* Zero-height sticky wrapper: it sticks without taking flow space
            (which would push the virtual canvas down), while its overflowing
            child still renders and receives clicks. At the section's own top
            the pinned copy sits exactly over the identical natural header,
            so covering is indistinguishable from sticking. */}
        {activeGroup && (
          <div className="sticky top-0 z-10 h-0 overflow-visible">
            <div
              className="border-b bg-background"
              onMouseEnter={() => setHoveredGroup(activeGroup.id)}
            >
              <ArtistHeader
                key={activeGroup.id}
                group={activeGroup}
                collapsed={collapsedGroups.has(activeGroup.id)}
                selState={selStateOf(activeGroup.tracks)}
                hovered={hoveredGroup === activeGroup.id}
                query={searchQuery}
                onToggle={onToggleGroup}
                onToggleSelection={onToggleGroupSelection}
              />
            </div>
          </div>
        )}
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
                    selState={selStateOf(row.group.tracks)}
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
                    selState={selStateOf(row.album.tracks)}
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
