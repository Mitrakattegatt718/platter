//! The Convert tab's model: a staged queue of sources, a size/fit estimate
//! computed from what was already probed, and the job that runs the batch.
//!
//! Kept out of `commands.rs` because none of it touches the library mutex
//! except the last step of an iPod-destined job.

use crate::convert::{
    self, ConvertControl, MediaProbe, Prepared, Rate, TargetFormat, TargetSpec, WorkItem,
};
use crate::fsinfo;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

// ------------------------------------------------------------------ estimation

/// Measured over 54 real 16/44.1 tracks (3.8 h, 2.39 GB PCM -> 1.49 GB ALAC):
/// aggregate 0.623, every track inside 0.40-0.75. Loudness drives it — quiet
/// masters compress near 0.44, brickwalled ones near 0.72 — so the error does
/// NOT average out within one album, which is mastered uniformly.
const ALAC_RATIO_LIKELY: f64 = 0.62;
const ALAC_RATIO_HIGH: f64 = 0.75;
/// FLAC lands a couple of percent tighter than ALAC on the same material.
const FLAC_RATIO_LIKELY: f64 = 0.60;
const FLAC_RATIO_HIGH: f64 = 0.74;

/// moov + stsz/stco tables grow with frame count; measured around 0.4%.
const MP4_OVERHEAD: f64 = 0.004;
/// Normalized cover art is <=600px MJPEG at -q:v 3, typically 40-150 KB.
const ART_BYTES: u64 = 100 * 1024;
/// FAT32's per-file ceiling, and the cluster size we bill slack at.
const FAT_MAX_FILE: u64 = 4 * 1024 * 1024 * 1024 - 1;
const FAT_CLUSTER: u64 = 32 * 1024;

/// Bytes of raw PCM the target stream would occupy, which every lossless
/// estimate is a fraction of.
fn raw_pcm_bytes(duration_s: f64, rate: u32, channels: u32) -> f64 {
    duration_s * rate as f64 * channels as f64 * 2.0
}

/// (likely, high) output bytes for one item. Both are 0 when the duration is
/// unknown — the caller counts those separately rather than billing them zero.
fn estimate_one(probe: &MediaProbe, target: &TargetSpec, duration_s: f64) -> (u64, u64) {
    if duration_s <= 0.0 {
        return (0, 0);
    }
    let rate = if target.ipod_safe {
        convert::target_rate(probe.sample_rate)
    } else {
        probe.sample_rate.max(44100)
    };
    let channels = probe.channels.clamp(1, 2);
    let raw = raw_pcm_bytes(duration_s, rate, channels);
    let art = if target.format.can_embed_art() {
        ART_BYTES
    } else {
        0
    };

    let (likely, high) = match target.format {
        // PCM containers are arithmetic, not guesswork: measured 60 s @44.1/16
        // stereo lands at raw + 78 (WAV) and raw + 54 (AIFF).
        TargetFormat::Wav => (raw + 78.0, raw + 78.0),
        TargetFormat::Aiff => (raw + 54.0 + art as f64, raw + 54.0 + art as f64),
        TargetFormat::Alac => (
            raw * ALAC_RATIO_LIKELY * (1.0 + MP4_OVERHEAD) + art as f64,
            raw * ALAC_RATIO_HIGH * (1.0 + MP4_OVERHEAD) + art as f64,
        ),
        TargetFormat::Flac => (
            raw * FLAC_RATIO_LIKELY + 8192.0,
            raw * FLAC_RATIO_HIGH + 8192.0,
        ),
        TargetFormat::Aac | TargetFormat::Mp3 => {
            let kbps = match target.rate {
                Rate::Cbr(k) => k as f64,
                // A VBR index has no bitrate until it encodes. These are the
                // measured means for index 0; higher indices only come out
                // smaller, so billing index 0 keeps `high` a real bound.
                Rate::Vbr(_) if target.format == TargetFormat::Aac => 195.0,
                Rate::Vbr(_) => 245.0,
                Rate::Lossless => 256.0,
            };
            let payload = kbps * 1000.0 / 8.0 * duration_s;
            if target.format == TargetFormat::Mp3 {
                let v = payload + 2560.0 + art as f64;
                (v, v * 1.01)
            } else {
                // ffmpeg's AAC encoders undershoot nominal by up to 13%, so
                // nominal is an upper bound and the likely value sits below.
                let high = payload * (1.0 + MP4_OVERHEAD) + art as f64;
                (high * 0.93, high)
            }
        }
    };
    (likely.max(0.0) as u64, high.max(0.0) as u64)
}

// ----------------------------------------------------------------- queue state

