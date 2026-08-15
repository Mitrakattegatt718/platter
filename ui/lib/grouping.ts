// Port of ContentView.swift's grouping/sorting/search logic. Pure functions
// over Track arrays — the Swift originals were too, which is why this file is
// nearly a transcription.

import type { Track, TrackGrouping, TrackSort } from "./types";

export interface AlbumSubgroup {
  id: string;
  title: string;
  tracks: Track[];
  /** First track with artwork — the thumbnail asks the backend for its art. */
  artTrackId: string | null;
  missingArtCount: number;
}

export interface TrackGroup {
  id: string;
  title: string;
  tracks: Track[];
  /** Non-null only when grouping by artist. */
  albums: AlbumSubgroup[] | null;
  artTrackId: string | null;
}

/** localizedStandardCompare's closest web equivalent: numeric, case/diacritic
 * insensitive ("Track 2" < "Track 10"). */
const collator = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: "base",
});

/** Lowercased search haystack per track, computed once per Track object —
 * they're immutable snapshots, so a WeakMap survives exactly as long as the
 * snapshot does. Saves 4 toLowerCase calls per track per keystroke. */
const haystacks = new WeakMap<Track, string>();

function haystack(track: Track): string {
  let h = haystacks.get(track);
  if (h === undefined) {
    h = `${track.title}\u0000${track.artist}\u0000${track.album}\u0000${track.genre}`.toLowerCase();
    haystacks.set(track, h);
  }
  return h;
}

export function matches(track: Track, query: string): boolean {
  return haystack(track).includes(query.toLowerCase());
}

/** Variant for callers filtering a whole list: the query is lowercased once
 * up front rather than once per track. */
function matchesLower(track: Track, loweredQuery: string): boolean {
  return haystack(track).includes(loweredQuery);
}

function newestDate(tracks: Track[]): number | null {
  let newest: number | null = null;
  for (const t of tracks) {
    if (t.dateAdded !== null && (newest === null || t.dateAdded > newest)) {
      newest = t.dateAdded;
    }
  }
  return newest;
}

function sortTracks(tracks: Track[], sort: TrackSort): Track[] {
  const sorted = [...tracks];
  switch (sort) {
    case "title":
      sorted.sort((a, b) => collator.compare(a.title, b.title));
      break;
    case "artist":
      sorted.sort((a, b) =>
        a.artist === b.artist
          ? collator.compare(a.title, b.title)
          : collator.compare(a.artist, b.artist),
      );
      break;
    case "albumOrder":
      sorted.sort((a, b) => {
        if (a.album !== b.album) return collator.compare(a.album, b.album);
        // Disc before track: without it a two-disc set interleaves, because
        // both discs restart their numbering at 1. Unset (0) sorts first,
        // which keeps single-disc albums exactly where they were.
        if (a.discNumber !== b.discNumber) return a.discNumber - b.discNumber;
        if (a.trackNumber !== b.trackNumber) return a.trackNumber - b.trackNumber;
        return collator.compare(a.title, b.title);
      });
      break;
    case "recentlyAdded":
      sorted.sort((a, b) => {
        if (a.dateAdded !== null && b.dateAdded !== null && a.dateAdded !== b.dateAdded) {
          return b.dateAdded - a.dateAdded;
        }
        if (a.dateAdded === null && b.dateAdded !== null) return 1;
        if (a.dateAdded !== null && b.dateAdded === null) return -1;
        return collator.compare(a.title, b.title);
      });
      break;
  }
  return sorted;
}

/** Sections and albums read alphabetically; "Recently Added" reorders the
 * headers too, otherwise the newest tracks stay buried mid-list. `newest` is
 * evaluated once per item up front — inside the comparator it would rescan
 * each group's tracks on every comparison. */
function orderGroups<T>(
  items: T[],
  sort: TrackSort,
  newest: (item: T) => number | null,
  title: (item: T) => string,
): T[] {
  const ordered = [...items];
  if (sort === "recentlyAdded") {
    const newestOf = new Map<T, number | null>(items.map((i) => [i, newest(i)]));
    ordered.sort((a, b) => {
      const x = newestOf.get(a) ?? null;
      const y = newestOf.get(b) ?? null;
      if (x !== null && y !== null && x !== y) return y - x;
      if (x === null && y !== null) return 1;
      if (x !== null && y === null) return -1;
      return collator.compare(title(a), title(b));
    });
  } else {
    ordered.sort((a, b) => collator.compare(title(a), title(b)));
  }
  return ordered;
}

