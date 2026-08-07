//! Owns the open Itdb_iTunesDB handle. libgpod is not thread-safe, so every
//! touch of the handle happens while holding the one `Mutex<Library>` — the
//! same serialization the Swift app got from its dedicated DispatchQueue.

use crate::gpod::*;
use serde::Serialize;
use std::collections::{HashMap, HashSet};
use std::ffi::CString;
use std::sync::{Arc, Mutex};

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Track {
    /// The Itdb_Track pointer, stringified. Stable for the lifetime of the
    /// open DB (libgpod never relocates tracks), and JSON strings dodge the
    /// 2^53 precision cliff a JS number would risk.
    pub id: String,
    pub title: String,
    pub artist: String,
    pub album: String,
    pub genre: String,
    pub file_type: String,
    pub track_number: i32,
    pub year: i32,
    pub bitrate: i32,
    pub duration_ms: i32,
    pub size_bytes: i64,
    /// Unix epoch seconds; None when the device never recorded one.
    pub date_added: Option<i64>,
    pub has_artwork: bool,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Capacity {
    pub free_bytes: i64,
    pub total_bytes: i64,
}

/// Everything the frontend needs after any mutation — mirrors the Swift app's
/// reloadTracks + refreshCapacity pair firing after every operation.
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct LibrarySnapshot {
    pub mount_point: Option<String>,
    pub tracks: Vec<Track>,
    pub capacity: Option<Capacity>,
}

pub struct Library {
    db: Option<GpodDbRef>,
    mount_point: Option<String>,
    /// Track refs as of the last reload. Commands resolve incoming ids
    /// against this so a stale id from the frontend can't be dereferenced.
    live_refs: HashSet<usize>,
    /// Finished artwork data URLs keyed by (track ptr, size). Extraction is a
    /// pixbuf decode + PNG encode per call in the C bridge, so hits matter.
    /// Entries are evicted when a track's art changes or the track is removed
    /// (pointer values can be reused by a later import), and the whole map is
    /// dropped on open/close.
    art_cache: HashMap<(usize, i32), Arc<str>>,
    /// Bumped whenever cached art could be stale (open/close/evict). An
    /// extraction that started before the bump must not be inserted after it
    /// — art_cache_put checks the generation captured at extraction time.
    art_gen: u64,
}

// Raw pointers strip Send; sound here because the pointer is only ever used
// while holding the Mutex that owns this struct.
unsafe impl Send for Library {}

pub type SharedLibrary = Arc<Mutex<Library>>;

pub fn new_shared() -> SharedLibrary {
    Arc::new(Mutex::new(Library {
        db: None,
        mount_point: None,
        live_refs: HashSet::new(),
        art_cache: HashMap::new(),
        art_gen: 0,
    }))
}

impl Library {
    pub fn mount_point(&self) -> Option<&str> {
        self.mount_point.as_deref()
    }

    pub fn open(&mut self, mount_point: &str) -> Result<(), String> {
        self.close();
        let c_mount = CString::new(mount_point).map_err(|_| "invalid mount point")?;
        let mut err: *mut std::os::raw::c_char = std::ptr::null_mut();
        let db = unsafe { gpod_open(c_mount.as_ptr(), &mut err) };
        if db.is_null() {
            let msg = unsafe { take_c_string(err) }.unwrap_or_else(|| "unknown error".into());
            return Err(format!("Couldn't open iPod library: {msg}"));
        }
        self.db = Some(db);
        self.mount_point = Some(mount_point.to_string());
        self.art_gen += 1;
        Ok(())
    }

    pub fn close(&mut self) {
        if let Some(db) = self.db.take() {
            unsafe { gpod_close(db) };
        }
        self.mount_point = None;
        self.live_refs.clear();
        self.art_cache.clear();
        self.art_gen += 1;
    }

    pub fn save(&mut self) -> Result<(), String> {
        let db = self.db.ok_or("No iPod library is open.")?;
        let mut err: *mut std::os::raw::c_char = std::ptr::null_mut();
        if unsafe { gpod_write(db, &mut err) } == 0 {
            let msg = unsafe { take_c_string(err) }.unwrap_or_else(|| "unknown error".into());
            return Err(format!("Couldn't save changes to iPod: {msg}"));
        }
        Ok(())
    }

    /// Resolves a frontend id back to a track ref, refusing anything that
    /// wasn't in the last reload.
    pub fn resolve(&self, id: &str) -> Option<GpodTrackRef> {
        let ptr: usize = id.parse().ok()?;
        self.live_refs.contains(&ptr).then_some(ptr as GpodTrackRef)
    }

    pub fn art_cache_get(&self, ptr: usize, size: i32) -> Option<Arc<str>> {
        self.art_cache.get(&(ptr, size)).cloned()
    }

    pub fn art_generation(&self) -> u64 {
        self.art_gen
    }

    /// `gen` is the generation captured under the lock that did the
    /// extraction. A mismatch means the art could have changed (replace,
    /// remove + pointer reuse, reopen) between extraction and insert — the
    /// stale result must be dropped, not cached.
    pub fn art_cache_put(&mut self, ptr: usize, size: i32, gen: u64, data_url: Arc<str>) {
        if gen == self.art_gen && self.live_refs.contains(&ptr) {
            self.art_cache.insert((ptr, size), data_url);
        }
    }

    /// Drops cached art for the given track ids — after their art changed, or
    /// after removal (a freed pointer may be reused by a later import).
    pub fn art_cache_evict(&mut self, ids: &[String]) {
        let ptrs: HashSet<usize> = ids.iter().filter_map(|id| id.parse().ok()).collect();
        self.art_cache.retain(|(ptr, _), _| !ptrs.contains(ptr));
        self.art_gen += 1;
    }

    pub fn snapshot(&mut self) -> LibrarySnapshot {
        LibrarySnapshot {
            mount_point: self.mount_point.clone(),
            tracks: self.reload_tracks(),
            capacity: self.capacity(),
        }
    }

    fn reload_tracks(&mut self) -> Vec<Track> {
        self.live_refs.clear();
        let Some(db) = self.db else {
            return Vec::new();
        };
        // One linear walk of the GList — gpod_track_at would restart from the
        // list head per index, which is quadratic in library size.
        let mut count: i32 = 0;
        let array = unsafe { gpod_tracks_collect(db, &mut count) };
        if array.is_null() || count <= 0 {
            return Vec::new();
        }
        let infos = unsafe { std::slice::from_raw_parts(array, count as usize) };

        let take = |p: *mut std::os::raw::c_char| -> String {
            if p.is_null() {
                String::new()
            } else {
                unsafe { std::ffi::CStr::from_ptr(p) }
                    .to_string_lossy()
                    .into_owned()
            }
        };

        let mut tracks = Vec::with_capacity(count as usize);
        for info in infos {
            let ptr = info.track_ref as usize;
            self.live_refs.insert(ptr);
            tracks.push(Track {
                id: ptr.to_string(),
                title: take(info.title),
                artist: take(info.artist),
                album: take(info.album),
                genre: take(info.genre),
                file_type: take(info.filetype),
                track_number: info.track_nr,
                year: info.year,
                bitrate: info.bitrate,
                duration_ms: info.duration_ms,
                size_bytes: info.size_bytes,
                date_added: (info.time_added > 0).then_some(info.time_added),
                has_artwork: info.has_artwork == 1,
            });
        }
        unsafe { gpod_tracks_collect_free(array, count) };

        // Base order matches the Swift app; the frontend re-sorts per view.
        tracks.sort_by_cached_key(|t| t.artist.to_lowercase());
        tracks
    }

    fn capacity(&self) -> Option<Capacity> {
        let mount = self.mount_point.as_deref()?;
        let c_mount = CString::new(mount).ok()?;
        let mut stat: libc::statfs = unsafe { std::mem::zeroed() };
        if unsafe { libc::statfs(c_mount.as_ptr(), &mut stat) } != 0 {
            return None;
        }
        let bsize = stat.f_bsize as i64;
        Some(Capacity {
            free_bytes: stat.f_bavail as i64 * bsize,
            total_bytes: stat.f_blocks as i64 * bsize,
        })
    }

    pub fn db(&self) -> Result<GpodDbRef, String> {
        self.db.ok_or_else(|| "No iPod library is open.".into())
    }
}
