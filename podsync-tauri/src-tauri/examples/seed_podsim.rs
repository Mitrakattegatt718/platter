//! Dev fixture: seeds a fake iPod volume (e.g. /Volumes/PODSIM) through the
//! same GpodBridge C functions the app uses — real iTunesDB, real artwork
//! thumbnails, real copied files. Build script link directives are
//! package-wide, so the example links gpodhelpers without touching the app.
//!
//!   cargo run --example seed_podsim -- /tmp/podsim-src/manifest.txt /Volumes/PODSIM

use podsync_tauri_lib::gpod::{self, GpodDbRef, GpodTrackRef};
use std::ffi::CString;
use std::os::raw::c_char;

/// Bridge errors come back as strdup'd strings — take and free them.
unsafe fn take_err(ptr: *mut c_char) -> String {
    unsafe { gpod::take_c_string(ptr) }.unwrap_or_else(|| "unknown error".into())
}

fn main() {
    let manifest = std::env::args().nth(1).expect("usage: seed_podsim <manifest> [mount]");
    let mount = std::env::args().nth(2).unwrap_or_else(|| "/Volumes/PODSIM".into());
    let text = std::fs::read_to_string(&manifest).expect("read manifest");

    let mnt = CString::new(mount.as_str()).unwrap();
    let db: GpodDbRef = unsafe {
        let mut err: *mut c_char = std::ptr::null_mut();
        let d = gpod::gpod_open(mnt.as_ptr(), &mut err);
        if d.is_null() {
            panic!("gpod_open failed: {}", take_err(err));
        }
        d
    };

    let cover_of = |slug: &str| format!("/tmp/podsim-src/covers/{slug}.png");
    let c = |s: &str| CString::new(s).unwrap();

    let (mut ok, mut fail, mut arts) = (0usize, 0usize, 0usize);
    for line in text.lines() {
        let f: Vec<&str> = line.split('|').collect();
        if f.len() != 10 {
            continue;
        }
        let (artist, album, genre, year, cover, nr, title, dur, path) =
            (f[1], f[2], f[3], f[4], f[5], f[6], f[7], f[8], f[9]);

        let tr: GpodTrackRef = unsafe {
            let mut err: *mut c_char = std::ptr::null_mut();
            let t = gpod::gpod_import_track(
                db,
                c(path).as_ptr(),
                c(title).as_ptr(),
                c(artist).as_ptr(),
                c(album).as_ptr(),
                c(genre).as_ptr(),
                nr.parse().unwrap_or(0),
                year.parse().unwrap_or(0),
                dur.parse().unwrap_or(0),
                &mut err,
            );
            if t.is_null() {
                eprintln!("FAIL {title}: {}", take_err(err));
                fail += 1;
                continue;
            }
            t
        };
        ok += 1;

        if cover != "-" {
            let art = cover_of(cover.split('@').next().unwrap());
            if unsafe { gpod::gpod_set_track_artwork(db, tr, c(&art).as_ptr()) } == 1 {
                arts += 1;
            } else {
                eprintln!("ART FAIL {title}");
            }
        }
    }

    unsafe {
        let mut err: *mut c_char = std::ptr::null_mut();
        if gpod::gpod_write(db, &mut err) != 1 {
            panic!("gpod_write failed: {}", take_err(err));
        }
        gpod::gpod_close(db);
    }
    println!("seeded {mount}: {ok} tracks, {arts} with artwork, {fail} failed");
}
