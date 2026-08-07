export interface Track {
  id: string;
  title: string;
  artist: string;
  album: string;
  genre: string;
  fileType: string;
  trackNumber: number;
  year: number;
  bitrate: number;
  durationMs: number;
  sizeBytes: number;
  /** Unix epoch seconds; null when the device never recorded one. */
  dateAdded: number | null;
  hasArtwork: boolean;
}

export interface Capacity {
  freeBytes: number;
  totalBytes: number;
}

export interface LibrarySnapshot {
  mountPoint: string | null;
  tracks: Track[];
  capacity: Capacity | null;
}

export interface VolumeInfo {
  path: string;
  isIpod: boolean;
  /** Live statvfs capacity; null when the lookup fails. */
  freeBytes: number | null;
  totalBytes: number | null;
}

export interface PendingImport {
  filePath: string;
  title: string;
  artist: string;
  album: string;
  genre: string;
  trackNumber: number;
  year: number;
  durationMs: number;
  artworkPath: string | null;
  artworkDataUrl: string | null;
}

export interface ImportResult {
  snapshot: LibrarySnapshot;
  imported: number;
  failures: string[];
  /** Indices into the submitted items for entries that failed to import. */
  failedIndices: number[];
}

/** What the import dialog needs to decide whether to close: full success, or
 * which staged rows to keep for retry. */
export interface ImportOutcome {
  ok: boolean;
  failedIndices: number[];
}

export interface Progress {
  text: string;
  /** 0…1 for countable work, null when the UI should show a spinner. */
  fraction: number | null;
}

export type TrackGrouping = "none" | "artist" | "album" | "genre";
export type TrackSort = "title" | "artist" | "albumOrder" | "recentlyAdded";

export const GROUPING_LABELS: Record<TrackGrouping, string> = {
  none: "No Grouping",
  artist: "Artist",
  album: "Album",
  genre: "Genre",
};

export const SORT_LABELS: Record<TrackSort, string> = {
  title: "Title",
  artist: "Artist",
  albumOrder: "Album Order",
  recentlyAdded: "Recently Added",
};

/** Genres the Classic's Genres menu commonly shows — free text still works. */
export const COMMON_GENRES = [
  "Rock",
  "Pop",
  "Hip-Hop/Rap",
  "Electronic",
  "Jazz",
  "Classical",
  "Country",
  "R&B/Soul",
  "Metal",
  "Folk",
  "Podcast",
  "Other",
];

export const IMPORTABLE_EXTENSIONS = ["mp3", "m4a", "aac"];