function albumSubgroups(tracks: Track[], groupId: string, sort: TrackSort): AlbumSubgroup[] {
  const buckets = new Map<string, { title: string; tracks: Track[] }>();
  for (const track of tracks) {
    const album = track.album || "Unknown Album";
    const key = album.toLowerCase();
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = { title: album, tracks: [] };
      buckets.set(key, bucket);
    }
    bucket.tracks.push(track);
  }
  const subgroups = [...buckets.entries()].map(([key, bucket]) => ({
    // Scoped to the artist so "Greatest Hits" under two artists collapses
    // independently.
    id: `${groupId}\u0001${key}`,
    title: bucket.title,
    tracks: sortTracks(bucket.tracks, sort),
    artTrackId: bucket.tracks.find((t) => t.hasArtwork)?.id ?? null,
    missingArtCount: bucket.tracks.filter((t) => !t.hasArtwork).length,
  }));
  return orderGroups(subgroups, sort, (s) => newestDate(s.tracks), (s) => s.title);
}

function sectionKey(track: Track, grouping: TrackGrouping): { key: string; title: string } {
  switch (grouping) {
    case "artist": {
      const artist = track.artist || "Unknown Artist";
      return { key: artist.toLowerCase(), title: artist };
    }
    case "album": {
      // Album titles repeat across artists ("Greatest Hits"), so albums are
      // keyed by artist too and the header spells both out.
      const album = track.album || "Unknown Album";
      const artist = track.artist || "Unknown Artist";
      return {
        key: `${artist.toLowerCase()}\u0001${album.toLowerCase()}`,
        title: `${album} — ${artist}`,
      };
    }
    case "genre": {
      const genre = track.genre || "No Genre";
      return { key: genre.toLowerCase(), title: genre };
    }
    case "none":
      return { key: "all", title: "All Tracks" };
  }
}

export function groupTracks(
  tracks: Track[],
  grouping: TrackGrouping,
  sort: TrackSort,
  search: string,
): TrackGroup[] {
  const lowered = search.toLowerCase();
  const filtered = search ? tracks.filter((t) => matchesLower(t, lowered)) : tracks;

  if (grouping === "none") {
    return [
      {
        id: "all",
        title: "All Tracks",
        tracks: sortTracks(filtered, sort),
        albums: null,
        artTrackId: null,
      },
    ];
  }

  const buckets = new Map<string, { title: string; tracks: Track[] }>();
  for (const track of filtered) {
    const { key, title } = sectionKey(track, grouping);
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = { title, tracks: [] };
      buckets.set(key, bucket);
    }
    bucket.tracks.push(track);
  }

  const groups = [...buckets.entries()].map(([key, bucket]) => {
    const albums = grouping === "artist" ? albumSubgroups(bucket.tracks, key, sort) : null;
    const artTrackId =
      albums?.find((a) => a.artTrackId !== null)?.artTrackId ??
      bucket.tracks.find((t) => t.hasArtwork)?.id ??
      null;
    return {
      id: key,
      title: bucket.title,
      // When albums exist they own the render order, and every consumer of
      // group.tracks (counts, select-all, newest-date) is order-insensitive —
      // a second sort over the same tracks would be pure waste.
      tracks: albums ? bucket.tracks : sortTracks(bucket.tracks, sort),
      albums,
      artTrackId,
    };
  });

  // g.tracks always holds the group's full track set — albums merely
  // partition it — so no flatMap is needed to find the newest date.
  return orderGroups(groups, sort, (g) => newestDate(g.tracks), (g) => g.title);
}

/** Narrows an already-grouped, already-sorted structure to the tracks
 * matching `search`. This is the per-keystroke path: groupTracks pays the
 * Intl.Collator sorts, which a query can never reorder, so a keystroke costs
 * one linear haystack scan instead of re-sorting the whole library. Filtering
 * preserves order; empty albums and groups drop out; per-album art fields are
 * recomputed from the filtered set so header counts match what's shown. */
