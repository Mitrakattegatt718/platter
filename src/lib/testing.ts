import type { Track, VolumeInfo } from "./types";

/** A Track with every field at a neutral default, so a test names only the
 * fields it actually cares about. Keep this exhaustive — a missing field here
 * turns into an undefined that the real code never sees. */
export function track(overrides: Partial<Track> & { id: string }): Track {
  return {
    title: "Untitled",
    artist: "",
    albumArtist: "",
    album: "",
    composer: "",
    genre: "",
    fileType: "MPEG audio file",
    trackNumber: 0,
    trackCount: 0,
    discNumber: 0,
    discCount: 0,
    year: 0,
    bitrate: 256,
    sampleRate: 44100,
    durationMs: 180_000,
    sizeBytes: 5_000_000,
    dateAdded: null,
    hasArtwork: false,
    playCount: 0,
    rating: 0,
    lastPlayed: null,
    ipodPath: "",
    transferred: true,
    hasDrm: false,
    ...overrides,
  };
}

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
