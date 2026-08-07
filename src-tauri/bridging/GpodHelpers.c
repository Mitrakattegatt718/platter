//
//  GpodHelpers.c
//  Implementation of GpodBridge.h using real libgpod + GLib calls.
//
#include "GpodBridge.h"
#include <gpod/itdb.h>
#include <gdk-pixbuf/gdk-pixbuf.h>
#include <glib.h>
#include <string.h>
#include <stdlib.h>
#include <time.h>
#include <stdio.h>

// libgpod stores has_artwork as a raw guint8: 0x01 = yes, 0x02 = no.
// 0x00 (uninitialized) causes the Classic to silently drop the track.
#define PODSYNC_HAS_ARTWORK_YES 0x01
#define PODSYNC_HAS_ARTWORK_NO  0x02

static char* dup_gerror(GError* err) {
    if (!err) return strdup("Unknown error");
    char* msg = strdup(err->message);
    g_error_free(err);
    return msg;
}

static char* dup_or_null(const char* s) {
    return s ? strdup(s) : NULL;
}

GpodDBRef gpod_open(const char* mountpoint, char** errOut) {
    GError* error = NULL;
    Itdb_iTunesDB* itdb = itdb_parse(mountpoint, &error);
    if (itdb) return (GpodDBRef)itdb;

    // Start a fresh library ONLY when the device genuinely has no database.
    // A parse that failed for any other reason — unreadable volume, corrupt
    // iTunesDB — has to surface as an error: quietly substituting an empty
    // library would wipe the device's real one on the next write.
    char* dbPath = g_build_filename(mountpoint, "iPod_Control", "iTunes", "iTunesDB", NULL);
    gboolean dbExists = g_file_test(dbPath, G_FILE_TEST_EXISTS);
    g_free(dbPath);

    if (dbExists) {
        if (errOut) *errOut = dup_gerror(error);
        else if (error) g_error_free(error);
        return NULL;
    }
    if (error) g_error_free(error);

    itdb = itdb_new();
    itdb_set_mountpoint(itdb, mountpoint);

    // A brand-new Itdb_iTunesDB has no playlists at all, so don't ask it for
    // its master playlist first — itdb_playlist_mpl() asserts on an empty list.
    Itdb_Playlist* mpl = itdb_playlist_new("iPod", FALSE);
    itdb_playlist_set_mpl(mpl);
    itdb_playlist_add(itdb, mpl, 0);

    return (GpodDBRef)itdb;
}

int gpod_write(GpodDBRef dbRef, char** errOut) {
    Itdb_iTunesDB* itdb = (Itdb_iTunesDB*)dbRef;
    int n = (int)g_list_length(itdb->tracks);
    const char* mp = itdb_get_mountpoint(itdb);
    fprintf(stderr, "[podsync] gpod_write: %d tracks, mountpoint=%s\n", n, mp ? mp : "(null)");
    GError* error = NULL;
    gboolean ok = itdb_write(itdb, &error);
    if (!ok) {
        fprintf(stderr, "[podsync] itdb_write FAILED: %s\n", error ? error->message : "unknown");
        if (errOut) *errOut = dup_gerror(error);
        return 0;
    }
    fprintf(stderr, "[podsync] itdb_write OK\n");
    return 1;
}

void gpod_close(GpodDBRef dbRef) {
    Itdb_iTunesDB* itdb = (Itdb_iTunesDB*)dbRef;
    if (itdb) itdb_free(itdb);
}

int gpod_track_count(GpodDBRef dbRef) {
    Itdb_iTunesDB* itdb = (Itdb_iTunesDB*)dbRef;
    return (int)g_list_length(itdb->tracks);
}

