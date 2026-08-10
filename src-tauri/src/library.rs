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
    /// Empty when unset — which is meaningful: the Classic groups albums by
    /// this field and only falls back to `artist` when it's absent.
    pub album_artist: String,
    pub album: String,
    pub composer: String,
    pub genre: String,
    pub file_type: String,
    pub track_number: i32,
    /// Tracks on this disc, 0 when unset — the "of 12" in "3 of 12".
    pub track_count: i32,
    pub disc_number: i32,
    pub disc_count: i32,
    pub year: i32,
    pub bitrate: i32,
    /// Hz; 0 when the DB never recorded one.
    pub sample_rate: i32,
    pub duration_ms: i32,
    pub size_bytes: i64,
    /// Unix epoch seconds; None when the device never recorded one.
    pub date_added: Option<i64>,
    pub has_artwork: bool,
    /// Lifetime plays as of this open. libgpod merges the device's "Play
    /// Counts" file during itdb_parse, so fresh plays are already included —
    /// but only in memory until the next save writes them into the iTunesDB.
    /// `rating` and `last_played` arrive by the same route.
    pub play_count: i32,
    /// 0-100, 20 per star. 0 = unrated.
    pub rating: i32,
    /// Unix epoch seconds of the LAST play; None when never played. The
    /// device keeps no history beyond this one timestamp.
    pub last_played: Option<i64>,
    /// The DB's own colon-separated device path, e.g.
    /// ":iPod_Control:Music:F04:ABCD.mp3". Empty when the DB has none.
    pub ipod_path: String,
    /// False means the DB has a record with no audio file behind it.
    pub transferred: bool,
    pub has_drm: bool,
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
    /// Insertion order of art_cache keys, for FIFO eviction at the cap —
    /// scrolling a several-thousand-album library must not grow the map
    /// without bound.
    art_order: std::collections::VecDeque<(usize, i32)>,
    /// Bumped whenever cached art could be stale (open/close/evict). An
    /// extraction that started before the bump must not be inserted after it
    /// — art_cache_put checks the generation captured at extraction time.
    art_gen: u64,
    /// True when in-memory changes haven't been flushed to the device yet.
    dirty: bool,
    /// When the last mutation happened — the auto-flush thread waits for a
    /// short idle window so rapid edits coalesce into one iTunesDB write.
    last_dirty_at: Option<std::time::Instant>,
}

/// Thumbnails kept in memory. 80px PNGs run 10-40 KB of base64 each, so this
/// bounds the cache somewhere around a few tens of MB.
const ART_CACHE_CAP: usize = 512;

// Raw pointers strip Send; sound here because the pointer is only ever used
// while holding the Mutex that owns this struct.
unsafe impl Send for Library {}

pub type SharedLibrary = Arc<Mutex<Library>>;

pub fn new_shared() -> SharedLibrary {
    let lib = Arc::new(Mutex::new(Library {
        db: None,
        mount_point: None,
        live_refs: HashSet::new(),
        art_cache: HashMap::new(),
        art_order: std::collections::VecDeque::new(),
        art_gen: 0,
        dirty: false,
        last_dirty_at: None,
    }));
    spawn_auto_flush(lib.clone());
    lib
}

