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
    /// Artwork as malloc'd PNG bytes; caller frees with libc::free.
    pub fn gpod_get_track_artwork_png_bytes(
        track: GpodTrackRef,
        size: c_int,
        out_len: *mut c_int,
    ) -> *mut u8;
    /// Identify the device from SysInfo alone. All out-params optional;
    /// returned strings are malloc'd and freed with `take_c_string`.
    pub fn gpod_probe_device(
        mountpoint: *const c_char,
        out_family: *mut *mut c_char,
        out_model_name: *mut *mut c_char,
        out_generation: *mut *mut c_char,
        out_model_number: *mut *mut c_char,
        out_capacity_gb: *mut f64,
        out_supported: *mut c_int,
    ) -> c_int;
    pub fn gpod_abi_size(which: c_int) -> std::os::raw::c_ulong;
    pub fn gpod_abi_last_offset(which: c_int) -> std::os::raw::c_ulong;
}

/// What SysInfo says the device is. `identified` is false when SysInfo is
/// missing or names a model this libgpod doesn't know — the other fields are
/// still populated (with libgpod's "Unknown" entry), so the UI can show
/// something without pretending it recognised the device.
#[derive(Debug, Clone, PartialEq)]
pub struct DeviceInfo {
    pub identified: bool,
    /// Stable slug: "classic", "shuffle", "nano", … , "unknown".
    pub family: String,
    pub model_name: Option<String>,
    pub generation: Option<String>,
    /// Abbreviated, the way libgpod stores it — "MA350" is listed as "A350".
    pub model_number: Option<String>,
    pub capacity_gb: f64,
    /// Whether this app can manage the device. Decided by the C side, which
    /// owns the libgpod enums and has to agree with what `gpod_write` does —
    /// restating the rule here would be a second copy free to drift.
    pub supported: bool,
}

/// Serialises probes against each other. Deliberately NOT the library mutex:
/// probing allocates its own Itdb_Device, reads one SysInfo file and frees it,
/// touching no iTunesDB state, while the picker that calls this must stay
/// responsive during a long import — waiting on the library lock would make
/// listing volumes hang behind a USB copy. The "libgpod is not thread-safe"
/// invariant is about the shared database; this keeps concurrent probes from
/// overlapping without inheriting that contention.
static PROBE_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

/// Probe a mounted volume. Never fails: an unreadable or non-iPod path comes
/// back as an unidentified device.
pub fn probe_device(mountpoint: &str) -> DeviceInfo {
    let _guard = PROBE_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let Ok(c_mount) = std::ffi::CString::new(mountpoint) else {
        return DeviceInfo {
            identified: false,
            family: "unknown".to_string(),
            model_name: None,
            generation: None,
            model_number: None,
            capacity_gb: 0.0,
            supported: false,
        };
    };

    let mut family: *mut c_char = std::ptr::null_mut();
    let mut model_name: *mut c_char = std::ptr::null_mut();
    let mut generation: *mut c_char = std::ptr::null_mut();
    let mut model_number: *mut c_char = std::ptr::null_mut();
    let mut capacity_gb: f64 = 0.0;
    let mut supported: c_int = 0;

    // SAFETY: the pointers are all live locals, and the C side writes each
    // out-param exactly once (NULL on every early return).
    let identified = unsafe {
        gpod_probe_device(
            c_mount.as_ptr(),
            &mut family,
            &mut model_name,
            &mut generation,
            &mut model_number,
            &mut capacity_gb,
            &mut supported,
        )
    };

    unsafe {
        DeviceInfo {
            identified: identified != 0,
            family: take_c_string(family).unwrap_or_else(|| "unknown".to_string()),
            model_name: take_c_string(model_name),
            generation: take_c_string(generation),
            model_number: take_c_string(model_number),
            capacity_gb,
            supported: supported != 0,
        }
    }
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

    /// Exercises the bridge call, the enum-to-slug mapping and the string
    /// ownership together against a real SysInfo. Skipped when the fixture
    /// isn't mounted (CI has none) — see .claude/CLAUDE.md for how to attach
    /// it. Nothing else covers gpod_probe_device end to end.
    #[test]
    fn probes_the_fixture_ipod_when_mounted() {
        const MOUNT: &str = "/Volumes/PODSIM";
        if !std::path::Path::new(MOUNT)
            .join("iPod_Control/Device/SysInfo")
            .exists()
        {
            eprintln!("skipping: {MOUNT} is not mounted");
            return;
        }

        let info = probe_device(MOUNT);
        assert!(info.identified, "fixture should be identified: {info:?}");
        assert_eq!(info.family, "classic", "got {info:?}");
        assert!(info.supported, "a Classic must be supported: {info:?}");
        // libgpod's own name omits the "iPod" prefix — the fixture reports
        // "Classic (Black)", model number "B565" (abbreviated from the
        // SysInfo's MB565), 120 GB. Assert the family and the name agree
        // rather than pinning the exact string, which is libgpod's to change.
        let name = info.model_name.as_deref().unwrap_or_default();
        assert!(name.contains("Classic"), "name {name:?} vs {info:?}");
        assert!(info.generation.is_some(), "{info:?}");
        assert!(
            info.model_number.as_deref().is_some_and(|m| !m.is_empty()),
            "no model number: {info:?}"
        );
        assert!(info.capacity_gb > 0.0, "{info:?}");
    }

    /// The support rule lives in C (`can_manage`), and this is what pins it
    /// down from the Rust side: a 1st/2nd generation Shuffle is supported
    /// because `gpod_write` also emits its iTunesSD, while a Touch never is.
    /// Needs the mock volumes from `./make-mock-ipods.sh`; skipped without
    /// them.
    #[test]
    fn shuffle_is_supported_and_touch_is_not() {
        let cases = [
            ("/Volumes/PODSHUFFLE", "shuffle", true),
            ("/Volumes/PODTOUCH", "touch", false),
        ];
        for (mount, family, supported) in cases {
            if !std::path::Path::new(mount).exists() {
                eprintln!("skipping: {mount} is not mounted");
                continue;
            }
            let info = probe_device(mount);
            assert!(info.identified, "{mount}: {info:?}");
            assert_eq!(info.family, family, "{mount}: {info:?}");
            assert_eq!(
                info.supported, supported,
                "{mount} should have supported={supported}: {info:?}"
            );
        }
    }

    /// A path with no SysInfo must come back unidentified rather than
    /// crashing or inventing a model — this is what every non-iPod volume in
    /// /Volumes hits, and what a Classic with a wiped SysInfo hits too.
    #[test]
    fn a_path_without_sysinfo_is_unidentified() {
        let info = probe_device("/nonexistent-volume-for-tests");
        assert!(!info.identified, "{info:?}");
        assert_eq!(info.family, "unknown");
        assert!(!info.supported);
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
