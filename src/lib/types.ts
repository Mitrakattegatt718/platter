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

/* ------------------------------------------------------------- converter */

export type TargetFormat = "alac" | "aac" | "mp3" | "aiff" | "wav" | "flac";

/** Mirrors the Rust `Rate` enum's serde shape: unit variant or single-field
 * struct variant. */
export type Rate = "lossless" | { cbr: number } | { vbr: number };

export interface TargetSpec {
  format: TargetFormat;
  rate: Rate;
  /** Clamp to 16-bit / ≤48 kHz / stereo. Forced on for an iPod destination. */
  ipodSafe: boolean;
}

export interface FormatOption {
  format: TargetFormat;
  label: string;
  ext: string;
  ipodPlayable: boolean;
  lossless: boolean;
  /** Non-null means the option is greyed out, with this as the reason. */
  unavailable: string | null;
  encoder: string;
}

export interface SourceRow {
  id: number;
  srcPath: string;
  display: string;
  cueTrack: number | null;
  codec: string;
  sampleRate: number;
  channels: number;
  bits: number;
  /** 0 = unknown, never "empty". */
  durationS: number;
  sourceBytes: number;
  /** Why this row can't go to the chosen format, if it can't. */
  blocked: string | null;
}

export type Destination = { kind: "folder"; path: string } | { kind: "ipod" };

export type FitVerdict = "fits" | "tight" | "doesNotFit" | "unknown";

export interface Estimate {
  fileCount: number;
  blockedCount: number;
  totalDurationS: number;
  sourceBytes: number;
  /** Headline number. */
  likelyBytes: number;
  /** Pessimistic bound — what the verdict is computed against. */
  highBytes: number;
  /** True when the arithmetic really is exact, so the UI can drop "about". */
  exact: boolean;
  unknownDurationCount: number;
  destPath: string;
  destFreeBytes: number;
  destTotalBytes: number;
  destFsType: string;
  /** Boot-volume free space; present only for an iPod destination. */
  scratchFreeBytes: number | null;
  headroomBytes: number;
  verdict: FitVerdict;
  oversizeFiles: string[];
  notes: string[];
}

export interface ConvertEstimateResult {
  estimate: Estimate;
  rows: SourceRow[];
}

export interface JobSummary {
  jobId: number;
  converted: number;
  failed: number;
  cancelled: boolean;
  /** What was actually written — the honest check on the estimate. */
  outputBytes: number;
  outputDir: string | null;
  failures: string[];
}

export interface ConvertProgress {
  jobId: number;
  phase: "scanning" | "converting" | "importing" | "cleanup";
  done: number;
  total: number;
  fraction: number | null;
  current: string;
  /** 0…1 inside the current file; null for stream copies and unknown lengths. */
  fileFraction: number | null;
}

export interface ConvertLogLine {
  seq: number;
  level: "info" | "warn" | "error" | "cmd";
  file: string | null;
  line: string;
}

export interface ConvertLogBatch {
  jobId: number;
  lines: ConvertLogLine[];
}

export type AppView = "library" | "convert";

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