static void fill_info(Itdb_Track* tr, GpodTrackInfo* out) {
    out->ref = (GpodTrackRef)tr;
    out->title = dup_or_null(tr->title);
    out->artist = dup_or_null(tr->artist);
    out->album = dup_or_null(tr->album);
    out->genre = dup_or_null(tr->genre);
    out->filetype = dup_or_null(tr->filetype);
    out->track_nr = tr->track_nr;
    out->cd_nr = tr->cd_nr;
    out->year = tr->year;
    out->bitrate = tr->bitrate;
    out->duration_ms = tr->tracklen;
    out->size_bytes = (long long)tr->size;
    // libgpod already converts the DB's Mac-epoch timestamps to host time_t.
    out->time_added = (long long)tr->time_added;
    out->has_artwork = (tr->has_artwork == PODSYNC_HAS_ARTWORK_YES) ? 1 : 0;
}

int gpod_track_at(GpodDBRef dbRef, int index, GpodTrackInfo* outInfo) {
    Itdb_iTunesDB* itdb = (Itdb_iTunesDB*)dbRef;
    GList* node = g_list_nth(itdb->tracks, (guint)index);
    if (!node) return 0;
    Itdb_Track* tr = (Itdb_Track*)node->data;
    fill_info(tr, outInfo);
    return 1;
}

void gpod_free_track_info(GpodTrackInfo* info) {
    if (!info) return;
    free(info->title);
    free(info->artist);
    free(info->album);
    free(info->genre);
    free(info->filetype);
    info->title = info->artist = info->album = info->genre = info->filetype = NULL;
}

GpodTrackInfo* gpod_tracks_collect(GpodDBRef dbRef, int* outCount) {
    Itdb_iTunesDB* itdb = (Itdb_iTunesDB*)dbRef;
    int count = (int)g_list_length(itdb->tracks);
    if (outCount) *outCount = count;
    if (count == 0) return NULL;

    GpodTrackInfo* array = calloc((size_t)count, sizeof(GpodTrackInfo));
    if (!array) {
        if (outCount) *outCount = 0;
        return NULL;
    }
    int i = 0;
    for (GList* node = itdb->tracks; node && i < count; node = node->next, i++) {
        fill_info((Itdb_Track*)node->data, &array[i]);
    }
    if (outCount) *outCount = i;
    return array;
}

void gpod_tracks_collect_free(GpodTrackInfo* array, int count) {
    if (!array) return;
    for (int i = 0; i < count; i++) {
        gpod_free_track_info(&array[i]);
    }
    free(array);
}

GpodTrackRef gpod_import_track(GpodDBRef dbRef,
                                const char* sourceFilePath,
                                const char* title,
                                const char* artist,
                                const char* album,
                                const char* genre,
                                int track_nr,
                                int year,
                                int duration_ms,
                                char** errOut) {
    Itdb_iTunesDB* itdb = (Itdb_iTunesDB*)dbRef;
    Itdb_Track* track = itdb_track_new();

    track->title = title ? g_strdup(title) : g_strdup("Unknown Title");
    track->artist = artist ? g_strdup(artist) : g_strdup("Unknown Artist");
    track->album = album ? g_strdup(album) : g_strdup("Unknown Album");
    track->genre = genre ? g_strdup(genre) : g_strdup("");
    track->track_nr = track_nr;
    track->year = year;
    track->tracklen = duration_ms;

    // Determine filetype from extension for the mediatype flag.
    const char* ext = strrchr(sourceFilePath, '.');
    if (ext && (strcasecmp(ext, ".m4a") == 0 || strcasecmp(ext, ".aac") == 0)) {
        track->filetype = g_strdup("AAC audio file");
    } else {
        track->filetype = g_strdup("MP3 audio file");
    }
    track->mediatype = ITDB_MEDIATYPE_AUDIO;
    // The Classic silently drops tracks with has_artwork=0x00 (unknown).
    // Set to 0x02 (no) — gpod_set_track_artwork flips it to 0x01 if art is added.
    track->has_artwork = PODSYNC_HAS_ARTWORK_NO;
    // Stamped here rather than left to libgpod so "Recently Added" ordering
    // is meaningful for tracks this app puts on the device.
    track->time_added = time(NULL);

    itdb_track_add(itdb, track, -1);

    Itdb_Playlist* mpl = itdb_playlist_mpl(itdb);
    if (!mpl) {
        fprintf(stderr, "[podsync] WARNING: no master playlist — track will not appear in iPod Music menu\n");
    } else {
        itdb_playlist_add_track(mpl, track, -1);
    }

    GError* error = NULL;
    if (!itdb_cp_track_to_ipod(track, sourceFilePath, &error)) {
        if (errOut) *errOut = dup_gerror(error);
        fprintf(stderr, "[podsync] itdb_cp_track_to_ipod FAILED for %s\n", sourceFilePath);
        // itdb_track_unlink only removes from the track GList, not from
        // playlists — remove from the MPL first to avoid a dangling
        // reference that would corrupt the iTunesDB on the next write.
        if (mpl) itdb_playlist_remove_track(mpl, track);
        itdb_track_unlink(track);
        itdb_track_free(track);
        return NULL;
    }

    fprintf(stderr, "[podsync] imported OK: \"%s\" -> ipod_path=%s transferred=%d size=%u\n",
            title, track->ipod_path ? track->ipod_path : "(null)",
            track->transferred, track->size);

    return (GpodTrackRef)track;
}