/// One row in the Convert tab's source list.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceRow {
    pub id: u64,
    pub src_path: String,
    pub display: String,
    pub cue_track: Option<u32>,
    pub codec: String,
    pub sample_rate: u32,
    pub channels: u32,
    pub bits: u32,
    /// 0 = unknown, never "empty".
    pub duration_s: f64,
    pub source_bytes: u64,
    /// Why this row can't be converted to the current target, if it can't.
    /// Recomputed on every estimate, so changing the format clears it.
    pub blocked: Option<String>,
}

struct StagedItem {
    id: u64,
    item: WorkItem,
    probe: MediaProbe,
    source_bytes: u64,
}

impl StagedItem {
    /// A cue slice bills its own span, not the whole album image.
    fn duration(&self) -> f64 {
        match &self.item.cue {
            Some(meta) => meta
                .end
                .map(|e| (e - meta.start).max(0.0))
                .unwrap_or_else(|| (self.probe.duration_s - meta.start).max(0.0)),
            None => self.probe.duration_s,
        }
    }

    fn row(&self, blocked: Option<String>) -> SourceRow {
        SourceRow {
            id: self.id,
            src_path: self.item.src.to_string_lossy().into_owned(),
            display: self.item.display(),
            cue_track: self.item.cue.as_ref().map(|c| c.track_num),
            codec: self.probe.codec.clone(),
            sample_rate: self.probe.sample_rate,
            channels: self.probe.channels,
            bits: self.probe.effective_bits(),
            duration_s: self.duration(),
            source_bytes: self.source_bytes,
            blocked,
        }
    }
}

#[derive(Default)]
pub struct Queue {
    items: Vec<StagedItem>,
    next_id: u64,
    /// Behind an Arc so `cancel_convert` can clone it out under a momentary
    /// lock. Holding the queue lock for the length of a job would make the
    /// Cancel button queue behind the very job it is meant to stop.
    pub control: Arc<ConvertControl>,
    /// Mount point of the open library, mirrored here so an estimate for the
    /// iPod destination needs no lock on the library itself.
    pub ipod_mount: Option<String>,
    /// Bumped per run so late events from a superseded job can be dropped by
    /// the frontend rather than mixed into the current one's log.
    job_seq: AtomicU64,
    /// Set while a job is past the point where cancelling can help — libgpod's
    /// copy plus full-DB rewrite is not resumable.
    pub finishing: std::sync::atomic::AtomicBool,
}

pub type SharedQueue = Arc<Mutex<Queue>>;

pub fn new_queue() -> SharedQueue {
    Arc::new(Mutex::new(Queue::default()))
}

impl Queue {
    pub fn rows(&self, target: Option<&TargetSpec>) -> Vec<SourceRow> {
        self.items
            .iter()
            .map(|s| {
                let blocked =
                    target.and_then(|t| convert::reject_pairing(&s.probe, t));
                s.row(blocked)
            })
            .collect()
    }

    pub fn is_empty(&self) -> bool {
        self.items.is_empty()
    }

    pub fn clear(&mut self) {
        self.items.clear();
    }

    pub fn remove(&mut self, ids: &[u64]) {
        self.items.retain(|s| !ids.contains(&s.id));
    }

    /// Appends scanned+probed work, skipping anything already queued.
    pub fn extend(&mut self, scanned: Vec<WorkItem>, ffprobe: &Path) {
        for mut item in scanned {
            let already = self.items.iter().any(|s| {
                s.item.src == item.src
                    && s.item.cue.as_ref().map(|c| c.track_num)
                        == item.cue.as_ref().map(|c| c.track_num)
            });
            if already {
                continue;
            }
            let Some(probe) = convert::probe_media(ffprobe, &item.src) else {
                continue;
            };
            if probe.codec.is_empty() {
                continue;
            }
            let source_bytes = std::fs::metadata(&item.src).map(|m| m.len()).unwrap_or(0);
            self.next_id += 1;
            let id = self.next_id;
            // Carried into the batch so the run doesn't re-probe a queue that
            // may hold several thousand files.
            item.probe = Some(probe.clone());
            self.items.push(StagedItem {
                id,
                item,
                probe,
                source_bytes,
            });
        }
    }
}

// ------------------------------------------------------------------ estimating

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum Destination {
    /// Written straight into the folder — no scratch copy, half the peak disk.
    Folder { path: String },
    /// Converted to scratch first, then handed to the existing import path.
    Ipod,
}

