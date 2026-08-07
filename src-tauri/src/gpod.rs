//! Hand-written FFI for GpodBridge.h. The header is 11 functions of plain C
//! types by design (it was written to import cleanly into Swift), so bindgen
//! would be more machinery than the declarations it generates.

use std::os::raw::{c_char, c_int, c_longlong, c_void};

pub type GpodDbRef = *mut c_void;
pub type GpodTrackRef = *mut c_void;

/// Mirrors GpodTrackInfo exactly — field order and types must match the C
/// struct or gpod_track_at scribbles over the wrong offsets.
#[repr(C)]
pub struct GpodTrackInfo {
    pub track_ref: GpodTrackRef,
    pub title: *mut c_char,
    pub artist: *mut c_char,
    pub album: *mut c_char,
    pub genre: *mut c_char,
    pub filetype: *mut c_char,
    pub track_nr: c_int,
    pub cd_nr: c_int,
    pub year: c_int,
    pub bitrate: c_int,
    pub duration_ms: c_int,
    pub size_bytes: c_longlong,
    pub time_added: c_longlong,
    pub has_artwork: c_int,
}

extern "C" {
    pub fn gpod_open(mountpoint: *const c_char, err_out: *mut *mut c_char) -> GpodDbRef;
    pub fn gpod_write(db: GpodDbRef, err_out: *mut *mut c_char) -> c_int;
    pub fn gpod_close(db: GpodDbRef);
    pub fn gpod_tracks_collect(db: GpodDbRef, out_count: *mut c_int) -> *mut GpodTrackInfo;
    pub fn gpod_tracks_collect_free(array: *mut GpodTrackInfo, count: c_int);
    #[allow(clippy::too_many_arguments)]
    pub fn gpod_import_track(
        db: GpodDbRef,
        source_file_path: *const c_char,
        title: *const c_char,
        artist: *const c_char,
        album: *const c_char,
        genre: *const c_char,
        track_nr: c_int,
        year: c_int,
        duration_ms: c_int,
        err_out: *mut *mut c_char,
    ) -> GpodTrackRef;
    #[allow(clippy::too_many_arguments)]
    pub fn gpod_update_track_metadata(
        db: GpodDbRef,
        track: GpodTrackRef,
        title: *const c_char,
        artist: *const c_char,
        album: *const c_char,
        genre: *const c_char,
        track_nr: c_int,
        year: c_int,
    ) -> c_int;
    pub fn gpod_set_track_artwork(
        db: GpodDbRef,
        track: GpodTrackRef,
        image_path: *const c_char,
    ) -> c_int;
    pub fn gpod_remove_track(db: GpodDbRef, track: GpodTrackRef) -> c_int;
    pub fn gpod_get_track_artwork_png(track: GpodTrackRef, size: c_int) -> *mut c_char;
}

/// Takes ownership of a strdup'd C string (or NULL) and frees it.
pub unsafe fn take_c_string(ptr: *mut c_char) -> Option<String> {
    if ptr.is_null() {
        return None;
    }
    let s = std::ffi::CStr::from_ptr(ptr).to_string_lossy().into_owned();
    libc::free(ptr as *mut c_void);
    Some(s)
}
