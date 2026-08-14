//! Tauri command layer. Every command locks the one Library mutex for the
//! whole operation, and every mutation ends with reload + save + fresh
//! snapshot — the same "edit, reload, auto-save" rhythm the Swift app had.
//!
//! All blocking work (the mutex wait, libgpod FFI, file IO, diskutil) runs
//! under spawn_blocking: commands are async and would otherwise park tokio's
//! small worker pool on the mutex — a burst of get_artwork calls during a
//! long import could stall the entire IPC runtime.

use crate::convert;
use crate::convert_job;
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

/// Wall-clock throttle for IPC progress events. One event per file is fine
/// for an album drop; for a ten-thousand-file batch it means ten thousand
/// events and ten thousand React state updates on the other end. `force`
/// delivers boundary states regardless of the clock.
struct ProgressThrottle {
    app: AppHandle,
    last: std::sync::Mutex<Option<std::time::Instant>>,
}

impl ProgressThrottle {
    fn new(app: &AppHandle) -> Self {
        Self {
            app: app.clone(),
            last: std::sync::Mutex::new(None),
        }
    }

    fn emit(&self, text: impl Into<String>, fraction: Option<f64>, force: bool) {
        {
            let mut last = self.last.lock().unwrap();
            let now = std::time::Instant::now();
            if !force
                && last.is_some_and(|t| now.duration_since(t).as_millis() < 100)
            {
                return;
            }
            *last = Some(now);
        }
        emit_progress(&self.app, text, fraction);
    }
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
    let info = crate::fsinfo::fs_info(path)?;
    Some((info.free_bytes, info.total_bytes))
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

/// Opens the System Settings pane where the user grants removable-volume
/// access (macOS TCC — "Operation not permitted" when it's missing). The
/// pane shows per-app toggles under Files & Folders; the app must be quit
/// and relaunched after granting.
#[tauri::command]
pub async fn open_privacy_settings() -> Result<(), String> {
    #[cfg(target_os = "macos")]
    std::process::Command::new("open")
        .arg("x-apple.systempreferences:com.apple.preference.security?Privacy_FilesAndFolders")
        .spawn()
        .map_err(|e| format!("Couldn't open System Settings: {e}"))?;
    Ok(())
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
    let throttle = ProgressThrottle::new(app);

    let mut results: Vec<Option<PendingImport>> = (0..total).map(|_| None).collect();
    std::thread::scope(|s| {
        for (paths_chunk, out_chunk) in paths.chunks(chunk).zip(results.chunks_mut(chunk)) {
            let done = &done;
            let emitted = &emitted;
            let throttle = &throttle;
            s.spawn(move || {
                for (path, out) in paths_chunk.iter().zip(out_chunk.iter_mut()) {
                    *out = Some(tags::read(path));
                    let n = done.fetch_add(1, Ordering::Relaxed) + 1;
                    if emitted.fetch_max(n, Ordering::Relaxed) < n {
                        throttle.emit(
                            format!("Reading tags — {n} of {total}"),
                            Some(n as f64 / total as f64),
                            n == total,
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
            dst_stem: format!("{i}/{}", stem.replace(['/', ':'], "-")),
            cue: None,
            probe: None,
        });
    }
    if work.is_empty() {
        return (sources, failures, None);
    }

    let out_dir = convert::fresh_out_dir();
    let total = work.len();
    let emitted = AtomicUsize::new(0);
    let throttle = ProgressThrottle::new(app);
    let results = convert::prepare_batch(
        &work,
        &out_dir,
        &convert::TargetSpec::alac(),
        &convert::ConvertControl::default(),
        &convert::ProgressOnly(&|n, name| {
            // High-water mark so parallel completions never move the bar back.
            if emitted.fetch_max(n, Ordering::Relaxed) < n {
                throttle.emit(
                    format!("Converting {n} of {total} — {name}"),
                    Some(n as f64 / total as f64),
                    n == total,
                );
            }
        }),
    );

    for ((&index, item), prepared) in indices.iter().zip(&work).zip(results) {
        match prepared {
            convert::Prepared::Ready(path) => {
                sources[index] = Some(path.to_string_lossy().into_owned());
            }
            convert::Prepared::Rejected(reason) => {
                sources[index] = None;
                failures.push((index, format!("{}: {reason}", item.display())));
            }
            // Unreachable on the import path — it passes a control that is
            // never cancelled — but silence here would be a dropped file.
            convert::Prepared::Cancelled => {
                sources[index] = None;
                failures.push((index, format!("{}: cancelled", item.display())));
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

    let throttle = ProgressThrottle::new(app);
    for (index, item) in items.iter().enumerate() {
        let Some(source) = &sources[index] else {
            continue; // conversion already recorded the failure
        };
        throttle.emit(
            format!("Importing {} of {} — {}", index + 1, total, item.title),
            Some(index as f64 / total as f64),
            index + 1 == total,
        );

        // A converted source is a different file than the one whose tags were
        // read; lossless formats lofty can't parse stage with duration 0, so
        // recover it from the converted ALAC. Bitrate and sample rate belong
        // to the converted stream either way, so they always come from there.
        let converted = *source != item.file_path;
        let probed = (converted || item.duration_ms == 0).then(|| tags::read(source));
        let duration_ms = match &probed {
            Some(p) if item.duration_ms == 0 => p.duration_ms,
            _ => item.duration_ms,
        };
        let (bitrate, sample_rate) = match &probed {
            Some(p) => (p.bitrate, p.sample_rate),
            None => (item.bitrate, item.sample_rate),
        };

        let result: Result<GpodTrackRef, String> = (|| {
            let src = c_string(source)?;
            let title = c_string(&item.title)?;
            let artist = c_string(&item.artist)?;
            let album_artist = c_string(&item.album_artist)?;
            let album = c_string(&item.album)?;
            let composer = c_string(&item.composer)?;
            let genre = c_string(&item.genre)?;
            let spec = GpodImportSpec {
                source_file_path: src.as_ptr(),
                title: title.as_ptr(),
                artist: artist.as_ptr(),
                albumartist: album_artist.as_ptr(),
                album: album.as_ptr(),
                composer: composer.as_ptr(),
                genre: genre.as_ptr(),
                track_nr: item.track_number,
                track_count: item.track_count,
                cd_nr: item.disc_number,
                disc_count: item.disc_count,
                year: item.year,
                duration_ms,
                bitrate,
                samplerate: sample_rate,
            };
            let mut err: *mut std::os::raw::c_char = std::ptr::null_mut();
            let track_ref = unsafe { gpod_import_track(db, &spec, &mut err) };
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
        let throttle = ProgressThrottle::new(&app);
        let results = convert::prepare_batch(
            &items,
            &out_dir,
            &convert::TargetSpec::alac(),
            &convert::ConvertControl::default(),
            &convert::ProgressOnly(&|n, name| {
                if emitted.fetch_max(n, Ordering::Relaxed) < n {
                    throttle.emit(
                        format!("Converting {n} of {total} — {name}"),
                        Some(n as f64 / total as f64),
                        n == total,
                    );
                }
            }),
        );

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
                convert::Prepared::Cancelled => {
                    rejected.push(format!("{}: cancelled", item.display()));
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

/// Full inspector save. Every field is sent, so unlike set_field this stamps
/// blanks too — clearing Album Artist in the panel must actually clear it.
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrackFields {
    pub title: String,
    pub artist: String,
    pub album_artist: String,
    pub album: String,
    pub composer: String,
    pub genre: String,
    pub track_number: i32,
    pub track_count: i32,
    pub disc_number: i32,
    pub disc_count: i32,
    pub year: i32,
}

#[tauri::command]
pub async fn update_track(
    state: State<'_, SharedLibrary>,
    id: String,
    fields: TrackFields,
) -> Result<LibrarySnapshot, String> {
    let lib = state.inner().clone();
    blocking(move || {
        let mut lib = lib.lock().unwrap();
        let db = lib.db()?;
        let track = lib.resolve(&id).ok_or("Track no longer exists.")?;
        let (t, ar, aa, al, co, g) = (
            c_string(&fields.title)?,
            c_string(&fields.artist)?,
            c_string(&fields.album_artist)?,
            c_string(&fields.album)?,
            c_string(&fields.composer)?,
            c_string(&fields.genre)?,
        );
        let edit = GpodTrackEdit {
            title: t.as_ptr(),
            artist: ar.as_ptr(),
            albumartist: aa.as_ptr(),
            album: al.as_ptr(),
            composer: co.as_ptr(),
            genre: g.as_ptr(),
            track_nr: fields.track_number,
            track_count: fields.track_count,
            cd_nr: fields.disc_number,
            disc_count: fields.disc_count,
            year: fields.year,
        };
        unsafe { gpod_update_track_metadata(db, track, &edit) };
        lib.mark_dirty();
        Ok(lib.snapshot())
    })
    .await
}

/// Bulk single-field edit. GpodTrackEdit::unchanged() leaves every field
/// alone, so only the one the caller names moves.
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
        for id in &ids {
            let Some(track) = lib.resolve(id) else {
                continue;
            };
            let mut edit = GpodTrackEdit::unchanged();
            let v = value_c.as_ptr();
            match field.as_str() {
                "artist" => edit.artist = v,
                "albumArtist" => edit.albumartist = v,
                "album" => edit.album = v,
                "composer" => edit.composer = v,
                "genre" => edit.genre = v,
                other => return Err(format!("Unknown field: {other}")),
            }
            unsafe { gpod_update_track_metadata(db, track, &edit) };
        }
        lib.mark_dirty();
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
        lib.mark_dirty();
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
        lib.mark_dirty();
        Ok(lib.snapshot())
    })
    .await
}

// ------------------------------------------------------------------- converter

/// What this build can actually produce. Probed from ffmpeg's own buildconf,
/// so a trimmed bundle greys out what it can't encode instead of failing at
/// the end of a long job.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FormatOption {
    pub format: convert::TargetFormat,
    pub label: String,
    pub ext: String,
    pub ipod_playable: bool,
    pub lossless: bool,
    /// None = usable; Some(reason) = greyed out with that reason shown.
    pub unavailable: Option<String>,
    pub encoder: String,
}

#[tauri::command]
pub async fn convert_formats() -> Result<Vec<FormatOption>, String> {
    blocking(|| {
        use convert::TargetFormat::*;
        let enc = convert::encoders();
        let have_tools = convert::tools().is_some();
        Ok([Alac, Aac, Mp3, Aiff, Wav, Flac]
            .into_iter()
            .map(|format| {
                let encoder = match format {
                    Alac => "alac",
                    Aac if enc.aac_at => "aac_at",
                    Aac => "aac",
                    Mp3 => "libmp3lame",
                    Aiff => "pcm_s16be",
                    Wav => "pcm_s16le",
                    Flac => "flac",
                };
                let unavailable = if !have_tools {
                    Some("no ffmpeg available".to_string())
                } else if format == Mp3 && !enc.lame {
                    // ffmpeg ships no native MP3 encoder at all, so this is a
                    // hard absence rather than a quality downgrade.
                    Some("this build of ffmpeg has no MP3 encoder".to_string())
                } else {
                    None
                };
                FormatOption {
                    format,
                    label: format.label().to_string(),
                    ext: format.ext().to_string(),
                    ipod_playable: format.ipod_playable(),
                    lossless: format.is_lossless(),
                    unavailable,
                    encoder: encoder.to_string(),
                }
            })
            .collect())
    })
    .await
}

#[tauri::command]
pub async fn convert_add(
    queue: State<'_, convert_job::SharedQueue>,
    lib: State<'_, SharedLibrary>,
    paths: Vec<String>,
) -> Result<Vec<convert_job::SourceRow>, String> {
    let queue = queue.inner().clone();
    let lib = lib.inner().clone();
    blocking(move || {
        let tools = convert::tools().ok_or(convert::FFMPEG_MISSING)?;
        let scanned = convert::scan(&paths);
        // Read the mount before taking the queue lock; never hold both.
        let mount = lib.lock().unwrap().mount_point().map(str::to_string);
        // Short lock to diff, NO lock for the probing (the slow part), then a
        // short lock to insert — see probe_items for why.
        let fresh = {
            let mut q = queue.lock().unwrap();
            q.ipod_mount = mount;
            q.fresh_of(scanned)
        };
        let probed = convert_job::probe_items(&fresh, &tools.ffprobe);
        let mut q = queue.lock().unwrap();
        q.insert_probed(fresh, probed);
        Ok(q.rows(None))
    })
    .await
}

#[tauri::command]
pub async fn convert_remove(
    queue: State<'_, convert_job::SharedQueue>,
    ids: Vec<u64>,
) -> Result<Vec<convert_job::SourceRow>, String> {
    let queue = queue.inner().clone();
    blocking(move || {
        let mut q = queue.lock().unwrap();
        q.remove(&ids);
        Ok(q.rows(None))
    })
    .await
}

#[tauri::command]
pub async fn convert_clear(
    queue: State<'_, convert_job::SharedQueue>,
) -> Result<Vec<convert_job::SourceRow>, String> {
    let queue = queue.inner().clone();
    blocking(move || {
        let mut q = queue.lock().unwrap();
        q.clear();
        Ok(q.rows(None))
    })
    .await
}

/// Pure arithmetic over the already-probed queue plus one statfs. No ffprobe,
/// no ffmpeg — cheap enough to call on every settings change.
#[tauri::command]
pub async fn convert_estimate(
    queue: State<'_, convert_job::SharedQueue>,
    lib: State<'_, SharedLibrary>,
    target: convert::TargetSpec,
    destination: convert_job::Destination,
) -> Result<ConvertEstimateResult, String> {
    let queue = queue.inner().clone();
    let lib = lib.inner().clone();
    blocking(move || {
        let mount = lib.lock().unwrap().mount_point().map(str::to_string);
        let mut q = queue.lock().unwrap();
        q.ipod_mount = mount;
        Ok(ConvertEstimateResult {
            estimate: convert_job::estimate(&q, &target, &destination)?,
            rows: q.rows(Some(&target)),
        })
    })
    .await
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConvertEstimateResult {
    pub estimate: convert_job::Estimate,
    /// Returned alongside so a format change re-marks blocked rows in one
    /// round trip instead of two.
    pub rows: Vec<convert_job::SourceRow>,
}

/// Sets the cancel flag and kills in-flight ffmpeg children.
///
/// Deliberately NOT async and deliberately never touching the library mutex:
/// routed through `blocking()` it would queue behind the very job it is meant
/// to stop, and the button would appear dead.
#[tauri::command]
pub fn cancel_convert(queue: State<'_, convert_job::SharedQueue>) -> Result<(), String> {
    // Clone the Arc out and drop the lock before killing anything.
    let control = queue.lock().unwrap().control.clone();
    control.cancel();
    Ok(())
}

/// Emits `convert:progress`, `convert:log` and `convert:items` for a running
/// job.
///
/// Log lines and item statuses are batched: with `-progress pipe:1` and up to
/// eight workers, one emit per line floods the IPC channel and freezes the
/// webview.
struct JobEvents {
    app: AppHandle,
    job_id: u64,
    total: usize,
    /// Queue row ids, index-aligned with the batch, so a per-item status can
    /// name the row it belongs to.
    ids: Vec<u64>,
    seq: AtomicUsize,
    done: AtomicUsize,
    /// Display name of the most recently started file.
    current: std::sync::Mutex<String>,
    pending: std::sync::Mutex<Vec<serde_json::Value>>,
    pending_items: std::sync::Mutex<Vec<serde_json::Value>>,
    last_flush: std::sync::Mutex<std::time::Instant>,
    /// None until the first converting-phase emit, which must always land.
    last_progress: std::sync::Mutex<Option<std::time::Instant>>,
}

impl JobEvents {
    fn new(app: AppHandle, job_id: u64, ids: Vec<u64>, total: usize) -> Self {
        Self {
            app,
            job_id,
            total,
            ids,
            seq: AtomicUsize::new(0),
            done: AtomicUsize::new(0),
            current: std::sync::Mutex::new(String::new()),
            pending: std::sync::Mutex::new(Vec::new()),
            pending_items: std::sync::Mutex::new(Vec::new()),
            last_flush: std::sync::Mutex::new(std::time::Instant::now()),
            last_progress: std::sync::Mutex::new(None),
        }
    }

    fn emit_progress(&self, phase: &str, file_fraction: Option<f64>) {
        // started/finished/file_progress all flow through here; with stream-copy
        // and tiny files that's several events per file, each one waking the
        // webview for a full re-render. Phase changes go through immediately;
        // steady-state converting updates don't need more than ~10/s.
        if phase == "converting" {
            let mut last = self.last_progress.lock().unwrap();
            let now = std::time::Instant::now();
            if last.is_some_and(|t| now.duration_since(t).as_millis() < 100) {
                return;
            }
            *last = Some(now);
        }
        let done = self.done.load(Ordering::Relaxed);
        let _ = self.app.emit(
            "convert:progress",
            serde_json::json!({
                "jobId": self.job_id,
                "phase": phase,
                "done": done,
                "total": self.total,
                "fraction": if self.total > 0 { Some(done as f64 / self.total as f64) } else { None },
                "current": self.current.lock().unwrap().clone(),
                "fileFraction": file_fraction,
            }),
        );
    }

    fn push_line(&self, level: &'static str, file: Option<&str>, line: &str) {
        let seq = self.seq.fetch_add(1, Ordering::Relaxed);
        self.pending.lock().unwrap().push(serde_json::json!({
            "seq": seq,
            "level": level,
            "file": file,
            "line": line,
        }));
        self.maybe_flush(false);
    }

    /// Status of one batch item, addressed by its index in the batch.
    fn push_status(&self, index: usize, status: &'static str, detail: Option<&str>) {
        let Some(&id) = self.ids.get(index) else {
            return;
        };
        self.push_status_id(id, status, detail);
    }

    fn push_status_id(&self, id: u64, status: &'static str, detail: Option<&str>) {
        self.pending_items.lock().unwrap().push(serde_json::json!({
            "id": id,
            "status": status,
            "detail": detail,
        }));
        self.maybe_flush(false);
    }

    fn maybe_flush(&self, force: bool) {
        let mut last = self.last_flush.lock().unwrap();
        if !force && last.elapsed() < std::time::Duration::from_millis(120) {
            return;
        }
        let lines: Vec<_> = std::mem::take(&mut *self.pending.lock().unwrap());
        let updates: Vec<_> = std::mem::take(&mut *self.pending_items.lock().unwrap());
        *last = std::time::Instant::now();
        drop(last);
        if !lines.is_empty() {
            let _ = self.app.emit(
                "convert:log",
                serde_json::json!({ "jobId": self.job_id, "lines": lines }),
            );
        }
        if !updates.is_empty() {
            let _ = self.app.emit(
                "convert:items",
                serde_json::json!({ "jobId": self.job_id, "updates": updates }),
            );
        }
    }
}

impl convert::ConvertObserver for JobEvents {
    fn started(&self, index: usize, name: &str) {
        *self.current.lock().unwrap() = name.to_string();
        self.push_status(index, "converting", None);
        self.emit_progress("converting", Some(0.0));
    }

    fn file_progress(&self, _index: usize, fraction: f64) {
        self.emit_progress("converting", Some(fraction));
    }

    fn log(&self, level: &'static str, file: Option<&str>, line: &str) {
        self.push_line(level, file, line);
    }

    fn item_done(&self, index: usize, outcome: &convert::Prepared) {
        match outcome {
            convert::Prepared::Ready(_) => self.push_status(index, "converted", None),
            convert::Prepared::Rejected(reason) => {
                self.push_status(index, "failed", Some(reason.as_str()))
            }
            convert::Prepared::Cancelled => self.push_status(index, "cancelled", None),
        }
    }

    fn finished(&self, done: usize, _name: &str) {
        // High-water mark: up to eight workers finish out of order and the
        // bar must never move backwards.
        self.done.fetch_max(done, Ordering::Relaxed);
        self.emit_progress("converting", None);
        self.maybe_flush(true);
    }
}

/// Runs the whole job. The heavy work happens with no library lock held; the
/// mutex is taken only for the final import when the destination is the iPod.
#[tauri::command]
pub async fn convert_start(
    app: AppHandle,
    lib: State<'_, SharedLibrary>,
    queue: State<'_, convert_job::SharedQueue>,
    target: convert::TargetSpec,
    destination: convert_job::Destination,
) -> Result<convert_job::JobSummary, String> {
    let lib = lib.inner().clone();
    let queue = queue.inner().clone();
    blocking(move || {
        target.validate()?;
        if convert::tools().is_none() {
            return Err(convert::FFMPEG_MISSING.into());
        }

        // Everything the run needs, lifted out under one short lock.
        let ((ids, work), control, job_id) = {
            let mut q = queue.lock().unwrap();
            if q.is_empty() {
                return Err("Nothing to convert — add some files first.".into());
            }
            let control = q.control.clone();
            // Armed at the start, never cleared at the end: a cancel arriving
            // between runs must not leak forward into the next one.
            control.arm();
            let job_id = convert_job::next_job_id(&q);
            (convert_job::take_work(&mut q), control, job_id)
        };

        let to_ipod = matches!(destination, convert_job::Destination::Ipod);
        let out_dir = match &destination {
            convert_job::Destination::Folder { path } => convert_job::folder_out_dir(path),
            convert_job::Destination::Ipod => convert::fresh_out_dir(),
        };

        let events = JobEvents::new(app.clone(), job_id, ids.clone(), work.len());
        events.push_line(
            "cmd",
            None,
            &format!(
                "Converting {} file(s) to {} ({})",
                work.len(),
                target.format.label(),
                out_dir.display()
            ),
        );

        let prepared = convert::prepare_batch(&work, &out_dir, &target, &control, &events);
        events.maybe_flush(true);

        let cancelled = control.cancelled();
        let mut converted = 0usize;
        let mut failures = Vec::new();
        let mut ready: Vec<String> = Vec::new();
        // Row ids for `ready`, index-aligned with it, so the import's own
        // per-item outcomes can be reported against the right rows.
        let mut ready_ids: Vec<u64> = Vec::new();
        for ((item, outcome), &id) in work.iter().zip(&prepared).zip(&ids) {
            match outcome {
                convert::Prepared::Ready(path) => {
                    converted += 1;
                    ready.push(path.to_string_lossy().into_owned());
                    ready_ids.push(id);
                }
                convert::Prepared::Rejected(reason) => {
                    failures.push(format!("{}: {reason}", item.display()));
                }
                // Cancelled before it ever started: no worker touched it, so
                // no status was emitted for it either.
                convert::Prepared::Cancelled => {
                    events.push_status_id(id, "cancelled", None);
                }
            }
        }
        let output_bytes = convert_job::output_bytes(&prepared);

        // Debris from any ffmpeg the cancel killed mid-write. Runs for a
        // cancelled job too — a user's own folder must not accumulate .part.
        convert_job::sweep_parts(&out_dir);

        let mut summary = convert_job::JobSummary {
            job_id,
            converted,
            failed: failures.len(),
            cancelled,
            output_bytes,
            output_dir: Some(out_dir.to_string_lossy().into_owned()),
            failures,
        };

        if to_ipod && !cancelled && !ready.is_empty() {
            // Past this point cancelling cannot help: libgpod's copy plus a
            // full database rewrite is not resumable.
            queue
                .lock()
                .unwrap()
                .finishing
                .store(true, Ordering::Relaxed);
            events.push_line("info", None, "Importing into the iPod library…");
            for &id in &ready_ids {
                events.push_status_id(id, "importing", None);
            }
            events.maybe_flush(true);
            let _ = app.emit(
                "convert:progress",
                serde_json::json!({
                    "jobId": job_id, "phase": "importing",
                    "done": summary.converted, "total": summary.converted,
                    "fraction": 1.0, "current": "", "fileFraction": null,
                }),
            );

            let staged = read_tags_blocking(&app, ready);
            let result = import_tracks_blocking(&app, &lib, staged);
            queue
                .lock()
                .unwrap()
                .finishing
                .store(false, Ordering::Relaxed);
            // The scratch dir only exists on this path; the folder
            // destination wrote in place and must never be deleted.
            let _ = std::fs::remove_dir_all(&out_dir);
            summary.output_dir = None;
            match result {
                Ok(r) => {
                    // failed_indices indexes the submitted items, which are
                    // index-aligned with `ready` and so with `ready_ids`.
                    for (i, &id) in ready_ids.iter().enumerate() {
                        if r.failed_indices.contains(&i) {
                            events.push_status_id(id, "failed", Some("Import failed"));
                        } else {
                            events.push_status_id(id, "imported", None);
                        }
                    }
                    summary.converted = r.imported;
                    summary.failures.extend(r.failures);
                    summary.failed = summary.failures.len();
                }
                Err(e) => {
                    for &id in &ready_ids {
                        events.push_status_id(id, "failed", Some(e.as_str()));
                    }
                    summary.failures.push(e);
                    summary.failed = summary.failures.len();
                }
            }
        }

        events.push_line(
            if summary.failed > 0 { "warn" } else { "info" },
            None,
            &if cancelled {
                "Cancelled.".to_string()
            } else {
                format!(
                    "Done — {} converted, {} failed.",
                    summary.converted, summary.failed
                )
            },
        );
        events.maybe_flush(true);
        let _ = app.emit("convert:done", &summary);
        Ok(summary)
    })
    .await
}

/// Extracts a track's cover thumbnail as a data URL. Extraction (pixbuf
/// decode + PNG encode in the C bridge) runs under the lock — libgpod is not
/// thread-safe — while the base64 encode runs outside it, and finished URLs
/// are cached per (track, size). The bytes arrive through a memory buffer,
/// never a temp file.
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
        let (bytes, gen) = {
            let guard = lib.lock().unwrap();
            if let Some(hit) = guard.art_cache_get(ptr, size) {
                return Ok(Some(hit.to_string()));
            }
            let Some(track) = guard.resolve(&id) else {
                return Ok(None);
            };
            let mut len: std::os::raw::c_int = 0;
            let raw = unsafe { gpod_get_track_artwork_png_bytes(track, size, &mut len) };
            if raw.is_null() || len <= 0 {
                return Ok(None);
            }
            let bytes = unsafe { std::slice::from_raw_parts(raw, len as usize).to_vec() };
            unsafe { libc::free(raw as *mut std::os::raw::c_void) };
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
