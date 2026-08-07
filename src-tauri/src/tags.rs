//! Reads title/artist/album/genre/duration/artwork from audio files so the
//! user doesn't hand-type metadata for every import. Falls back to a
//! filename-derived title, same as the Swift app's TagReader.

use base64::Engine;
use lofty::file::TaggedFileExt;
use lofty::prelude::*;
use lofty::tag::ItemKey;
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PendingImport {
    pub file_path: String,
    pub title: String,
    pub artist: String,
    /// Blank when the file has no album-artist tag — the iPod then falls back
    /// to the track artist, which is the behaviour compilations depend on.
    #[serde(default)]
    pub album_artist: String,
    pub album: String,
    #[serde(default)]
    pub composer: String,
    pub genre: String,
    pub track_number: i32,
    #[serde(default)]
    pub track_count: i32,
    #[serde(default)]
    pub disc_number: i32,
    #[serde(default)]
    pub disc_count: i32,
    pub year: i32,
    pub duration_ms: i32,
    /// kbps and Hz off the decoded stream, not the tags. 0 = lofty couldn't
    /// work it out; the iPod is fine with 0, it just displays nothing.
    #[serde(default)]
    pub bitrate: i32,
    #[serde(default)]
    pub sample_rate: i32,
    /// Embedded art staged to a temp file — libgpod wants a path, not bytes.
    pub artwork_path: Option<String>,
    /// Same image as a data URL so the import dialog can preview it without
    /// filesystem access from the webview.
    pub artwork_data_url: Option<String>,
}

pub fn read(path: &str) -> PendingImport {
    let fallback_title = Path::new(path)
        .file_stem()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_else(|| path.to_string());

    let mut item = PendingImport {
        file_path: path.to_string(),
        title: fallback_title,
        artist: "Unknown Artist".into(),
        album_artist: String::new(),
        album: "Unknown Album".into(),
        composer: String::new(),
        genre: String::new(),
        track_number: 0,
        track_count: 0,
        disc_number: 0,
        disc_count: 0,
        year: 0,
        duration_ms: 0,
        bitrate: 0,
        sample_rate: 0,
        artwork_path: None,
        artwork_data_url: None,
    };

    let Ok(probe) = lofty::probe::Probe::open(path) else {
        return item;
    };
    let Ok(tagged) = probe.read() else {
        return item;
    };

    let properties = tagged.properties();
    item.duration_ms = properties.duration().as_millis() as i32;
    // audio_bitrate is the stream's own figure; overall_bitrate includes tag
    // and container overhead, which is not what "192 kbps" means to anyone.
    item.bitrate = properties.audio_bitrate().unwrap_or(0) as i32;
    item.sample_rate = properties.sample_rate().unwrap_or(0) as i32;

    let Some(tag) = tagged.primary_tag().or_else(|| tagged.first_tag()) else {
        return item;
    };

    if let Some(v) = tag.title() {
        item.title = v.into_owned();
    }
    if let Some(v) = tag.artist() {
        item.artist = v.into_owned();
    }
    if let Some(v) = tag.album() {
        item.album = v.into_owned();
    }
    if let Some(v) = tag.genre() {
        item.genre = v.into_owned();
    }
    if let Some(v) = tag.year() {
        item.year = v as i32;
    }
    if let Some(v) = tag.track() {
        item.track_number = v as i32;
    }
    if let Some(v) = tag.track_total() {
        item.track_count = v as i32;
    }
    if let Some(v) = tag.disk() {
        item.disc_number = v as i32;
    }
    if let Some(v) = tag.disk_total() {
        item.disc_count = v as i32;
    }
    // No Accessor methods for these two — they come out of the generic item
    // map, which each format's tag maps onto its own key (TPE2, aART, …).
    if let Some(v) = tag.get_string(&ItemKey::AlbumArtist) {
        item.album_artist = v.to_string();
    }
    if let Some(v) = tag.get_string(&ItemKey::Composer) {
        item.composer = v.to_string();
    }

    if let Some(picture) = tag.pictures().first() {
        let data = picture.data();
        if !data.is_empty() {
            let mime = picture
                .mime_type()
                .map(|m| m.as_str().to_string())
                .unwrap_or_else(|| "image/jpeg".into());
            item.artwork_path = cache_artwork(data, &mime);
            item.artwork_data_url = Some(format!(
                "data:{mime};base64,{}",
                base64::engine::general_purpose::STANDARD.encode(data)
            ));
        }
    }

    item
}

/// Stages embedded artwork in the temp dir; unique per call so two files'
/// covers can't collide.
fn cache_artwork(data: &[u8], mime: &str) -> Option<String> {
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let ext = match mime {
        "image/png" => "png",
        _ => "jpg",
    };
    let dir = std::env::temp_dir().join("PodSyncArtwork");
    std::fs::create_dir_all(&dir).ok()?;
    let n = COUNTER.fetch_add(1, Ordering::Relaxed);
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let file = dir.join(format!("{stamp}_{n}.{ext}"));
    std::fs::write(&file, data).ok()?;
    Some(file.to_string_lossy().into_owned())
}