int gpod_update_track_metadata(GpodDBRef dbRef,
                                GpodTrackRef trackRef,
                                const char* title,
                                const char* artist,
                                const char* album,
                                const char* genre,
                                int track_nr,
                                int year) {
    (void)dbRef;
    Itdb_Track* track = (Itdb_Track*)trackRef;
    if (!track) return 0;

    if (title)  { g_free(track->title);  track->title  = g_strdup(title); }
    if (artist) { g_free(track->artist); track->artist = g_strdup(artist); }
    if (album)  { g_free(track->album);  track->album  = g_strdup(album); }
    if (genre)  { g_free(track->genre);  track->genre  = g_strdup(genre); }
    if (track_nr >= 0) track->track_nr = track_nr;
    if (year >= 0) track->year = year;

    return 1;
}

int gpod_set_track_artwork(GpodDBRef dbRef, GpodTrackRef trackRef, const char* imagePath) {
    (void)dbRef;
    Itdb_Track* track = (Itdb_Track*)trackRef;
    if (!track || !imagePath) return 0;

    // itdb_track_set_thumbnails doesn't take a GError** — it returns
    // FALSE on failure.  On failure it cleans up the artwork itself
    // (sets has_artwork to 0x02), so we just propagate the result.
    if (!itdb_track_set_thumbnails(track, imagePath)) {
        return 0;
    }
    track->has_artwork = PODSYNC_HAS_ARTWORK_YES;
    return 1;
}

int gpod_remove_track(GpodDBRef dbRef, GpodTrackRef trackRef) {
    Itdb_iTunesDB* itdb = (Itdb_iTunesDB*)dbRef;
    Itdb_Track* track = (Itdb_Track*)trackRef;
    if (!track) return 0;

    Itdb_Playlist* mpl = itdb_playlist_mpl(itdb);
    if (mpl) itdb_playlist_remove_track(mpl, track);
    itdb_track_unlink(track);
    itdb_track_free(track);
    return 1;
}

char* gpod_get_track_artwork_png(GpodTrackRef trackRef, int size) {
    Itdb_Track* track = (Itdb_Track*)trackRef;
    if (!track) return NULL;

    GdkPixbuf* pixbuf = (GdkPixbuf*)itdb_track_get_thumbnail(track, size, size);
    if (!pixbuf) return NULL;

    const char* tmpdir = g_get_tmp_dir();
    char filename[512];
    snprintf(filename, sizeof(filename), "%s/podsync_art_%u_%d.png",
             tmpdir, (unsigned)track->dbid, size);

    GError* error = NULL;
    if (!gdk_pixbuf_save(pixbuf, filename, "png", &error, NULL)) {
        fprintf(stderr, "[podsync] artwork save failed: %s\n",
                error ? error->message : "unknown");
        if (error) g_error_free(error);
        g_object_unref(pixbuf);
        return NULL;
    }
    g_object_unref(pixbuf);
    return strdup(filename);
}
