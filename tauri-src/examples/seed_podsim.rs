//! Dev fixture: seeds a fake iPod volume (e.g. /Volumes/PODSIM) through the
//! same GpodBridge C functions the app uses — real iTunesDB, real artwork
//! thumbnails, real copied files. Build script link directives are
//! package-wide, so the example links gpodhelpers without touching the app.
//!
//!   cargo run --example seed_podsim -- <manifest> [mount]   fresh seed
//!   cargo run --example seed_podsim -- --enrich [mount]     backfill stats
//!   cargo run --example seed_podsim -- --covers [mount]     replace artwork
//!
//! --enrich patches an already-seeded volume in place (bitrate/playcount)
//! without duplicating tracks; --covers re-points every track's album art at
//! covers/<slug>.png in place (the artless fixture album keeps no art).

use platter_tauri_lib::gpod::{self, GpodDbRef, GpodImportSpec, GpodTrackInfo, GpodTrackRef};
use std::ffi::{CStr, CString};
use std::os::raw::c_char;

/// Bridge errors come back as strdup'd strings — take and free them.
unsafe fn take_err(ptr: *mut c_char) -> String {
    unsafe { gpod::take_c_string(ptr) }.unwrap_or_else(|| "unknown error".into())
}

/// The seed audio is generated stubs (~6 s clips with durations faked in the
/// manifest), so realistic stats have to be invented. Deterministic hashing
/// keeps a fresh seed and an `--enrich` run in agreement. Bitrate is per
/// album (one rip = one encoder setting); play count is per track.
fn fixture_stats(album: &str, title: &str) -> (i32, i32) {
    fn hash(s: &str) -> u32 {
        s.bytes()
            .fold(5381u32, |h, b| h.wrapping_mul(33).wrapping_add(u32::from(b)))
    }
    const TIERS: [i32; 5] = [128, 160, 192, 256, 320];
    (
        TIERS[hash(album) as usize % TIERS.len()],
        (hash(title) % 55) as i32,
    )
}

unsafe fn cstr_or(ptr: *const c_char, fallback: &str) -> String {
    if ptr.is_null() {
        return fallback.to_string();
    }
    unsafe { CStr::from_ptr(ptr) }
        .to_string_lossy()
        .into_owned()
}

unsafe fn open_db(mount: &str) -> GpodDbRef {
    let mnt = CString::new(mount).unwrap();
    unsafe {
        let mut err: *mut c_char = std::ptr::null_mut();
        let db = gpod::gpod_open(mnt.as_ptr(), &mut err);
        if db.is_null() {
            panic!("gpod_open failed: {}", take_err(err));
        }
        db
    }
}

unsafe fn write_and_close(db: GpodDbRef) {
    unsafe {
        let mut err: *mut c_char = std::ptr::null_mut();
        if gpod::gpod_write(db, &mut err) != 1 {
            panic!("gpod_write failed: {}", take_err(err));
        }
        gpod::gpod_close(db);
    }
}

/// Sets invented stats on a newly imported track.
unsafe fn apply_stats(db: GpodDbRef, tr: GpodTrackRef, album: &str, title: &str) {
    let (kbps, plays) = fixture_stats(album, title);
    unsafe { gpod::gpod_set_track_stats(db, tr, kbps, plays) };
}

fn seed(manifest: &str, mount: &str) {
    let text = std::fs::read_to_string(manifest).expect("read manifest");
    let db = unsafe { open_db(mount) };

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

        // Bound to locals, not inlined into the struct: a CString temporary
        // created inside the initializer would be dropped at the semicolon,
        // leaving the spec pointing at freed memory by the time the FFI call
        // reads it.
        let (c_path, c_title, c_artist, c_album, c_genre) =
            (c(path), c(title), c(artist), c(album), c(genre));
        let spec = GpodImportSpec {
            source_file_path: c_path.as_ptr(),
            title: c_title.as_ptr(),
            artist: c_artist.as_ptr(),
            albumartist: std::ptr::null(),
            album: c_album.as_ptr(),
            composer: std::ptr::null(),
            genre: c_genre.as_ptr(),
            track_nr: nr.parse().unwrap_or(0),
            track_count: 0,
            cd_nr: 0,
            disc_count: 0,
            year: year.parse().unwrap_or(0),
            duration_ms: dur.parse().unwrap_or(0),
            bitrate: 0,
            samplerate: 44100,
        };
        let tr: GpodTrackRef = unsafe {
            let mut err: *mut c_char = std::ptr::null_mut();
            let t = gpod::gpod_import_track(db, &spec, &mut err);
            if t.is_null() {
                eprintln!("FAIL {title}: {}", take_err(err));
                fail += 1;
                continue;
            }
            t
        };
        ok += 1;

        unsafe { apply_stats(db, tr, album, title) };

        if cover != "-" {
            let art = cover_of(cover.split('@').next().unwrap());
            if unsafe { gpod::gpod_set_track_artwork(db, tr, c(&art).as_ptr()) } == 1 {
                arts += 1;
            } else {
                eprintln!("ART FAIL {title}");
            }
        }
    }

    unsafe { write_and_close(db) };
    println!("seeded {mount}: {ok} tracks, {arts} with artwork, {fail} failed");
}

