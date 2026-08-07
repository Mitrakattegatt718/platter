import { invoke } from "@tauri-apps/api/core";
import type {
  ImportResult,
  LibrarySnapshot,
  PendingImport,
  VolumeInfo,
} from "./types";

export const api = {
  listVolumes: () => invoke<VolumeInfo[]>("list_volumes"),
  openLibrary: (mountPoint: string) =>
    invoke<LibrarySnapshot>("open_library", { mountPoint }),
  closeLibrary: () => invoke<LibrarySnapshot>("close_library"),
  ejectIpod: () => invoke<LibrarySnapshot>("eject_ipod"),
  readTags: (paths: string[]) => invoke<PendingImport[]>("read_tags", { paths }),
  importTracks: (items: PendingImport[]) =>
    // The preview data URL is dead weight on the way back in — the backend
    // only reads artworkPath, and full-size covers over JSON IPC add up fast.
    invoke<ImportResult>("import_tracks", {
      items: items.map((i) => ({ ...i, artworkDataUrl: null })),
    }),
  importFiles: (paths: string[]) =>
    invoke<ImportResult>("import_files", { paths }),
  updateTrack: (args: {
    id: string;
    title: string;
    artist: string;
    album: string;
    genre: string;
    trackNumber: number;
    year: number;
  }) => invoke<LibrarySnapshot>("update_track", args),
  setField: (ids: string[], field: "artist" | "album" | "genre", value: string) =>
    invoke<LibrarySnapshot>("set_field", { ids, field, value }),
  setArtwork: (ids: string[], imagePath: string) =>
    invoke<LibrarySnapshot>("set_artwork", { ids, imagePath }),
  removeTracks: (ids: string[]) =>
    invoke<LibrarySnapshot>("remove_tracks", { ids }),
  getArtwork: (id: string, size: number) =>
    invoke<string | null>("get_artwork", { id, size }),
};

/** Artwork thumbnails keyed by track id + size. Two layers: a Promise map so
 * concurrent mounts share one fetch, and a resolved map so remounts can paint
 * synchronously with no placeholder flash. Entries survive metadata edits —
 * art only changes through set_artwork / remove / open, which invalidate
 * explicitly. */
const artworkPromises = new Map<string, Promise<string | null>>();
const artworkResolved = new Map<string, string | null>();

export function cachedArtwork(id: string, size: number): Promise<string | null> {
  const key = `${id}@${size}`;
  let hit = artworkPromises.get(key);
  if (!hit) {
    const fetch: Promise<string | null> = api
      .getArtwork(id, size)
      .catch(() => null)
      .then((url) => {
        // Only publish if this fetch is still the current one — an
        // invalidation while it was in flight means the result is stale.
        if (artworkPromises.get(key) === fetch) {
          artworkResolved.set(key, url);
        }
        return url;
      });
    artworkPromises.set(key, fetch);
    hit = fetch;
  }
  return hit;
}

/** Synchronous cache read — undefined means "not fetched yet". */
export function resolvedArtwork(id: string, size: number): string | null | undefined {
  return artworkResolved.get(`${id}@${size}`);
}

/** Bumped on every invalidation; ArtworkThumb subscribes so already-mounted
 * thumbs refetch when their track's cover was replaced (their trackId prop
 * doesn't change in that case, so nothing else would re-run the effect). */
let artVersion = 0;
const artListeners = new Set<() => void>();

export function subscribeArt(listener: () => void): () => void {
  artListeners.add(listener);
  return () => artListeners.delete(listener);
}

export function getArtVersion(): number {
  return artVersion;
}

/** Drop cached art for specific tracks, or everything when ids is omitted
 * (library reopened — pointers are meaningless across opens). */
export function invalidateArtwork(ids?: string[]) {
  if (!ids) {
    artworkPromises.clear();
    artworkResolved.clear();
  } else {
    for (const id of ids) {
      for (const map of [artworkPromises, artworkResolved] as const) {
        for (const key of map.keys()) {
          if (key.startsWith(`${id}@`)) map.delete(key);
        }
      }
    }
  }
  artVersion++;
  for (const listener of artListeners) listener();
}