#[derive(Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum FitVerdict {
    Fits,
    Tight,
    DoesNotFit,
    Unknown,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Estimate {
    pub file_count: usize,
    pub blocked_count: usize,
    pub total_duration_s: f64,
    pub source_bytes: u64,
    pub likely_bytes: u64,
    pub high_bytes: u64,
    /// True only when every item is PCM or CBR — the arithmetic really is
    /// exact and the UI can drop its hedging.
    pub exact: bool,
    pub unknown_duration_count: usize,
    pub dest_path: String,
    pub dest_free_bytes: u64,
    pub dest_total_bytes: u64,
    pub dest_fs_type: String,
    /// Boot-volume free space, present only for an iPod destination — the
    /// whole batch is staged in /tmp before libgpod copies it across.
    pub scratch_free_bytes: Option<u64>,
    pub headroom_bytes: u64,
    pub verdict: FitVerdict,
    pub oversize_files: Vec<String>,
    pub notes: Vec<String>,
}

pub fn estimate(queue: &Queue, target: &TargetSpec, dest: &Destination) -> Result<Estimate, String> {
    target.validate()?;

    let mut likely = 0u64;
    let mut high = 0u64;
    let mut duration = 0.0f64;
    let mut source_bytes = 0u64;
    let mut unknown = 0usize;
    let mut blocked = 0usize;
    let mut oversize = Vec::new();
    let mut counted = 0usize;

    for staged in &queue.items {
        source_bytes += staged.source_bytes;
        if convert::reject_pairing(&staged.probe, target).is_some() {
            blocked += 1;
            continue;
        }
        let d = staged.duration();
        if d <= 0.0 {
            unknown += 1;
            continue;
        }
        counted += 1;
        duration += d;
        let (l, h) = estimate_one(&staged.probe, target, d);
        likely += l;
        high += h;
        if h > FAT_MAX_FILE {
            oversize.push(staged.item.display());
        }
    }

    let (dest_path, dest_info) = match dest {
        Destination::Folder { path } => (path.clone(), fsinfo::fs_info(Path::new(path))),
        Destination::Ipod => {
            let mount = queue.ipod_mount.clone().unwrap_or_default();
            (mount.clone(), fsinfo::fs_info(Path::new(&mount)))
        }
    };
    let info = dest_info.ok_or_else(|| {
        format!("Couldn't read free space for {dest_path} — is the volume still mounted?")
    })?;

    let mut notes = Vec::new();
    let mut high_billed = high;
    if info.is_fat() {
        // Every file rounds up to a cluster, and 4 GiB is a hard per-file wall.
        high_billed += counted as u64 * FAT_CLUSTER;
        notes.push("The iPod is FAT32-formatted: files round up to 32 KB and none may exceed 4 GB.".into());
    }

    let headroom = match dest {
        Destination::Folder { .. } => (info.total_bytes / 50).max(1024 * 1024 * 1024),
        // Leaves room for the iTunesDB, rewritten in full on every save, plus
        // ArtworkDB growth for the new covers.
        Destination::Ipod => (info.total_bytes / 50).max(200 * 1024 * 1024),
    };

    let scratch = match dest {
        Destination::Folder { .. } => None,
        Destination::Ipod => fsinfo::fs_info(&std::env::temp_dir()).map(|i| i.free_bytes),
    };

    let fits_at = |bytes: u64| -> bool {
        if info.free_bytes < bytes + headroom {
            return false;
        }
        match scratch {
            // The whole batch lands in /tmp before any of it is copied across,
            // so peak scratch is the batch, not one file.
            Some(free) => free >= bytes + 2 * 1024 * 1024 * 1024,
            None => true,
        }
    };

    let verdict = if counted == 0 && unknown > 0 {
        FitVerdict::Unknown
    } else if !oversize.is_empty() {
        FitVerdict::DoesNotFit
    } else if fits_at(high_billed) {
        FitVerdict::Fits
    } else if fits_at(likely) {
        FitVerdict::Tight
    } else {
        FitVerdict::DoesNotFit
    };

    if unknown > 0 {
        notes.push(format!(
            "{unknown} file{} of unknown length {} not included in this estimate.",
            if unknown == 1 { "" } else { "s" },
            if unknown == 1 { "is" } else { "are" }
        ));
    }
    if blocked > 0 {
        notes.push(format!(
            "{blocked} file{} can't be converted to this format and will be skipped.",
            if blocked == 1 { "" } else { "s" }
        ));
    }
    if !target.format.can_embed_art() {
        notes.push("WAV cannot carry cover art — those tracks will have none.".into());
    }
    if matches!(dest, Destination::Ipod) {
        notes.push(format!(
            "Needs about {} free on this Mac while converting, as well as on the iPod.",
            human_bytes(high_billed)
        ));
    }

    // Exact only when nothing was a guess: PCM containers, or CBR lossy.
    let exact = counted > 0
        && unknown == 0
        && matches!(
            (target.format, target.rate),
            (TargetFormat::Wav, _) | (TargetFormat::Aiff, _) | (TargetFormat::Mp3, Rate::Cbr(_))
        );

    Ok(Estimate {
        file_count: counted,
        blocked_count: blocked,
        total_duration_s: duration,
        source_bytes,
        likely_bytes: likely,
        high_bytes: high_billed,
        exact,
        unknown_duration_count: unknown,
        dest_path,
        dest_free_bytes: info.free_bytes,
        dest_total_bytes: info.total_bytes,
        dest_fs_type: info.fs_type,
        scratch_free_bytes: scratch,
        headroom_bytes: headroom,
        verdict,
        oversize_files: oversize,
        notes,
    })
}