fn enrich(mount: &str) {
    unsafe {
        let db = open_db(mount);
        let mut count: i32 = 0;
        let arr = gpod::gpod_tracks_collect(db, &mut count);
        if arr.is_null() {
            gpod::gpod_close(db);
            panic!("{mount}: no tracks to enrich");
        }
        let infos = std::slice::from_raw_parts(arr, count as usize);
        let mut touched = 0usize;
        for info in infos {
            let album = cstr_or(info.album, "");
            let title = cstr_or(info.title, "");
            apply_stats(db, info.track_ref, &album, &title);
            touched += 1;
        }
        gpod::gpod_tracks_collect_free(arr, count);
        write_and_close(db);

        // Reopen and read back to prove the stats landed in the on-disk
        // iTunesDB, not just the in-memory copy we wrote from.
        let db = open_db(mount);
        let mut count: i32 = 0;
        let arr = gpod::gpod_tracks_collect(db, &mut count);
        println!("enriched {mount}: {touched} tracks; read-back (first 5):");
        if !arr.is_null() {
            let infos: &[GpodTrackInfo] = std::slice::from_raw_parts(arr, count as usize);
            for info in infos.iter().take(5) {
                let title = cstr_or(info.title, "?");
                println!(
                    "  {:<40.40} {:>3} kbps  {:>2} plays",
                    title, info.bitrate, info.playcount
                );
            }
            gpod::gpod_tracks_collect_free(arr, count);
        }
        gpod::gpod_close(db);
    }
}

/// Re-points each track's artwork at covers/<album-slug>.png (the manifest's
/// cover field is the album title with spaces as hyphens). Tracks whose album
/// has no cover file — the fixture's intentionally artless album — are left
/// untouched, so "has no art" stays representable.
fn covers(mount: &str) {
    unsafe {
        let db = open_db(mount);
        let mut count: i32 = 0;
        let arr = gpod::gpod_tracks_collect(db, &mut count);
        if arr.is_null() {
            gpod::gpod_close(db);
            panic!("{mount}: no tracks to cover");
        }
        let infos = std::slice::from_raw_parts(arr, count as usize);
        let (mut set, mut skip) = (0usize, 0usize);
        for info in infos {
            let album = cstr_or(info.album, "");
            let path = format!("/tmp/podsim-src/covers/{}.png", album.replace(' ', "-"));
            if !std::path::Path::new(&path).exists() {
                skip += 1;
                continue;
            }
            let c = CString::new(path).unwrap();
            if gpod::gpod_set_track_artwork(db, info.track_ref, c.as_ptr()) == 1 {
                set += 1;
            } else {
                eprintln!("ART FAIL {}", cstr_or(info.title, "?"));
            }
        }
        gpod::gpod_tracks_collect_free(arr, count);
        write_and_close(db);
        println!("covered {mount}: {set} tracks updated, {skip} left as-is");
    }
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    match args.first().map(String::as_str) {
        Some("--enrich") => enrich(args.get(1).map(String::as_str).unwrap_or("/Volumes/PODSIM")),
        Some("--covers") => covers(args.get(1).map(String::as_str).unwrap_or("/Volumes/PODSIM")),
        Some(manifest) => seed(
            manifest,
            args.get(1).map(String::as_str).unwrap_or("/Volumes/PODSIM"),
        ),
        None => {
            eprintln!(
                "usage: seed_podsim <manifest> [mount] | --enrich [mount] | --covers [mount]"
            );
            std::process::exit(1);
        }
    }
}
