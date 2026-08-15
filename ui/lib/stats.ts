/** Listening statistics over the library's play counts. Pure, and one pass
 * over the tracks: aggregated maps are small (artists/albums), and only the
 * played subset is sorted for the track ranking. Safe on 20k-track libraries. */
import type { Track } from "./types";

export interface RankedItem {
  /** Display name; for albums the album title, for tracks the title. */
  name: string;
  /** Artist line under the name. Empty for artists. */
  subtitle: string;
  plays: number;
  /** A track id whose artwork stands in for this item (album covers, track
   * thumbnails). Null when nothing in the item carries art. */
  artTrackId: string | null;
}

export interface ListeningStats {
  totalTracks: number;
  totalPlays: number;
  playedTracks: number;
  /** Sum of playCount × durationMs across the library. */
  listenMs: number;
  topArtists: RankedItem[];
  topAlbums: RankedItem[];
  topTracks: RankedItem[];
}

const TOP = 10;
/** The albums treemap wants density (stock-heatmap style): slivers with no
 * label still sort in, everything identified by hover. */
const ALBUMS_TREEMAP_TOP = 30;
/** Tracks list shows 10 collapsed behind a "show more" expanding to 50. */
const TRACKS_TOP = 50;

export function computeStats(tracks: Track[]): ListeningStats {
  const artistPlays = new Map<string, number>();
  const albumPlays = new Map<
    string,
    { album: string; artist: string; plays: number; artTrackId: string | null }
  >();
  const played: Track[] = [];
  let totalPlays = 0;
  let listenMs = 0;

  for (const t of tracks) {
    if (t.playCount <= 0) continue;
    played.push(t);
    totalPlays += t.playCount;
    listenMs += t.playCount * t.durationMs;

    const artist = t.artist || "Unknown Artist";
    artistPlays.set(artist, (artistPlays.get(artist) ?? 0) + t.playCount);

    // Album titles repeat across artists, so rank by the pair.
    const album = t.album || "Unknown Album";
    const albumArtist = t.albumArtist || artist;
    const key = `${album} ${albumArtist}`;
    const entry = albumPlays.get(key);
    if (entry) {
      entry.plays += t.playCount;
      if (entry.artTrackId === null && t.hasArtwork) entry.artTrackId = t.id;
    } else {
      albumPlays.set(key, {
        album,
        artist: albumArtist,
        plays: t.playCount,
        artTrackId: t.hasArtwork ? t.id : null,
      });
    }
  }

  const topArtists: RankedItem[] = [...artistPlays.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, TOP)
    .map(([name, plays]) => ({ name, subtitle: "", plays, artTrackId: null }));

  const topAlbums: RankedItem[] = [...albumPlays.values()]
    .sort((a, b) => b.plays - a.plays)
    .slice(0, ALBUMS_TREEMAP_TOP)
    .map((a) => ({
      name: a.album,
      subtitle: a.artist,
      plays: a.plays,
      artTrackId: a.artTrackId,
    }));

  played.sort((a, b) => b.playCount - a.playCount);
  const topTracks: RankedItem[] = played.slice(0, TRACKS_TOP).map((t) => ({
    name: t.title,
    subtitle: t.artist,
    plays: t.playCount,
    artTrackId: t.hasArtwork ? t.id : null,
  }));

  return {
    totalTracks: tracks.length,
    totalPlays,
    playedTracks: played.length,
    listenMs,
    topArtists,
    topAlbums,
    topTracks,
  };
}

export function formatCount(n: number): string {
  return n.toLocaleString(undefined);
}

/** Ordered unique artwork sources for cover mosaics and the share card:
 * albums first (they read as "the library"), tracks as backfill. */
export function coverTrackIds(stats: ListeningStats, limit = 12): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const item of [...stats.topAlbums, ...stats.topTracks]) {
    if (item.artTrackId === null || seen.has(item.artTrackId)) continue;
    seen.add(item.artTrackId);
    ids.push(item.artTrackId);
    if (ids.length === limit) break;
  }
  return ids;
}

/** "3:12" → no; for listening totals the units are hours: "96 hr 12 min",
 * days only once honestly large. */
export function formatListenTime(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  if (days >= 2) return `${formatCount(days)} days`;
  if (hours >= 1) {
    const rest = minutes % 60;
    return rest > 0 ? `${formatCount(hours)} hr ${rest} min` : `${formatCount(hours)} hr`;
  }
  return `${minutes} min`;
}
