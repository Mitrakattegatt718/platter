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
#include <stddef.h>
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
    out->albumartist = dup_or_null(tr->albumartist);
    out->album = dup_or_null(tr->album);
    out->composer = dup_or_null(tr->composer);
    out->genre = dup_or_null(tr->genre);
    out->filetype = dup_or_null(tr->filetype);
    out->ipod_path = dup_or_null(tr->ipod_path);
    out->track_nr = tr->track_nr;
    out->track_count = tr->tracks;
    out->cd_nr = tr->cd_nr;
    out->disc_count = tr->cds;
    out->year = tr->year;
    out->bitrate = tr->bitrate;
    out->samplerate = tr->samplerate;
    out->duration_ms = tr->tracklen;
    out->size_bytes = (long long)tr->size;
    // libgpod already converts the DB's Mac-epoch timestamps to host time_t.
    out->time_added = (long long)tr->time_added;
    out->has_artwork = (tr->has_artwork == PODSYNC_HAS_ARTWORK_YES) ? 1 : 0;
    out->playcount = (int)tr->playcount;
    out->rating = (int)tr->rating;
    out->time_played = (long long)tr->time_played;
    out->transferred = tr->transferred ? 1 : 0;
    out->has_drm = (tr->drm_userid != 0) ? 1 : 0;
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
    free(info->albumartist);
    free(info->album);
    free(info->composer);
    free(info->genre);
    free(info->filetype);
    free(info->ipod_path);
    info->title = info->artist = info->albumartist = info->album = NULL;
    info->composer = info->genre = info->filetype = info->ipod_path = NULL;
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
                                const GpodImportSpec* spec,
                                char** errOut) {
    if (!spec || !spec->source_file_path) return NULL;
    const char* sourceFilePath = spec->source_file_path;
    Itdb_iTunesDB* itdb = (Itdb_iTunesDB*)dbRef;
    Itdb_Track* track = itdb_track_new();

    track->title = spec->title ? g_strdup(spec->title) : g_strdup("Unknown Title");
    track->artist = spec->artist ? g_strdup(spec->artist) : g_strdup("Unknown Artist");
    track->album = spec->album ? g_strdup(spec->album) : g_strdup("Unknown Album");
    track->genre = spec->genre ? g_strdup(spec->genre) : g_strdup("");
    // Left NULL when absent: an empty albumartist is not the same as none —
    // the Classic falls back to the track artist only when the field is unset.
    if (spec->albumartist && *spec->albumartist) {
        track->albumartist = g_strdup(spec->albumartist);
    }
    if (spec->composer && *spec->composer) {
        track->composer = g_strdup(spec->composer);
    }
    track->track_nr = spec->track_nr;
    track->tracks = spec->track_count;
    track->cd_nr = spec->cd_nr;
    track->cds = spec->disc_count;
    track->year = spec->year;
    track->tracklen = spec->duration_ms;
    // Both stay 0 when the tag reader couldn't work them out; the iPod copes,
    // and 0 is what the DB held before this was passed through at all.
    track->bitrate = spec->bitrate;
    // libgpod's samplerate is a guint16, so anything past 65535 Hz would wrap
    // to a plausible-looking wrong number. convert.rs already brings hi-res
    // down to the 44.1/48 kHz family before import, so this only fires if
    // something bypasses that — leave 0 rather than write a lie. Assigned
    // before itdb_track_add below, which mirrors it into samplerate2.
    if (spec->samplerate > 0 && spec->samplerate <= 65535) {
        track->samplerate = (guint16)spec->samplerate;
    }

    // This string is load-bearing, not decoration: itdb_track_set_defaults()
    // string-matches it to pick the unk126/unk144 pair the device expects.
    // Falling through to "MP3 audio file" for a WAV or AIFF writes MP3's
    // values into the iTunesDB — a knowingly wrong record.
    const char* ext = strrchr(sourceFilePath, '.');
    if (ext && (strcasecmp(ext, ".m4a") == 0 || strcasecmp(ext, ".aac") == 0)) {
        track->filetype = g_strdup("AAC audio file");
    } else if (ext && strcasecmp(ext, ".wav") == 0) {
        track->filetype = g_strdup("WAV audio file");
    } else if (ext && (strcasecmp(ext, ".aiff") == 0 || strcasecmp(ext, ".aif") == 0)) {
        track->filetype = g_strdup("AIFF audio file");
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
            track->title, track->ipod_path ? track->ipod_path : "(null)",
            track->transferred, track->size);

    return (GpodTrackRef)track;
}

/// Replaces a string field, or clears it back to NULL when the caller passes
/// "". Clearing matters for albumartist and composer: an empty string is a
/// present-but-blank tag, which the Classic sorts under its own heading.
static void set_str(gchar** field, const char* value) {
    if (!value) return;
    g_free(*field);
    *field = *value ? g_strdup(value) : NULL;
}

int gpod_update_track_metadata(GpodDBRef dbRef,
                                GpodTrackRef trackRef,
                                const GpodTrackEdit* edit) {
    (void)dbRef;
    Itdb_Track* track = (Itdb_Track*)trackRef;
    if (!track || !edit) return 0;

    // title/artist/album/genre keep the old replace-with-whatever-came-in
    // behaviour; set_str's clear-on-empty only bites for fields the iPod
    // treats as optional.
    if (edit->title)  { g_free(track->title);  track->title  = g_strdup(edit->title); }
    if (edit->artist) { g_free(track->artist); track->artist = g_strdup(edit->artist); }
    if (edit->album)  { g_free(track->album);  track->album  = g_strdup(edit->album); }
    if (edit->genre)  { g_free(track->genre);  track->genre  = g_strdup(edit->genre); }
    set_str(&track->albumartist, edit->albumartist);
    set_str(&track->composer, edit->composer);
    if (edit->track_nr >= 0) track->track_nr = edit->track_nr;
    if (edit->track_count >= 0) track->tracks = edit->track_count;
    if (edit->cd_nr >= 0) track->cd_nr = edit->cd_nr;
    if (edit->disc_count >= 0) track->cds = edit->disc_count;
    if (edit->year >= 0) track->year = edit->year;

    return 1;
}

unsigned long gpod_abi_size(int which) {
    switch (which) {
        case 0: return (unsigned long)sizeof(GpodTrackInfo);
        case 1: return (unsigned long)sizeof(GpodTrackEdit);
        case 2: return (unsigned long)sizeof(GpodImportSpec);
        default: return 0;
    }
}

unsigned long gpod_abi_last_offset(int which) {
    switch (which) {
        case 0: return (unsigned long)offsetof(GpodTrackInfo, has_drm);
        case 1: return (unsigned long)offsetof(GpodTrackEdit, year);
        case 2: return (unsigned long)offsetof(GpodImportSpec, samplerate);
        default: return 0;
    }
}

int gpod_set_track_stats(GpodDBRef dbRef, GpodTrackRef trackRef, int bitrate, int playcount) {
    (void)dbRef;
    Itdb_Track* track = (Itdb_Track*)trackRef;
    if (!track) return 0;
    if (bitrate > 0) track->bitrate = (guint32)bitrate;
    if (playcount >= 0) track->playcount = (guint32)playcount;
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
