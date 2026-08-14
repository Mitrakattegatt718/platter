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
    char* _Nullable albumartist;
    char* _Nullable album;
    char* _Nullable composer;
    char* _Nullable genre;
    char* _Nullable filetype;        // "mp3", "aac", etc.
    // Where the file sits on the device, in the DB's own colon-separated form
    // (":iPod_Control:Music:F04:ABCD.mp3"). Empty when the DB has no path.
    char* _Nullable ipod_path;
    int   track_nr;
    int   track_count;     // tracks on this disc; 0 when unset
    int   cd_nr;
    int   disc_count;      // discs in the set; 0 when unset
    int   year;
    int   bitrate;
    int   samplerate;      // Hz; 0 when the DB never recorded one
    int   duration_ms;
    long long size_bytes;
    long long time_added;  // Unix epoch seconds; 0 when the device didn't record one
    int   has_artwork;
    // Lifetime play count. itdb_parse() has already folded in the device's
    // "Play Counts" file, so this is the total including plays the iTunesDB
    // itself doesn't know about yet. Same for rating/time_played.
    int   playcount;
    int   rating;          // 0-100, 20 per star
    long long time_played; // Unix epoch seconds; 0 = never played
    int   transferred;     // 1 when the audio file is actually on the device
    int   has_drm;         // 1 when FairPlay-protected (drm_userid != 0)
} GpodTrackInfo;

/// Metadata to write onto a track. NULL strings and negative numbers are left
/// unchanged, which is what makes one struct serve both the full inspector
/// save and the single-field bulk edit.
typedef struct {
    const char* _Nullable title;
    const char* _Nullable artist;
    const char* _Nullable albumartist;
    const char* _Nullable album;
    const char* _Nullable composer;
    const char* _Nullable genre;
    int track_nr;
    int track_count;
    int cd_nr;
    int disc_count;
    int year;
} GpodTrackEdit;

/// Everything gpod_import_track needs about one file. Strings may be NULL
/// (a placeholder is substituted for title/artist/album); numeric fields of
/// 0 mean "unknown, leave the DB default".
typedef struct {
    const char* source_file_path;    // required
    const char* _Nullable title;
    const char* _Nullable artist;
    const char* _Nullable albumartist;
    const char* _Nullable album;
    const char* _Nullable composer;
    const char* _Nullable genre;
    int track_nr;
    int track_count;
    int cd_nr;
    int disc_count;
    int year;
    int duration_ms;
    int bitrate;       // kbps
    int samplerate;    // Hz
} GpodImportSpec;

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
                                const GpodImportSpec* spec,
                                char* _Nullable * errOut);

/// Update metadata on an existing track. See GpodTrackEdit for the
/// leave-unchanged sentinels.
int gpod_update_track_metadata(GpodDBRef db,
                                GpodTrackRef track,
                                const GpodTrackEdit* edit);

/// Set bitrate (kbps) and/or lifetime play count on a track. Used by the
/// seed/enrich dev examples to give the PodSim fixture plausible stats;
/// the app itself never calls this. bitrate <= 0 or playcount < 0 leaves
/// that field unchanged. Returns 1 on success.
int gpod_set_track_stats(GpodDBRef db, GpodTrackRef track, int bitrate, int playcount);

/// Set (or replace) cover art for a track from an image file on disk
/// (png/jpg). Returns 1 on success.
int gpod_set_track_artwork(GpodDBRef db, GpodTrackRef track, const char* imagePath);

/// Remove a track from the library entirely (also deletes the file
/// off the device on next gpod_write).
int gpod_remove_track(GpodDBRef db, GpodTrackRef track);

/// Extract a track's cover-art thumbnail as PNG bytes in a malloc'd buffer
/// (caller frees with free()), its length written to outLen. Returns NULL if
/// the track has no artwork. Byte returns keep this off the filesystem — the
/// old temp-file variant wrote every (track,size) to one deterministic path,
/// which forced callers to hold the library lock through the read-back.
unsigned char* _Nullable gpod_get_track_artwork_png_bytes(GpodTrackRef track,
                                                          int size,
                                                          int* outLen);

/// Identify the iPod mounted at `mountpoint` from iPod_Control/Device/SysInfo.
/// Does NOT parse the iTunesDB, so it stays cheap enough to run over every
/// mounted volume in the picker.
///
/// Deliberately out-params of plain types rather than a struct: a fourth
/// #[repr(C)] mirror would be a fourth thing to keep in sync by hand, and this
/// call has no hot path that would justify it.
///
/// `outFamily` is a stable lowercase slug the Rust side can match on —
/// "classic", "shuffle", "nano", "mini", "video", "photo", "color", "regular",
/// "touch", "iphone", "ipad", "mobile", "unknown". The enum-to-slug mapping
/// lives here, next to the libgpod header that defines the enum.
///
/// `outSupported` is 1 when this app can actually manage the device. That is a
/// property of the libgpod enums, so it is decided here rather than restated
/// in Rust: click-wheel iPods yes; a 1st/2nd generation Shuffle yes, because
/// gpod_write() also emits the iTunesSD its firmware reads; a 3rd/4th
/// generation Shuffle no, since that iTunesSD layout is one this libgpod does
/// not produce; Touch/iPhone/iPad never, they keep an SQLite library libgpod
/// cannot touch.
///
/// Every out-param is optional (pass NULL to skip). Returned strings are
/// malloc'd; caller frees each with free(). Returns 1 when the device was
/// positively identified, 0 when SysInfo is missing, unreadable, or carries a
/// model this libgpod's table doesn't know.
int gpod_probe_device(const char* mountpoint,
                      char* _Nullable * _Nullable outFamily,
                      char* _Nullable * _Nullable outModelName,
                      char* _Nullable * _Nullable outGeneration,
                      char* _Nullable * _Nullable outModelNumber,
                      double* _Nullable outCapacityGb,
                      int* _Nullable outSupported);

/// Layout probe for the hand-written Rust mirrors of the three structs above.
/// Nothing checks those mirrors at compile time — a field added on one side
/// only silently shifts every field after it — so a test compares these
/// numbers instead. `which`: 0 = GpodTrackInfo, 1 = GpodTrackEdit,
/// 2 = GpodImportSpec. Size alone would miss two same-width fields swapped,
/// hence the offset of each struct's last member as well.
unsigned long gpod_abi_size(int which);
unsigned long gpod_abi_last_offset(int which);

#ifdef __cplusplus
}
#endif

#endif /* GpodBridge_h */
