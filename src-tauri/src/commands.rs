//! Tauri command layer. Every command locks the one Library mutex for the
//! whole operation, and every mutation ends with reload + save + fresh
//! snapshot — the same "edit, reload, auto-save" rhythm the Swift app had.
//!
//! All blocking work (the mutex wait, libgpod FFI, file IO, diskutil) runs
//! under spawn_blocking: commands are async and would otherwise park tokio's
//! small worker pool on the mutex — a burst of get_artwork calls during a
//! long import could stall the entire IPC runtime.

use crate::convert;
use crate::gpod::*;
use crate::library::{LibrarySnapshot, SharedLibrary};
use crate::tags::{self, PendingImport};
use base64::Engine;
use serde::Serialize;
use std::ffi::CString;
use std::path::Path;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use tauri::{AppHandle, Emitter, State};

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct Progress {
    text: String,
    /// 0…1 for countable work, None when the UI should show a spinner.
    fraction: Option<f64>,
}

fn emit_progress(app: &AppHandle, text: impl Into<String>, fraction: Option<f64>) {
    let _ = app.emit(
        "progress",
        Progress {
            text: text.into(),
            fraction,
        },
    );
}

fn c_string(s: &str) -> Result<CString, String> {
    CString::new(s).map_err(|_| "text contains a NUL byte".to_string())
}

async fn blocking<T: Send + 'static>(
    work: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(work)
        .await
        .map_err(|e| e.to_string())?
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct VolumeInfo {
    pub path: String,
    pub is_ipod: bool,
    /// Live capacity from statvfs — the picker surfaces "42.1 GB free of
    /// 160 GB" per row so the right disk is obvious before connecting.
    /// None when the lookup fails (volume unmounted mid-scan, etc.).
    pub free_bytes: Option<u64>,
    pub total_bytes: Option<u64>,
}

fn volume_capacity(path: &std::path::Path) -> Option<(u64, u64)> {
    let c_path = c_string(&path.to_string_lossy()).ok()?;
    let mut stat = std::mem::MaybeUninit::<libc::statvfs>::uninit();
    let rc = unsafe { libc::statvfs(c_path.as_ptr(), stat.as_mut_ptr()) };
    if rc != 0 {
        return None;
    }
    let stat = unsafe { stat.assume_init() };
    let block = stat.f_frsize as u64;
    Some(((stat.f_bavail as u64) * block, (stat.f_blocks as u64) * block))
}

#[tauri::command]
pub async fn list_volumes() -> Result<Vec<VolumeInfo>, String> {
    blocking(|| {
        let Ok(entries) = std::fs::read_dir("/Volumes") else {
            return Ok(Vec::new());
        };
        let mut volumes: Vec<VolumeInfo> = entries
            .flatten()
            .filter(|e| e.file_name() != "Macintosh HD")
            .map(|e| {
                let path = e.path();
                let capacity = volume_capacity(&path);
                VolumeInfo {
                    is_ipod: path.join("iPod_Control").exists(),
                    path: path.to_string_lossy().into_owned(),
                    free_bytes: capacity.map(|c| c.0),
                    total_bytes: capacity.map(|c| c.1),
                }
            })
            .collect();
        volumes.sort_by(|a, b| a.path.cmp(&b.path));
        Ok(volumes)
    })
    .await
}

#[tauri::command]
pub async fn open_library(
    state: State<'_, SharedLibrary>,
    mount_point: String,
) -> Result<LibrarySnapshot, String> {
    let lib = state.inner().clone();
    blocking(move || {
        let mut lib = lib.lock().unwrap();
        lib.open(&mount_point)?;
        Ok(lib.snapshot())
    })
    .await
}

#[tauri::command]
pub async fn close_library(state: State<'_, SharedLibrary>) -> Result<LibrarySnapshot, String> {
    let lib = state.inner().clone();
    blocking(move || {
        let mut lib = lib.lock().unwrap();
        lib.close();
        Ok(lib.snapshot())
    })
    .await
}

