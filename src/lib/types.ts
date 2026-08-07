export interface Track {
  id: string;
  title: string;
  artist: string;
  /** Blank when unset — the iPod then groups the album under `artist`. */
  albumArtist: string;
  album: string;
  composer: string;
  genre: string;
  fileType: string;
  trackNumber: number;
  /** Tracks on this disc; 0 when unset. */
  trackCount: number;
  discNumber: number;
  discCount: number;
  year: number;
  bitrate: number;
  /** Hz; 0 when the database never recorded one. */
  sampleRate: number;
  durationMs: number;
  sizeBytes: number;
  /** Unix epoch seconds; null when the device never recorded one. */
  dateAdded: number | null;
  hasArtwork: boolean;
  /** Lifetime plays recorded by the device. */
  playCount: number;
  /** 0–100, 20 per star. 0 = unrated. */
  rating: number;
  /** Unix epoch seconds of the last play; null when never played. */
  lastPlayed: number | null;
  /** Device path in the database's colon form, e.g. ":iPod_Control:Music:F04:X.mp3". */
  ipodPath: string;
  /** False means a database record with no audio file behind it. */
  transferred: boolean;
  hasDrm: boolean;
}

/** Fields the inspector writes back. Sent whole, so blanks clear. */
export interface TrackFields {
  title: string;
  artist: string;
  albumArtist: string;
  album: string;
  composer: string;
  genre: string;
  trackNumber: number;
  trackCount: number;
  discNumber: number;
  discCount: number;
  year: number;
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
  albumArtist: string;
  album: string;
  composer: string;
  genre: string;
  trackNumber: number;
  trackCount: number;
  discNumber: number;
  discCount: number;
  year: number;
  durationMs: number;
  /** Read off the stream, not the tags; 0 when unknown. */
  bitrate: number;
  sampleRate: number;
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
