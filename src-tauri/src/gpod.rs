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
    pub albumartist: *mut c_char,
    pub album: *mut c_char,
    pub composer: *mut c_char,
    pub genre: *mut c_char,
    pub filetype: *mut c_char,
    pub ipod_path: *mut c_char,
    pub track_nr: c_int,
    pub track_count: c_int,
    pub cd_nr: c_int,
    pub disc_count: c_int,
    pub year: c_int,
    pub bitrate: c_int,
    pub samplerate: c_int,
    pub duration_ms: c_int,
    pub size_bytes: c_longlong,
    pub time_added: c_longlong,
    pub has_artwork: c_int,
    pub playcount: c_int,
    pub rating: c_int,
    pub time_played: c_longlong,
    pub transferred: c_int,
    pub has_drm: c_int,
}

/// Mirrors GpodTrackEdit. NULL strings and negative numbers mean "leave as
/// is", so `GpodTrackEdit::unchanged()` plus one assignment is a single-field
/// bulk edit.
#[repr(C)]
pub struct GpodTrackEdit {
    pub title: *const c_char,
    pub artist: *const c_char,
    pub albumartist: *const c_char,
    pub album: *const c_char,
    pub composer: *const c_char,
    pub genre: *const c_char,
    pub track_nr: c_int,
    pub track_count: c_int,
    pub cd_nr: c_int,
    pub disc_count: c_int,
    pub year: c_int,
}

impl GpodTrackEdit {
    pub fn unchanged() -> Self {
        Self {
            title: std::ptr::null(),
            artist: std::ptr::null(),
            albumartist: std::ptr::null(),
            album: std::ptr::null(),
            composer: std::ptr::null(),
            genre: std::ptr::null(),
            track_nr: -1,
            track_count: -1,
            cd_nr: -1,
            disc_count: -1,
            year: -1,
        }
    }
}

/// Mirrors GpodImportSpec.
#[repr(C)]
pub struct GpodImportSpec {
    pub source_file_path: *const c_char,
    pub title: *const c_char,
    pub artist: *const c_char,
    pub albumartist: *const c_char,
    pub album: *const c_char,
    pub composer: *const c_char,
    pub genre: *const c_char,
    pub track_nr: c_int,
    pub track_count: c_int,
    pub cd_nr: c_int,
    pub disc_count: c_int,
    pub year: c_int,
    pub duration_ms: c_int,
    pub bitrate: c_int,
    pub samplerate: c_int,
}

extern "C" {
    pub fn gpod_open(mountpoint: *const c_char, err_out: *mut *mut c_char) -> GpodDbRef;
    pub fn gpod_write(db: GpodDbRef, err_out: *mut *mut c_char) -> c_int;
    pub fn gpod_close(db: GpodDbRef);
    pub fn gpod_tracks_collect(db: GpodDbRef, out_count: *mut c_int) -> *mut GpodTrackInfo;
    pub fn gpod_tracks_collect_free(array: *mut GpodTrackInfo, count: c_int);
    pub fn gpod_import_track(
        db: GpodDbRef,
        spec: *const GpodImportSpec,
        err_out: *mut *mut c_char,
    ) -> GpodTrackRef;
    pub fn gpod_update_track_metadata(
        db: GpodDbRef,
        track: GpodTrackRef,
        edit: *const GpodTrackEdit,
    ) -> c_int;
    pub fn gpod_set_track_stats(
        db: GpodDbRef,
        track: GpodTrackRef,
        bitrate: c_int,
        playcount: c_int,
    ) -> c_int;
    pub fn gpod_set_track_artwork(
        db: GpodDbRef,
        track: GpodTrackRef,
        image_path: *const c_char,
    ) -> c_int;
    pub fn gpod_remove_track(db: GpodDbRef, track: GpodTrackRef) -> c_int;
    pub fn gpod_get_track_artwork_png(track: GpodTrackRef, size: c_int) -> *mut c_char;
    pub fn gpod_abi_size(which: c_int) -> std::os::raw::c_ulong;
    pub fn gpod_abi_last_offset(which: c_int) -> std::os::raw::c_ulong;
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The three #[repr(C)] structs above are hand-transcribed from
    /// GpodBridge.h, and nothing in the toolchain checks that transcription:
    /// a field added on one side only shifts every field after it and the FFI
    /// starts reading adjacent memory. Comparing sizes and the last member's
    /// offset against the C compiler's own numbers catches that at test time.
    #[test]
    fn repr_c_mirrors_match_the_header() {
        let cases = [
            (
                0,
                "GpodTrackInfo",
                std::mem::size_of::<GpodTrackInfo>(),
                std::mem::offset_of!(GpodTrackInfo, has_drm),
            ),
            (
                1,
                "GpodTrackEdit",
                std::mem::size_of::<GpodTrackEdit>(),
                std::mem::offset_of!(GpodTrackEdit, year),
            ),
            (
                2,
                "GpodImportSpec",
                std::mem::size_of::<GpodImportSpec>(),
                std::mem::offset_of!(GpodImportSpec, samplerate),
            ),
        ];
        for (which, name, size, last) in cases {
            assert_eq!(
                unsafe { gpod_abi_size(which) } as usize,
                size,
                "{name}: sizeof disagrees with GpodBridge.h"
            );
            assert_eq!(
                unsafe { gpod_abi_last_offset(which) } as usize,
                last,
                "{name}: last field offset disagrees with GpodBridge.h"
            );
        }
    }
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
