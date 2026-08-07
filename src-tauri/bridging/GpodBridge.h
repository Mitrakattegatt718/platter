//
//  GpodBridge.h
//  Thin, Swift-friendly C wrapper around libgpod.
//
//  We deliberately DON'T expose GLib/Itdb types to Swift directly —
//  GLib's macro-heavy headers don't import cleanly into Swift. Instead
//  every function here takes/returns plain C types (opaque pointers,
//  char*, int, double) and GpodHelpers.c does the GLib work internally.
//
#ifndef GpodBridge_h
#define GpodBridge_h

#include <stdio.h>

#ifdef __cplusplus
extern "C" {
#endif

// Only the genuinely-nullable spots are annotated (Swift needs those to import
// as Optionals). The rest is left unspecified on purpose: an assume_nonnull
// region would make the opaque handles non-optional, which costs
// GpodTrackInfo its zero-argument init on the Swift side. build.sh silences
// -Wnullability-completeness to keep this partial annotation quiet.

/// Opaque handle to an open iPod database (wraps Itdb_iTunesDB*).
typedef void* GpodDBRef;

/// Opaque handle to a single track (wraps Itdb_Track*).
typedef void* GpodTrackRef;

/// Plain-C snapshot of a track's metadata, safe to hand to Swift.
/// Caller must call gpod_free_track_info() when done with it.
/// The char* fields are marked _Nullable so Swift imports them as real
/// Optionals; without the annotation they arrive as implicitly-unwrapped
/// pointers and `info.title.map(String.init(cString:))` fails to compile.
typedef struct {
    GpodTrackRef ref;      // pointer back to the underlying Itdb_Track
    char* _Nullable title;
    char* _Nullable artist;
    char* _Nullable album;
    char* _Nullable genre;
    char* _Nullable filetype;        // "mp3", "aac", etc.
    int   track_nr;
    int   cd_nr;
    int   year;
    int   bitrate;
    int   duration_ms;
    long long size_bytes;
    long long time_added;  // Unix epoch seconds; 0 when the device didn't record one
    int   has_artwork;
} GpodTrackInfo;

/// Open (or create) the iPod database at the given mount point,
/// e.g. "/Volumes/IPOD". Returns NULL and fills errOut on failure.
/// Caller owns the returned handle and must call gpod_close().
GpodDBRef _Nullable gpod_open(const char* mountpoint, char* _Nullable * errOut);

/// Write all pending changes (iTunesDB + ArtworkDB) back to the device.
/// Returns 1 on success, 0 on failure (errOut filled).
int gpod_write(GpodDBRef db, char* _Nullable * errOut);

/// Free the in-memory database. Does NOT write — call gpod_write() first.
void gpod_close(GpodDBRef db);

/// Number of tracks currently in the library.
int gpod_track_count(GpodDBRef db);

/// Fetch metadata for the track at `index` (0-based). Returns 1 on
/// success. Caller must gpod_free_track_info(&info) when done.
int gpod_track_at(GpodDBRef db, int index, GpodTrackInfo* outInfo);

void gpod_free_track_info(GpodTrackInfo* info);

/// Fetch metadata for every track in one linear walk of the library.
/// Returns a malloc'd array of `*outCount` infos (NULL when empty); caller
/// must free it with gpod_tracks_collect_free(). Prefer this over calling
/// gpod_track_at() in a loop — that walks the GList from its head on every
/// call, which is quadratic in library size.
GpodTrackInfo* _Nullable gpod_tracks_collect(GpodDBRef db, int* outCount);

void gpod_tracks_collect_free(GpodTrackInfo* _Nullable array, int count);

/// Import an audio file (mp3/m4a/aac) into the library: copies the
/// file onto the iPod's Music partition, creates a track record with
/// the given metadata, and adds it to the master playlist.
/// Returns a new GpodTrackRef (owned by db) or NULL on failure.
GpodTrackRef _Nullable gpod_import_track(GpodDBRef db,
                                const char* sourceFilePath,
                                const char* title,
                                const char* artist,
                                const char* album,
                                const char* genre,
                                int track_nr,
                                int year,
                                int duration_ms,
                                char* _Nullable * errOut);

/// Update metadata on an existing track (any NULL string arg is left
/// unchanged; track_nr/year of -1 are left unchanged).
int gpod_update_track_metadata(GpodDBRef db,
                                GpodTrackRef track,
                                const char* _Nullable title,
                                const char* _Nullable artist,
                                const char* _Nullable album,
                                const char* _Nullable genre,
                                int track_nr,
                                int year);

/// Set (or replace) cover art for a track from an image file on disk
/// (png/jpg). Returns 1 on success.
int gpod_set_track_artwork(GpodDBRef db, GpodTrackRef track, const char* imagePath);

/// Remove a track from the library entirely (also deletes the file
/// off the device on next gpod_write).
int gpod_remove_track(GpodDBRef db, GpodTrackRef track);

/// Extract a track's cover-art thumbnail to a temp PNG file and return
/// its path (caller must free). Returns NULL if the track has no artwork.
char* _Nullable gpod_get_track_artwork_png(GpodTrackRef track, int size);

#ifdef __cplusplus
}
#endif

#endif /* GpodBridge_h */