/// Polls every 500ms and flushes if the library has been dirty for >1.5s.
/// Coalesces rapid edits (bulk tag writes, a flurry of metadata tweaks) into
/// a single iTunesDB write, cutting flash wear and UI stalls. Runs for the
/// app's lifetime; the lock is held only for the brief dirty check and the
/// occasional flush.
fn spawn_auto_flush(lib: SharedLibrary) {
    std::thread::spawn(move || loop {
        std::thread::sleep(std::time::Duration::from_millis(500));
        let should_flush = {
            let lib = lib.lock().unwrap();
            lib.dirty
                && lib
                    .last_dirty_at
                    .map(|t| t.elapsed() > std::time::Duration::from_millis(1500))
                    .unwrap_or(false)
        };
        if should_flush {
            let mut lib = lib.lock().unwrap();
            let _ = lib.flush_if_dirty();
        }
    });
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
        // Flush unsaved changes before dropping the handle — the auto-flush
        // thread can't run after close, and the user's edits must survive.
        let _ = self.flush_if_dirty();
        if let Some(db) = self.db.take() {
            unsafe { gpod_close(db) };
        }
        self.mount_point = None;
        self.live_refs.clear();
        self.art_cache.clear();
        self.art_order.clear();
        self.art_gen += 1;
        self.dirty = false;
        self.last_dirty_at = None;
    }

    /// Marks the library dirty — the auto-flush thread will write it to the
    /// device after a short idle window. Cheaper than save() for rapid edits.
    pub fn mark_dirty(&mut self) {
        self.dirty = true;
        self.last_dirty_at = Some(std::time::Instant::now());
    }

    /// Writes the iTunesDB only if there are unsaved changes.
    pub fn flush_if_dirty(&mut self) -> Result<(), String> {
        if self.dirty {
            self.save()?;
        }
        Ok(())
    }

    pub fn save(&mut self) -> Result<(), String> {
        let db = self.db.ok_or("No iPod library is open.")?;
        // Best-effort backup: an interrupted gpod_write can corrupt the
        // iTunesDB and brick the iPod's library. The on-device .bak is the
        // simplest recovery point — a failed backup doesn't block the
        // write (the user still wants their edit saved).
        if let Some(mount) = &self.mount_point {
            let db_path = std::path::Path::new(mount)
                .join("iPod_Control/iTunes/iTunesDB");
            let bak_path = std::path::Path::new(mount)
                .join("iPod_Control/iTunes/iTunesDB.bak");
            let _ = std::fs::copy(&db_path, &bak_path);
        }
        let mut err: *mut std::os::raw::c_char = std::ptr::null_mut();
        if unsafe { gpod_write(db, &mut err) } == 0 {
            let msg = unsafe { take_c_string(err) }.unwrap_or_else(|| "unknown error".into());
            return Err(format!("Couldn't save changes to iPod: {msg}"));
        }
        self.dirty = false;
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
        if gen != self.art_gen || !self.live_refs.contains(&ptr) {
            return;
        }
        let key = (ptr, size);
        // Re-insertion of an existing key must not double-book the deque.
        if !self.art_cache.contains_key(&key) {
            self.art_order.push_back(key);
        }
        self.art_cache.insert(key, data_url);
        while self.art_order.len() > ART_CACHE_CAP {
            if let Some(evicted) = self.art_order.pop_front() {
                self.art_cache.remove(&evicted);
            }
        }
    }

    /// Drops cached art for the given track ids — after their art changed, or
    /// after removal (a freed pointer may be reused by a later import).
    pub fn art_cache_evict(&mut self, ids: &[String]) {
        let ptrs: HashSet<usize> = ids.iter().filter_map(|id| id.parse().ok()).collect();
        self.art_cache.retain(|(ptr, _), _| !ptrs.contains(ptr));
        self.art_order.retain(|(ptr, _)| !ptrs.contains(ptr));
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
                album_artist: take(info.albumartist),
                album: take(info.album),
                composer: take(info.composer),
                genre: take(info.genre),
                file_type: take(info.filetype),
                track_number: info.track_nr,
                track_count: info.track_count,
                disc_number: info.cd_nr,
                disc_count: info.disc_count,
                year: info.year,
                bitrate: info.bitrate,
                sample_rate: info.samplerate,
                duration_ms: info.duration_ms,
                size_bytes: info.size_bytes,
                date_added: (info.time_added > 0).then_some(info.time_added),
                has_artwork: info.has_artwork == 1,
                play_count: info.playcount,
                rating: info.rating,
                last_played: (info.time_played > 0).then_some(info.time_played),
                ipod_path: take(info.ipod_path),
                transferred: info.transferred == 1,
                has_drm: info.has_drm == 1,
            });
        }
        unsafe { gpod_tracks_collect_free(array, count) };

        // Base order matches the Swift app; the frontend re-sorts per view.
        tracks.sort_by_cached_key(|t| t.artist.to_lowercase());
        tracks
    }

    fn capacity(&self) -> Option<Capacity> {
        let info = crate::fsinfo::fs_info(std::path::Path::new(self.mount_point.as_deref()?))?;
        Some(Capacity {
            free_bytes: info.free_bytes as i64,
            total_bytes: info.total_bytes as i64,
        })
    }

    pub fn db(&self) -> Result<GpodDbRef, String> {
        self.db.ok_or_else(|| "No iPod library is open.".into())
    }
}