export function filterGroups(groups: TrackGroup[], search: string): TrackGroup[] {
  if (!search) return groups;
  const lowered = search.toLowerCase();
  const out: TrackGroup[] = [];

  for (const group of groups) {
    if (group.albums) {
      let albums: AlbumSubgroup[] | null = null;
      let groupTracksChanged = false;
      const keptAlbums: AlbumSubgroup[] = [];
      const keptTracks: Track[] = [];
      for (const album of group.albums) {
        const tracks = album.tracks.filter((t) => matchesLower(t, lowered));
        if (tracks.length === album.tracks.length) {
          keptAlbums.push(album);
          for (const t of tracks) keptTracks.push(t);
          continue;
        }
        groupTracksChanged = true;
        if (tracks.length === 0) continue;
        keptAlbums.push({
          ...album,
          tracks,
          artTrackId: tracks.find((t) => t.hasArtwork)?.id ?? null,
          missingArtCount: tracks.filter((t) => !t.hasArtwork).length,
        });
        for (const t of tracks) keptTracks.push(t);
      }
      if (keptAlbums.length === 0) continue;
      albums = keptAlbums;
      // Reuse the original group object when nothing inside it was filtered —
      // header memos and collapse state then see a stable identity.
      if (!groupTracksChanged && keptAlbums.length === group.albums.length) {
        out.push(group);
      } else {
        out.push({
          ...group,
          tracks: keptTracks,
          albums,
          artTrackId: keptAlbums.find((a) => a.artTrackId !== null)?.artTrackId ?? null,
        });
      }
    } else {
      const tracks = group.tracks.filter((t) => matchesLower(t, lowered));
      if (tracks.length === 0 && group.id !== "all") continue;
      out.push(
        tracks.length === group.tracks.length
          ? group
          : {
              ...group,
              tracks,
              artTrackId: tracks.find((t) => t.hasArtwork)?.id ?? null,
            },
      );
    }
  }
  return out;
}

/** One entry per rendered line, in render order — the virtualized list, the
 * shift-click range logic and "selected in sidebar order" all walk this. */
/** Every row carries its section id: the virtualized list renders rows as
 * absolutely positioned siblings, so a section is not a DOM subtree and
 * "hovering the section" can't be expressed in CSS — it's resolved by
 * comparing this id against the hovered row's. */
export type ListRow =
  | { kind: "artist"; group: TrackGroup }
  | { kind: "album"; album: AlbumSubgroup; first: boolean; groupId: string }
  | { kind: "track"; track: Track; isFirst: boolean; isSingle: boolean; groupId: string };

export function rowGroupId(row: ListRow): string {
  return row.kind === "artist" ? row.group.id : row.groupId;
}

export function flattenRows(
  groups: TrackGroup[],
  grouping: TrackGrouping,
  collapsedGroups: Set<string>,
  collapsedAlbums: Set<string>,
): ListRow[] {
  const rows: ListRow[] = [];
  const pushTracks = (tracks: Track[], groupId: string) => {
    for (let i = 0; i < tracks.length; i++) {
      rows.push({
        kind: "track",
        track: tracks[i],
        isFirst: i === 0,
        isSingle: tracks.length === 1,
        groupId,
      });
    }
  };
  for (const group of groups) {
    if (grouping === "none") {
      pushTracks(group.tracks, group.id);
      continue;
    }
    rows.push({ kind: "artist", group });
    if (collapsedGroups.has(group.id)) continue;
    if (group.albums) {
      group.albums.forEach((album, index) => {
        rows.push({ kind: "album", album, first: index === 0, groupId: group.id });
        if (!collapsedAlbums.has(album.id)) pushTracks(album.tracks, group.id);
      });
    } else {
      pushTracks(group.tracks, group.id);
    }
  }
  return rows;
}

export function visibleTrackIds(rows: ListRow[]): string[] {
  const ids: string[] = [];
  for (const row of rows) {
    if (row.kind === "track") ids.push(row.track.id);
  }
  return ids;
}