fn human_bytes(bytes: u64) -> String {
    const UNITS: [&str; 4] = ["KB", "MB", "GB", "TB"];
    if bytes < 1000 {
        return format!("{bytes} B");
    }
    let mut value = bytes as f64;
    let mut unit = "B";
    for u in UNITS {
        value /= 1000.0;
        unit = u;
        if value < 1000.0 {
            break;
        }
    }
    let digits = if value < 10.0 { 1 } else { 0 };
    format!("{value:.digits$} {unit}")
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JobSummary {
    pub job_id: u64,
    pub converted: usize,
    pub failed: usize,
    pub cancelled: bool,
    /// What was actually written — the honest number to hold the estimate to.
    pub output_bytes: u64,
    pub output_dir: Option<String>,
    pub failures: Vec<String>,
}

/// Drains the queue into work for one run.
pub fn take_work(queue: &mut Queue) -> Vec<WorkItem> {
    queue
        .items
        .iter()
        .map(|s| WorkItem {
            src: s.item.src.clone(),
            dst_stem: s.item.dst_stem.clone(),
            cue: s.item.cue.clone(),
            probe: Some(s.probe.clone()),
        })
        .collect()
}

pub fn next_job_id(queue: &Queue) -> u64 {
    queue.job_seq.fetch_add(1, Ordering::Relaxed) + 1
}

/// Sums what a finished run actually produced.
pub fn output_bytes(prepared: &[Prepared]) -> u64 {
    prepared
        .iter()
        .filter_map(|p| match p {
            Prepared::Ready(path) => std::fs::metadata(path).ok().map(|m| m.len()),
            _ => None,
        })
        .sum()
}

/// Removes `*.part` left behind by a killed ffmpeg. Runs on every job end,
/// cancelled included — a user's own folder must not accumulate debris.
pub fn sweep_parts(dir: &Path) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            sweep_parts(&path);
        } else if path.extension().is_some_and(|e| e == "part") {
            let _ = std::fs::remove_file(path);
        }
    }
}

/// Where a folder-destined run writes. Returns the folder itself: writing
/// straight into it rather than via scratch is what halves peak disk use.
pub fn folder_out_dir(path: &str) -> PathBuf {
    PathBuf::from(path)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn probe(duration: f64, rate: u32, channels: u32) -> MediaProbe {
        MediaProbe {
            codec: "flac".into(),
            sample_rate: rate,
            channels,
            bits: 16,
            bits_known: true,
            sample_fmt: "s16".into(),
            duration_s: duration,
            ..Default::default()
        }
    }

    #[test]
    fn pcm_targets_are_arithmetic() {
        let p = probe(60.0, 44100, 2);
        // 60 s * 44100 * 2ch * 2 bytes = 10,584,000 raw.
        let (likely, high) = estimate_one(
            &p,
            &TargetSpec {
                format: TargetFormat::Wav,
                rate: Rate::Lossless,
                ipod_safe: true,
            },
            60.0,
        );
        assert_eq!(likely, 10_584_078);
        assert_eq!(high, likely, "PCM has no uncertainty band");
    }

    #[test]
    fn alac_stays_inside_the_measured_band() {
        let p = probe(60.0, 44100, 2);
        let (likely, high) = estimate_one(&p, &TargetSpec::alac(), 60.0);
        let raw = 10_584_000.0;
        assert!((likely as f64 / raw) > 0.40 && (likely as f64 / raw) < 0.75);
        assert!(high > likely, "the high bound must actually bound");
    }

    #[test]
    fn unknown_duration_estimates_nothing_rather_than_zero() {
        let p = probe(0.0, 44100, 2);
        assert_eq!(estimate_one(&p, &TargetSpec::alac(), 0.0), (0, 0));
    }

    #[test]
    fn cbr_mp3_is_near_exact() {
        let p = probe(60.0, 44100, 2);
        let spec = TargetSpec {
            format: TargetFormat::Mp3,
            rate: Rate::Cbr(320),
            ipod_safe: true,
        };
        let (likely, _) = estimate_one(&p, &spec, 60.0);
        // 320 kbps * 60 s / 8 = 2,400,000 payload.
        assert!((2_400_000..2_600_000).contains(&likely), "got {likely}");
    }
}