/// Closes the library first (nothing pending is lost — every mutation already
/// saved), then asks diskutil to spit the volume out.
#[tauri::command]
pub async fn eject_ipod(state: State<'_, SharedLibrary>) -> Result<LibrarySnapshot, String> {
    let lib = state.inner().clone();
    blocking(move || {
        let (snapshot, mount) = {
            let mut lib = lib.lock().unwrap();
            let mount = lib.mount_point().map(str::to_string);
            lib.close();
            (lib.snapshot(), mount)
        };
        let Some(mount) = mount else {
            return Ok(snapshot);
        };
        let ejected = std::process::Command::new("diskutil")
            .args(["eject", &mount])
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false);
        if !ejected {
            return Err(
                "iPod disconnected, but the volume couldn't be ejected automatically. \
                 You may need to eject it manually in Finder."
                    .into(),
            );
        }
        Ok(snapshot)
    })
    .await
}

#[tauri::command]
pub async fn save_library(state: State<'_, SharedLibrary>) -> Result<(), String> {
    let lib = state.inner().clone();
    blocking(move || lib.lock().unwrap().save()).await
}

/// Tag reading is pure Rust with no shared state, so files parse on all
/// cores; results come back in input order.
#[tauri::command]
pub async fn read_tags(app: AppHandle, paths: Vec<String>) -> Result<Vec<PendingImport>, String> {
    blocking(move || Ok(read_tags_blocking(&app, paths))).await
}

fn read_tags_blocking(app: &AppHandle, paths: Vec<String>) -> Vec<PendingImport> {
    let total = paths.len();
    if total == 0 {
        return Vec::new();
    }
    let workers = std::thread::available_parallelism()
        .map(|n| n.get())
        .unwrap_or(4)
        .min(total);
    let chunk = total.div_ceil(workers);
    let done = AtomicUsize::new(0);
    // High-water mark so parallel completions never emit a lower count after
    // a higher one — the progress bar must not move backwards.
    let emitted = AtomicUsize::new(0);

    let mut results: Vec<Option<PendingImport>> = (0..total).map(|_| None).collect();
    std::thread::scope(|s| {
        for (paths_chunk, out_chunk) in paths.chunks(chunk).zip(results.chunks_mut(chunk)) {
            let done = &done;
            let emitted = &emitted;
            s.spawn(move || {
                for (path, out) in paths_chunk.iter().zip(out_chunk.iter_mut()) {
                    *out = Some(tags::read(path));
                    let n = done.fetch_add(1, Ordering::Relaxed) + 1;
                    if emitted.fetch_max(n, Ordering::Relaxed) < n {
                        emit_progress(
                            app,
                            format!("Reading tags — {n} of {total}"),
                            Some(n as f64 / total as f64),
                        );
                    }
                }
            });
        }
    });
    results.into_iter().flatten().collect()
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ImportResult {
    pub snapshot: LibrarySnapshot,
    pub imported: usize,
    pub failures: Vec<String>,
    /// Indices into the submitted items for the entries that failed, so the
    /// import dialog can keep exactly those staged instead of wiping or
    /// re-importing everything.
    pub failed_indices: Vec<usize>,
}

#[tauri::command]
pub async fn import_tracks(
    app: AppHandle,
    state: State<'_, SharedLibrary>,
    items: Vec<PendingImport>,
) -> Result<ImportResult, String> {
    let lib = state.inner().clone();
    blocking(move || import_tracks_blocking(&app, &lib, items)).await
}

/// Pre-lock conversion pass: any staged item that isn't natively playable
/// (FLAC, WAV, hi-res ALAC, DSD…) is converted to iPod-spec ALAC first.
/// Returns the per-item source to import (None = conversion rejected it,
/// with the failure recorded), plus the scratch dir to sweep afterwards.
fn prepare_sources(
    app: &AppHandle,
    items: &[PendingImport],
) -> (
    Vec<Option<String>>,
    Vec<(usize, String)>,
    Option<std::path::PathBuf>,
) {
    let mut sources: Vec<Option<String>> = items
        .iter()
        .map(|item| Some(item.file_path.clone()))
        .collect();
    let mut failures: Vec<(usize, String)> = Vec::new();

    let mut indices: Vec<usize> = Vec::new();
    let mut work: Vec<convert::WorkItem> = Vec::new();
    for (i, item) in items.iter().enumerate() {
        if !convert::needs_prepare(Path::new(&item.file_path)) {
            continue;
        }
        let src = std::path::PathBuf::from(&item.file_path);
        let stem = src
            .file_stem()
            .map(|s| s.to_string_lossy().into_owned())
            .unwrap_or_else(|| "track".into());
        indices.push(i);
        work.push(convert::WorkItem {
            src,
            dst_name: format!("{i}/{}.m4a", stem.replace(['/', ':'], "-")),
            cue: None,
        });
    }
    if work.is_empty() {
        return (sources, failures, None);
    }

    let out_dir = convert::fresh_out_dir();
    let total = work.len();
    let emitted = AtomicUsize::new(0);
    let results = convert::prepare_batch(&work, &out_dir, &|n, name| {
        // High-water mark so parallel completions never move the bar back.
        if emitted.fetch_max(n, Ordering::Relaxed) < n {
            emit_progress(
                app,
                format!("Converting {n} of {total} — {name}"),
                Some(n as f64 / total as f64),
            );
        }
    });

    for ((&index, item), prepared) in indices.iter().zip(&work).zip(results) {
        match prepared {
            convert::Prepared::Ready(path) => {
                sources[index] = Some(path.to_string_lossy().into_owned());
            }
            convert::Prepared::Rejected(reason) => {
                sources[index] = None;
                failures.push((index, format!("{}: {reason}", item.display())));
            }
        }
    }
    (sources, failures, Some(out_dir))
}

fn import_tracks_blocking(
    app: &AppHandle,
    lib: &SharedLibrary,
    items: Vec<PendingImport>,
) -> Result<ImportResult, String> {
    // Conversion runs before the library lock: encodes are long, and holding
    // the mutex through them would stall every artwork fetch in the UI.
    let (sources, prepare_failures, scratch_dir) = prepare_sources(app, &items);

    let mut lib = lib.lock().unwrap();
    let db = lib.db()?;

    let total = items.len();
    let mut imported = 0usize;
    let mut failures = Vec::new();
    let mut failed_indices = Vec::new();
    for (index, message) in &prepare_failures {
        failures.push(message.clone());
        failed_indices.push(*index);
    }

    for (index, item) in items.iter().enumerate() {
        let Some(source) = &sources[index] else {
            continue; // conversion already recorded the failure
        };
        emit_progress(
            app,
            format!("Importing {} of {} — {}", index + 1, total, item.title),
            Some(index as f64 / total as f64),
        );

        // A converted source is a different file than the one whose tags were
        // read; lossless formats lofty can't parse stage with duration 0, so
        // recover it from the converted ALAC.
        let duration_ms = if item.duration_ms == 0 && *source != item.file_path {
            tags::read(source).duration_ms
        } else {
            item.duration_ms
        };

        let result: Result<GpodTrackRef, String> = (|| {
            let src = c_string(source)?;
            let title = c_string(&item.title)?;
            let artist = c_string(&item.artist)?;
            let album = c_string(&item.album)?;
            let genre = c_string(&item.genre)?;
            let mut err: *mut std::os::raw::c_char = std::ptr::null_mut();
            let track_ref = unsafe {
                gpod_import_track(
                    db,
                    src.as_ptr(),
                    title.as_ptr(),
                    artist.as_ptr(),
                    album.as_ptr(),
                    genre.as_ptr(),
                    item.track_number,
                    item.year,
                    duration_ms,
                    &mut err,
                )
            };
            if track_ref.is_null() {
                let msg =
                    unsafe { take_c_string(err) }.unwrap_or_else(|| "unknown error".into());
                return Err(format!("Couldn't import track: {msg}"));
            }
            Ok(track_ref)
        })();

        match result {
            Ok(track_ref) => {
                imported += 1;
                if let Some(art) = &item.artwork_path {
                    if let Ok(art_c) = c_string(art) {
                        unsafe { gpod_set_track_artwork(db, track_ref, art_c.as_ptr()) };
                    }
                }
            }
            Err(msg) => {
                failures.push(format!("{}: {msg}", item.title));
                failed_indices.push(index);
            }
        }
    }

    let saved = if imported > 0 {
        emit_progress(app, "Saving to iPod…", None);
        lib.save()
    } else {
        Ok(())
    };
    let snapshot = lib.snapshot();
    drop(lib);
    // The library copied converted files onto the iPod; the scratch ALACs
    // are dead weight now (swept even when the save failed).
    if let Some(dir) = scratch_dir {
        let _ = std::fs::remove_dir_all(dir);
    }
    saved?;
    Ok(ImportResult {
        snapshot,
        imported,
        failures,
        failed_indices,
    })
}

/// Entry point for files or folders dropped on the window: expands folders
/// and cue sheets, converts anything lossless to iPod-spec ALAC, reads tags
/// (with progress), then imports straight away.
#[tauri::command]
pub async fn import_files(
    app: AppHandle,
    state: State<'_, SharedLibrary>,
    paths: Vec<String>,
) -> Result<ImportResult, String> {
    let lib = state.inner().clone();
    blocking(move || {
        let items = convert::scan(&paths);
        if items.is_empty() {
            return Err(
                "No importable audio found. PodSync imports MP3 and M4A/AAC directly, \
                 and converts FLAC, WAV, AIFF, APE, WavPack, DSD and other lossless \
                 files (or .cue album images) to Apple Lossless for the iPod."
                    .into(),
            );
        }

        // Cue-split tracks must be rendered before tag reading — their tags
        // only exist once ffmpeg has written them into the split ALACs. The
        // batch also converts everything else lossless here, in parallel, so
        // the per-item safety net in import_tracks_blocking finds the outputs
        // already in spec and passes them straight through.
        let out_dir = convert::fresh_out_dir();
        let total = items.len();
        let emitted = AtomicUsize::new(0);
        let results = convert::prepare_batch(&items, &out_dir, &|n, name| {
            if emitted.fetch_max(n, Ordering::Relaxed) < n {
                emit_progress(
                    &app,
                    format!("Converting {n} of {total} — {name}"),
                    Some(n as f64 / total as f64),
                );
            }
        });

        let mut ready: Vec<String> = Vec::new();
        let mut rejected: Vec<String> = Vec::new();
        for (item, prepared) in items.iter().zip(results) {
            match prepared {
                convert::Prepared::Ready(path) => {
                    ready.push(path.to_string_lossy().into_owned());
                }
                convert::Prepared::Rejected(reason) => {
                    rejected.push(format!("{}: {reason}", item.display()));
                }
            }
        }

        let result = if ready.is_empty() {
            Err(rejected.join("\n"))
        } else {
            let staged = read_tags_blocking(&app, ready);
            import_tracks_blocking(&app, &lib, staged).map(|mut r| {
                r.failures.extend(rejected);
                r
            })
        };
        let _ = std::fs::remove_dir_all(&out_dir);
        result
    })
    .await
}

#[tauri::command]
pub async fn update_track(
    state: State<'_, SharedLibrary>,
    id: String,
    title: String,
    artist: String,
    album: String,
    genre: String,
    track_number: i32,
    year: i32,
) -> Result<LibrarySnapshot, String> {
    let lib = state.inner().clone();
    blocking(move || {
        let mut lib = lib.lock().unwrap();
        let db = lib.db()?;
        let track = lib.resolve(&id).ok_or("Track no longer exists.")?;
        let (t, ar, al, g) = (
            c_string(&title)?,
            c_string(&artist)?,
            c_string(&album)?,
            c_string(&genre)?,
        );
        unsafe {
            gpod_update_track_metadata(
                db,
                track,
                t.as_ptr(),
                ar.as_ptr(),
                al.as_ptr(),
                g.as_ptr(),
                track_number,
                year,
            );
        }
        lib.save()?;
        Ok(lib.snapshot())
    })
    .await
}

/// Bulk single-field edit. gpod_update_track_metadata leaves NULL strings and
/// negative numbers unchanged, so only the requested field moves.
#[tauri::command]
pub async fn set_field(
    state: State<'_, SharedLibrary>,
    ids: Vec<String>,
    field: String,
    value: String,
) -> Result<LibrarySnapshot, String> {
    let lib = state.inner().clone();
    blocking(move || {
        let mut lib = lib.lock().unwrap();
        let db = lib.db()?;
        let value_c = c_string(&value)?;
        let null = std::ptr::null();
        for id in &ids {
            let Some(track) = lib.resolve(id) else {
                continue;
            };
            let v = value_c.as_ptr();
            let (t, ar, al, g) = match field.as_str() {
                "artist" => (null, v, null, null),
                "album" => (null, null, v, null),
                "genre" => (null, null, null, v),
                other => return Err(format!("Unknown field: {other}")),
            };
            unsafe { gpod_update_track_metadata(db, track, t, ar, al, g, -1, -1) };
        }
        lib.save()?;
        Ok(lib.snapshot())
    })
    .await
}

#[tauri::command]
pub async fn set_artwork(
    state: State<'_, SharedLibrary>,
    ids: Vec<String>,
    image_path: String,
) -> Result<LibrarySnapshot, String> {
    let lib = state.inner().clone();
    blocking(move || {
        let mut lib = lib.lock().unwrap();
        let db = lib.db()?;
        let path_c = c_string(&image_path)?;
        for id in &ids {
            if let Some(track) = lib.resolve(id) {
                unsafe { gpod_set_track_artwork(db, track, path_c.as_ptr()) };
            }
        }
        lib.art_cache_evict(&ids);
        lib.save()?;
        Ok(lib.snapshot())
    })
    .await
}

#[tauri::command]
pub async fn remove_tracks(
    state: State<'_, SharedLibrary>,
    ids: Vec<String>,
) -> Result<LibrarySnapshot, String> {
    let lib = state.inner().clone();
    blocking(move || {
        let mut lib = lib.lock().unwrap();
        let db = lib.db()?;
        for id in &ids {
            if let Some(track) = lib.resolve(id) {
                unsafe { gpod_remove_track(db, track) };
            }
        }
        // Freed pointers can be reused by a later import — stale art must go.
        lib.art_cache_evict(&ids);
        lib.save()?;
        Ok(lib.snapshot())
    })
    .await
}

/// Extracts a track's cover thumbnail as a data URL. Extraction (pixbuf
/// decode + PNG encode in the C bridge) runs under the lock; the file read
/// and base64 run outside it, and finished URLs are cached per (track, size).
#[tauri::command]
pub async fn get_artwork(
    state: State<'_, SharedLibrary>,
    id: String,
    size: i32,
) -> Result<Option<String>, String> {
    let lib = state.inner().clone();
    blocking(move || {
        let Ok(ptr) = id.parse::<usize>() else {
            return Ok(None);
        };
        // Extraction AND the file read stay under the lock: the C bridge
        // writes every (track,size) to one deterministic temp path, so an
        // unlocked read could race a concurrent re-extraction truncating the
        // same file. Only the base64 encode runs outside.
        let (bytes, gen) = {
            let guard = lib.lock().unwrap();
            if let Some(hit) = guard.art_cache_get(ptr, size) {
                return Ok(Some(hit.to_string()));
            }
            let Some(track) = guard.resolve(&id) else {
                return Ok(None);
            };
            let raw = unsafe { gpod_get_track_artwork_png(track, size) };
            let Some(path) = (unsafe { take_c_string(raw) }) else {
                return Ok(None);
            };
            let Ok(bytes) = std::fs::read(&path) else {
                return Ok(None);
            };
            (bytes, guard.art_generation())
        };
        let url = format!(
            "data:image/png;base64,{}",
            base64::engine::general_purpose::STANDARD.encode(bytes)
        );
        lib.lock()
            .unwrap()
            .art_cache_put(ptr, size, gen, Arc::from(url.as_str()));
        Ok(Some(url))
    })
    .await
}
