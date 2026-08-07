//! Lossless → iPod-ready ALAC conversion, ported from the `alac4ipod` zsh
//! engine so dropped FLAC/WAV/DSD/hi-res files land on the iPod as playable
//! Apple Lossless instead of being rejected.
//!
//! iPod Classic plays ALAC up to 16-bit / 48 kHz / 2 channels only. Anything
//! above that is downconverted (high-quality resample + TPDF dither, stereo
//! downmix); anything already within spec passes through losslessly. A
//! single-file album image with a .cue sheet is split into tagged tracks.
//! Lossy sources other than the formats the iPod plays natively (MP3/AAC)
//! are skipped — transcoding lossy → lossless would only waste space.
//!
//! ffmpeg/ffprobe come from Homebrew/MacPorts/PATH; nothing is bundled. When
//! they're missing, MP3/M4A behave exactly as before and everything else
//! fails with an install hint.

use serde_json::Value;
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Mutex, OnceLock};

/// Formats the iPod plays natively — imported as-is, never probed.
pub const DIRECT_EXTENSIONS: [&str; 2] = ["mp3", "aac"];

/// Extensions worth probing. Lossy-only containers are excluded outright;
/// anything lossy that slips through (e.g. AAC inside .m4a) is sorted out by
/// the codec check after the probe.
pub const PROBE_EXTENSIONS: [&str; 17] = [
    "m4a", "alac", "flac", "wav", "wave", "aif", "aiff", "aifc", "ape", "wv", "tta", "dsf",
    "dff", "shn", "caf", "w64", "rf64",
];

/// Codecs we accept as "lossless enough to be worth an ALAC copy".
const LOSSLESS_CODECS: [&str; 14] = [
    "flac",
    "alac",
    "ape",
    "wavpack",
    "tta",
    "shorten",
    "als",
    "mlp",
    "truehd",
    "wmalossless",
    "dsd_lsbf",
    "dsd_msbf",
    "dsd_lsbf_planar",
    "dsd_msbf_planar",
];

/// iPod Classic shows small JPEG artwork most reliably; oversized or non-JPEG
/// art gets re-encoded to a <=600px JPEG when embedding. Above this edge
/// length even JPEG art is rescaled.
const ART_MAX_EDGE: u32 = 800;
const ART_NORM_OPTS: [&str; 8] = [
    "-c:v",
    "mjpeg",
    "-filter:v",
    "scale=w=min(iw\\,600):h=min(ih\\,600):force_original_aspect_ratio=decrease",
    "-pix_fmt",
    "yuvj420p",
    "-q:v",
    "3",
];

// ------------------------------------------------------------------ tool paths

fn find_tool(name: &str) -> Option<PathBuf> {
    for prefix in ["/opt/homebrew/bin", "/usr/local/bin", "/opt/local/bin"] {
        let p = Path::new(prefix).join(name);
        if p.is_file() {
            return Some(p);
        }
    }
    // The app is launched from Finder with a minimal PATH, so `which` through
    // the user's shell profile is the last resort, not the first.
    let out = Command::new("/usr/bin/which").arg(name).output().ok()?;
    if out.status.success() {
        let p = PathBuf::from(String::from_utf8_lossy(&out.stdout).trim());
        if p.is_file() {
            return Some(p);
        }
    }
    None
}

pub struct Tools {
    pub ffmpeg: PathBuf,
    pub ffprobe: PathBuf,
}

/// Both tools, discovered once per process. None when either is missing.
pub fn tools() -> Option<&'static Tools> {
    static TOOLS: OnceLock<Option<Tools>> = OnceLock::new();
    TOOLS
        .get_or_init(|| {
            Some(Tools {
                ffmpeg: find_tool("ffmpeg")?,
                ffprobe: find_tool("ffprobe")?,
            })
        })
        .as_ref()
}

pub const FFMPEG_MISSING: &str =
    "needs conversion to Apple Lossless, but ffmpeg isn't installed (brew install ffmpeg)";

/// Homebrew's ffmpeg is often built without libsoxr. Detect once and fall
/// back to swr tuned well past its defaults (filter_size 32 -> 512).
fn resampler_args(ffmpeg: &Path) -> &'static str {
    static ARGS: OnceLock<&'static str> = OnceLock::new();
    ARGS.get_or_init(|| {
        let has_soxr = Command::new(ffmpeg)
            .args(["-hide_banner", "-buildconf"])
            .output()
            .map(|o| String::from_utf8_lossy(&o.stdout).contains("--enable-libsoxr"))
            .unwrap_or(false);
        if has_soxr {
            "resampler=soxr:precision=28"
        } else {
            "resampler=swr:filter_size=512:phase_shift=12:cutoff=0.95:exact_rational=1"
        }
    })
}

// --------------------------------------------------------------- small helpers

pub fn lower_ext(path: &Path) -> String {
    path.extension()
        .map(|e| e.to_string_lossy().to_lowercase())
        .unwrap_or_default()
}

fn is_direct_ext(path: &Path) -> bool {
    DIRECT_EXTENSIONS.contains(&lower_ext(path).as_str())
}

fn is_probe_ext(path: &Path) -> bool {
    PROBE_EXTENSIONS.contains(&lower_ext(path).as_str())
}

pub fn is_audio_ext(path: &Path) -> bool {
    is_direct_ext(path) || is_probe_ext(path)
}

/// Whether a staged import path may need conversion before libgpod sees it
/// (i.e. anything that isn't a natively-playable MP3/AAC).
pub fn needs_prepare(path: &Path) -> bool {
    is_probe_ext(path)
}

/// Strip characters that confuse FAT-formatted iPods and path joins.
fn sanitize(s: &str) -> String {
    s.replace(['/', ':'], "-")
}

/// iPod Classic tops out at 48 kHz. Stay inside the source's own clock family
/// so resampling is a clean integer ratio: 88.2/176.4/352.8 -> 44.1,
/// 96/192 -> 48.
fn target_rate(rate: u32) -> u32 {
    if rate == 0 {
        return 44100;
    }
    if rate % 44100 == 0 {
        return 44100;
    }
    if rate % 48000 == 0 {
        return 48000;
    }
    if rate <= 44100 {
        44100
    } else {
        48000
    }
}

fn bits_from_sample_fmt(fmt: &str) -> u32 {
    match fmt.trim_end_matches('p') {
        "u8" => 8,
        "s16" => 16,
        "s32" | "flt" => 32,
        "dbl" => 64,
        f if f.starts_with("dsd") => 1,
        _ => 0,
    }
}

// ------------------------------------------------------------------- probing

#[derive(Clone, Default)]
pub struct MediaProbe {
    pub codec: String,
    pub sample_rate: u32,
    pub channels: u32,
    pub bits: u32,
    pub sample_fmt: String,
    pub art_codec: Option<String>,
    pub art_w: u32,
    pub art_h: u32,
}

impl MediaProbe {
    fn is_dsd(&self) -> bool {
        self.codec.starts_with("dsd_")
    }

    fn is_lossless(&self) -> bool {
        self.codec.starts_with("pcm_") || LOSSLESS_CODECS.contains(&self.codec.as_str())
    }

    /// Whether the audio needs resampling/dithering/downmixing to fit the
    /// iPod's 16-bit / <=48 kHz / stereo ceiling.
    fn needs_work(&self) -> bool {
        target_rate(self.sample_rate) != self.sample_rate
            || self.bits != 16
            || !self.sample_fmt.starts_with("s16")
            || self.channels > 2
            || self.is_dsd()
    }
}

/// One ffprobe pass for the audio stream AND any artwork stream — also serves
/// standalone images, which carry only a video stream. First stream of each
/// type wins. None when ffprobe finds no streams at all; audio callers must
/// additionally check `codec` is non-empty.
fn probe_media(ffprobe: &Path, src: &Path) -> Option<MediaProbe> {
    let out = Command::new(ffprobe)
        .args([
            "-v",
            "error",
            "-show_entries",
            "stream=codec_name,codec_type,width,height,sample_fmt,sample_rate,channels,bits_per_raw_sample",
            "-of",
            "json",
        ])
        .arg("--")
        .arg(src)
        .output()
        .ok()?;
    let json: Value = serde_json::from_slice(&out.stdout).ok()?;
    let mut probe = MediaProbe::default();
    for stream in json["streams"].as_array()? {
        let ctype = stream["codec_type"].as_str().unwrap_or("");
        let codec = stream["codec_name"].as_str().unwrap_or("").to_string();
        // ffprobe reports some numerics as strings ("44100") and some as
        // numbers depending on the field — accept both.
        let num = |v: &Value| -> u32 {
            v.as_u64()
                .or_else(|| v.as_str().and_then(|s| s.parse().ok()))
                .unwrap_or(0) as u32
        };
        if ctype == "audio" && probe.codec.is_empty() {
            probe.codec = codec;
            probe.sample_rate = num(&stream["sample_rate"]);
            probe.channels = num(&stream["channels"]);
            probe.bits = num(&stream["bits_per_raw_sample"]);
            probe.sample_fmt = stream["sample_fmt"].as_str().unwrap_or("").to_string();
        } else if ctype == "video" && probe.art_codec.is_none() {
            probe.art_codec = Some(codec);
            probe.art_w = num(&stream["width"]);
            probe.art_h = num(&stream["height"]);
        }
    }
    if probe.bits == 0 {
        probe.bits = bits_from_sample_fmt(&probe.sample_fmt);
    }
    if probe.codec.is_empty() && probe.art_codec.is_none() {
        None
    } else {
        Some(probe)
    }
}

// ------------------------------------------------------------------ cue sheets

#[derive(Clone)]
pub struct CueMeta {
    pub start: f64,
    /// None for the last track — encode to end of file.
    pub end: Option<f64>,
    pub title: String,
    pub artist: String,
    pub album: String,
    pub track_num: u32,
    pub track_total: u32,
    pub date: String,
    pub genre: String,
    pub album_artist: String,
}

struct CueSheet {
    audio_file: PathBuf,
    tracks: Vec<CueMeta>,
}

/// Cue text arrives in whatever encoding the ripper used. Try UTF-8 (with or
/// without BOM), then cp1251 (RuTracker), then latin-1 as the catch-all.
fn decode_cue_bytes(raw: &[u8]) -> String {
    let raw = raw.strip_prefix(&[0xEF, 0xBB, 0xBF][..]).unwrap_or(raw);
    if let Ok(s) = std::str::from_utf8(raw) {
        return s.to_string();
    }
    let (s, _, malformed) = encoding_rs::WINDOWS_1251.decode(raw);
    if !malformed && !s.contains('\u{FFFD}') {
        return s.into_owned();
    }
    raw.iter().map(|&b| b as char).collect()
}

/// `TITLE "Foo"` / `TITLE Foo` — strip one optional pair of double quotes.
fn cue_value(rest: &str) -> String {
    let rest = rest.trim();
    rest.strip_prefix('"')
        .and_then(|r| r.strip_suffix('"'))
        .unwrap_or(rest)
        .to_string()
}

/// `FILE "name" WAVE` — the path is everything between the outer quotes, or
/// the bare second token.
fn cue_file_value(rest: &str) -> Option<String> {
    let rest = rest.trim();
    if let Some(after) = rest.strip_prefix('"') {
        let close = after.rfind('"')?;
        return Some(after[..close].to_string());
    }
    rest.split_whitespace().next().map(str::to_string)
}

/// Parse a .cue file. Fails (None) unless it references exactly one existing
/// audio file and holds >=2 indexed tracks — anything else is a per-track cue
/// that the normal file conversion already handles.
fn parse_cue(path: &Path) -> Option<CueSheet> {
    let raw = std::fs::read(path).ok()?;
    let text = decode_cue_bytes(&raw);

    struct RawTrack {
        num: u32,
        title: String,
        performer: String,
        start: Option<f64>,
    }
    let mut files: Vec<String> = Vec::new();
    let mut tracks: Vec<RawTrack> = Vec::new();
    let mut album = String::new();
    let mut album_performer = String::new();
    let mut date = String::new();
    let mut genre = String::new();
    let mut in_track = false;

    for line in text.lines() {
        let s = line.trim();
        let upper = s.to_uppercase();
        if upper.starts_with("FILE ") {
            if let Some(f) = cue_file_value(&s[5..]) {
                files.push(f);
            }
            in_track = false;
        } else if upper.starts_with("TRACK ") {
            let mut parts = s[6..].split_whitespace();
            let num: u32 = parts.next().and_then(|n| n.parse().ok()).unwrap_or(0);
            if parts.next().is_some_and(|t| t.eq_ignore_ascii_case("AUDIO")) {
                tracks.push(RawTrack {
                    num,
                    title: String::new(),
                    performer: String::new(),
                    start: None,
                });
                in_track = true;
            } else {
                in_track = false;
            }
        } else if upper.starts_with("TITLE") {
            let v = cue_value(&s[5..]);
            match (in_track, tracks.last_mut()) {
                (true, Some(t)) => t.title = v,
                _ => album = v,
            }
        } else if upper.starts_with("PERFORMER") {
            let v = cue_value(&s[9..]);
            match (in_track, tracks.last_mut()) {
                (true, Some(t)) => t.performer = v,
                _ => album_performer = v,
            }
        } else if upper.starts_with("INDEX") {
            let mut toks = s[5..].split_whitespace();
            if toks.next() == Some("01") && in_track {
                if let (Some(stamp), Some(t)) = (toks.next(), tracks.last_mut()) {
                    let mut nums = stamp.split(':').filter_map(|n| n.parse::<f64>().ok());
                    if let (Some(mm), Some(ss), Some(ff)) = (nums.next(), nums.next(), nums.next())
                    {
                        t.start = Some(mm * 60.0 + ss + ff / 75.0);
                    }
                }
            }
        } else if upper.starts_with("REM DATE") {
            date = cue_value(&s[8..]);
        } else if upper.starts_with("REM GENRE") {
            genre = cue_value(&s[9..]);
        }
    }

    let tracks: Vec<RawTrack> = tracks.into_iter().filter(|t| t.start.is_some()).collect();
    if files.len() != 1 || tracks.len() < 2 {
        return None;
    }

    let dir = path.parent()?;
    let named = dir.join(files[0].replace('\\', "/"));
    let audio_file = if named.is_file() {
        named
    } else {
        // Rips renamed after the fact: match the referenced basename
        // case-insensitively within the cue's own directory.
        let want = Path::new(&files[0].replace('\\', "/"))
            .file_name()?
            .to_string_lossy()
            .to_lowercase();
        std::fs::read_dir(dir)
            .ok()?
            .flatten()
            .map(|e| e.path())
            .find(|p| {
                p.is_file()
                    && p.file_name()
                        .is_some_and(|n| n.to_string_lossy().to_lowercase() == want)
            })?
    };

    let total = tracks.len() as u32;
    let metas = tracks
        .iter()
        .enumerate()
        .map(|(i, t)| CueMeta {
            start: t.start.unwrap(),
            end: tracks.get(i + 1).and_then(|n| n.start),
            title: if t.title.is_empty() {
                format!("Track {}", t.num)
            } else {
                t.title.clone()
            },
            artist: if t.performer.is_empty() {
                album_performer.clone()
            } else {
                t.performer.clone()
            },
            album: album.clone(),
            track_num: t.num,
            track_total: total,
            date: date.clone(),
            genre: genre.clone(),
            album_artist: album_performer.clone(),
        })
        .collect();

    Some(CueSheet {
        audio_file,
        tracks: metas,
    })
}

// ------------------------------------------------------------------ scanning

/// One dropped file to prepare: either import `src` as-is, or convert it to
/// `out_dir/dst_name` first (always the latter for cue-split tracks).
/// `dst_name` carries a per-item subdirectory ("3/Song.m4a") so identical
/// stems from different album folders can't collide in one scratch dir,
/// while the file stem itself stays clean for the tag reader's filename
/// fallback title.
pub struct WorkItem {
    pub src: PathBuf,
    pub dst_name: String,
    pub cue: Option<CueMeta>,
}

impl WorkItem {
    pub fn display(&self) -> String {
        let of = |p: &Path| {
            p.file_name()
                .map(|n| n.to_string_lossy().into_owned())
                .unwrap_or_else(|| p.display().to_string())
        };
        match &self.cue {
            Some(_) => of(Path::new(&self.dst_name)),
            None => of(&self.src),
        }
    }
}

struct Scanner {
    items: Vec<WorkItem>,
    /// (source path, cue track number) — selecting a cue-split file together
    /// with its folder (or its cue) yields identical records; first one wins.
    seen: HashSet<(PathBuf, u32)>,
}

impl Scanner {
    fn push_audio(&mut self, src: &Path) {
        if !self.seen.insert((src.to_path_buf(), 0)) {
            return;
        }
        let stem = src
            .file_stem()
            .map(|s| s.to_string_lossy().into_owned())
            .unwrap_or_else(|| "track".into());
        self.items.push(WorkItem {
            src: src.to_path_buf(),
            dst_name: format!("{}/{}.m4a", self.items.len(), sanitize(&stem)),
            cue: None,
        });
    }

    fn push_cue_tracks(&mut self, sheet: CueSheet) {
        for meta in sheet.tracks {
            if !self.seen.insert((sheet.audio_file.clone(), meta.track_num)) {
                continue;
            }
            self.items.push(WorkItem {
                src: sheet.audio_file.clone(),
                dst_name: format!(
                    "{}/{:02} {}.m4a",
                    self.items.len(),
                    meta.track_num,
                    sanitize(&meta.title)
                ),
                cue: Some(meta),
            });
        }
    }

    fn scan_dir(&mut self, dir: &Path) {
        let Ok(entries) = std::fs::read_dir(dir) else {
            return;
        };
        let mut paths: Vec<PathBuf> = entries.flatten().map(|e| e.path()).collect();
        paths.sort();

        // Cue-driven album images first: their audio file is excluded from
        // the normal per-file pass and split into tagged tracks instead.
        let mut excluded: HashSet<String> = HashSet::new();
        for p in paths.iter().filter(|p| p.is_file()) {
            if lower_ext(p) != "cue" {
                continue;
            }
            let Some(sheet) = parse_cue(p) else {
                continue;
            };
            let key = sheet.audio_file.file_name().unwrap_or_default().to_string_lossy().to_lowercase();
            // second cue for the same image — first one wins
            if !excluded.insert(key) {
                continue;
            }
            self.push_cue_tracks(sheet);
        }

        for p in &paths {
            if p.is_dir() {
                self.scan_dir(p);
            } else if p.is_file()
                && is_audio_ext(p)
                && !excluded.contains(&p.file_name().unwrap_or_default().to_string_lossy().to_lowercase())
            {
                self.push_audio(p);
            }
        }
    }

    /// A file picked directly. Selecting the .cue, or an audio file that a
    /// sibling cue references, yields tagged tracks instead of one giant m4a.
    fn scan_single(&mut self, file: &Path) {
        if lower_ext(file) == "cue" {
            if let Some(sheet) = parse_cue(file) {
                self.push_cue_tracks(sheet);
            }
            return;
        }
        if !is_audio_ext(file) {
            return;
        }
        if is_probe_ext(file) {
            if let Some(dir) = file.parent() {
                if let Ok(entries) = std::fs::read_dir(dir) {
                    for p in entries.flatten().map(|e| e.path()) {
                        if lower_ext(&p) != "cue" {
                            continue;
                        }
                        let Some(sheet) = parse_cue(&p) else {
                            continue;
                        };
                        let same = sheet
                            .audio_file
                            .canonicalize()
                            .ok()
                            .zip(file.canonicalize().ok())
                            .is_some_and(|(a, b)| a == b);
                        if same {
                            self.push_cue_tracks(sheet);
                            return;
                        }
                    }
                }
            }
        }
        self.push_audio(file);
    }
}

/// Expand the dropped selection into work items. Directories recurse; cue
/// sheets split; duplicates collapse.
pub fn scan(paths: &[String]) -> Vec<WorkItem> {
    let mut scanner = Scanner {
        items: Vec::new(),
        seen: HashSet::new(),
    };
    for p in paths {
        let path = PathBuf::from(p.trim_end_matches('/'));
        if path.is_dir() {
            scanner.scan_dir(&path);
        } else if path.is_file() {
            scanner.scan_single(&path);
        }
    }
    scanner.items
}

// ------------------------------------------------------------------ conversion

pub enum Prepared {
    /// Import this path — the original file, or a converted temp file.
    Ready(PathBuf),
    /// Not iPod material (lossy source in a lossless container, unreadable…).
    Rejected(String),
}

/// Best folder image to embed when the track carries no artwork of its own.
fn folder_cover(dir: &Path) -> Option<PathBuf> {
    const PRIO: [&str; 6] = ["cover", "folder", "front", "albumart", "album", "artwork"];
    const DEMOTED: [&str; 8] = [
        "back", "insert", "inside", "rear", "matrix", "label", "booklet", "obi",
    ];
    let mut best: Option<(u32, PathBuf)> = None;
    for p in std::fs::read_dir(dir).ok()?.flatten().map(|e| e.path()) {
        if !p.is_file() || !matches!(lower_ext(&p).as_str(), "jpg" | "jpeg" | "png") {
            continue;
        }
        let base = p
            .file_stem()
            .map(|s| s.to_string_lossy().to_lowercase())
            .unwrap_or_default();
        let mut rank = 50;
        for (i, prefix) in PRIO.iter().enumerate() {
            if base.starts_with(prefix) {
                rank = i as u32 + 1;
                break;
            }
        }
        // Vinyl/CD scan sets name every side; anything that isn't the front
        // should lose to a plain unlabeled scan.
        if rank == 50 && DEMOTED.iter().any(|d| base.contains(d)) {
            rank = 90;
        }
        if best.as_ref().is_none_or(|(r, _)| rank < *r) {
            best = Some((rank, p));
        }
    }
    best.map(|(_, p)| p)
}

/// Per-run cache of normalized folder covers: cue splits would otherwise
/// decode and rescale the same multi-hundred-MB scan for every track of the
/// album. Keyed by cover path; None caches a failed normalization.
pub struct ArtCache {
    dir: PathBuf,
    entries: Mutex<HashMap<PathBuf, Option<PathBuf>>>,
    counter: AtomicUsize,
}

impl ArtCache {
    fn new(dir: &Path) -> Self {
        ArtCache {
            dir: dir.join("artcache"),
            entries: Mutex::new(HashMap::new()),
            counter: AtomicUsize::new(0),
        }
    }

    fn normalized(&self, ffmpeg: &Path, src: &Path) -> Option<PathBuf> {
        if let Some(hit) = self.entries.lock().unwrap().get(src) {
            return hit.clone();
        }
        std::fs::create_dir_all(&self.dir).ok()?;
        let n = self.counter.fetch_add(1, Ordering::Relaxed);
        let out = self.dir.join(format!("cover-{n}.jpg"));
        let ok = Command::new(ffmpeg)
            .args(["-hide_banner", "-nostdin", "-v", "error", "-y", "-i"])
            .arg(src)
            .args(ART_NORM_OPTS)
            .args(["-frames:v", "1"])
            .arg(&out)
            .status()
            .map(|s| s.success())
            .unwrap_or(false);
        let result = if ok { Some(out) } else { None };
        // Concurrent workers may race to build the same entry — both produce
        // a valid file, last insert wins.
        self.entries
            .lock()
            .unwrap()
            .insert(src.to_path_buf(), result.clone());
        result
    }
}

enum ArtPlan {
    None,
    /// Art travels inside the source file (input 0, or a second un-seeked
    /// copy of the source when trimming).
    Embedded { norm: bool },
    /// Art comes from a separate image file fed as an extra input.
    File { path: PathBuf, norm: bool },
}

/// Convert one file (or one cue slice) to iPod-spec ALAC at `dst`.
fn convert_one(
    tools: &Tools,
    probe: &MediaProbe,
    src: &Path,
    dst: &Path,
    cue: Option<&CueMeta>,
    art_cache: &ArtCache,
) -> Result<(), String> {
    let trimming = cue.is_some();
    let out_rate = target_rate(probe.sample_rate);

    let mut filters: Vec<String> = Vec::new();
    let needs_work = probe.needs_work();
    if needs_work {
        // DSD carries a mountain of ultrasonic shaping noise; kill it before
        // decimating.
        if probe.is_dsd() {
            filters.push(format!("lowpass=f={}", out_rate * 45 / 100));
        }
        let mut ares = format!(
            "aresample={}:osr={}:osf=s16",
            resampler_args(&tools.ffmpeg),
            out_rate
        );
        // Dither only when losing resolution. Upconverting 8-bit needs none.
        if probe.bits > 16 {
            ares.push_str(":dither_method=triangular_hp");
        }
        filters.push(ares);
    }

    // Already in spec and already ALAC — nothing to gain from re-encoding
    // (cue slices still re-encode: stream copy can't cut mid-frame cleanly).
    let copy_codec = probe.codec == "alac" && !needs_work && !trimming;

    // Artwork: prefer what's embedded in the source; otherwise adopt the
    // folder cover. Oversized or non-JPEG art is re-encoded to a small JPEG
    // the iPod renders reliably; in-spec JPEG art is stream-copied untouched.
    let art = if let Some(codec) = &probe.art_codec {
        ArtPlan::Embedded {
            norm: codec != "mjpeg" || probe.art_w > ART_MAX_EDGE || probe.art_h > ART_MAX_EDGE,
        }
    } else if let Some(cover) = src.parent().and_then(folder_cover) {
        let ext_norm = !matches!(lower_ext(&cover).as_str(), "jpg" | "jpeg");
        let size_norm = probe_media(&tools.ffprobe, &cover)
            .map(|p| p.art_w > ART_MAX_EDGE || p.art_h > ART_MAX_EDGE)
            .unwrap_or(false);
        if ext_norm || size_norm {
            // Normalize once per album through the cache; on failure fall
            // back to letting ffmpeg re-encode it inline for every track.
            match art_cache.normalized(&tools.ffmpeg, &cover) {
                Some(cached) => ArtPlan::File {
                    path: cached,
                    norm: false,
                },
                None => ArtPlan::File {
                    path: cover,
                    norm: true,
                },
            }
        } else {
            ArtPlan::File {
                path: cover,
                norm: false,
            }
        }
    } else {
        ArtPlan::None
    };

    let tmp = dst.with_extension("m4a.part");

    let attempt = |art: &ArtPlan, force_norm: bool| -> Result<(), String> {
        let mut cmd = Command::new(&tools.ffmpeg);
        cmd.args(["-hide_banner", "-nostdin", "-v", "error", "-y"]);
        if let Some(meta) = cue {
            // Input-side seek: the FLAC seektable lands at the track start
            // instantly where an output filter had to decode everything
            // before it — quadratic over the album. Still sample-accurate.
            cmd.args(["-ss", &format!("{:.6}", meta.start)]);
            if let Some(end) = meta.end {
                let dur = end - meta.start;
                if dur > 0.0 {
                    cmd.args(["-t", &format!("{dur:.6}")]);
                }
            }
        }
        cmd.arg("-i").arg(src);

        // An attached picture is a single frame at t=0, so the input seek
        // would drop it; trimmed tracks read their embedded art through a
        // second, un-seeked copy of the source instead.
        let art_input: Option<i32> = match art {
            ArtPlan::None => None,
            ArtPlan::Embedded { .. } => {
                if trimming {
                    cmd.arg("-i").arg(src);
                    Some(1)
                } else {
                    Some(0)
                }
            }
            ArtPlan::File { path, .. } => {
                cmd.arg("-i").arg(path);
                Some(1)
            }
        };

        cmd.args(["-map", "0:a:0"]);
        match art_input {
            None => {
                cmd.arg("-vn");
            }
            Some(idx) => {
                cmd.args(["-map", &format!("{idx}:v:0")]);
                let norm = force_norm
                    || match art {
                        ArtPlan::Embedded { norm } | ArtPlan::File { norm, .. } => *norm,
                        ArtPlan::None => false,
                    };
                if norm {
                    cmd.args(ART_NORM_OPTS);
                } else {
                    cmd.args(["-c:v", "copy"]);
                }
                cmd.args(["-disposition:v", "attached_pic"]);
            }
        }

        if !filters.is_empty() {
            cmd.args(["-af", &filters.join(",")]);
        }
        if copy_codec {
            cmd.args(["-c:a", "copy"]);
        } else {
            cmd.args(["-c:a", "alac", "-sample_fmt", "s16p"]);
            if probe.channels > 2 {
                cmd.args(["-ac", "2"]);
            }
        }
        cmd.args(["-map_metadata", "0"]);
        if let Some(meta) = cue {
            cmd.args(["-metadata", &format!("title={}", meta.title)]);
            cmd.args(["-metadata", &format!("artist={}", meta.artist)]);
            cmd.args(["-metadata", &format!("album={}", meta.album)]);
            cmd.args([
                "-metadata",
                &format!("track={}/{}", meta.track_num, meta.track_total),
            ]);
            if !meta.date.is_empty() {
                cmd.args(["-metadata", &format!("date={}", meta.date)]);
            }
            if !meta.genre.is_empty() {
                cmd.args(["-metadata", &format!("genre={}", meta.genre)]);
            }
            if !meta.album_artist.is_empty() {
                cmd.args(["-metadata", &format!("album_artist={}", meta.album_artist)]);
            }
        }
        cmd.args(["-movflags", "+faststart", "-f", "ipod"]);
        cmd.arg(&tmp);

        let out = cmd.output().map_err(|e| e.to_string())?;
        if out.status.success() {
            Ok(())
        } else {
            Err(String::from_utf8_lossy(&out.stderr)
                .trim()
                .replace('\n', " | "))
        }
    };

    // Some sources hold artwork ffmpeg can decode but not stream-copy into
    // MP4. Retry re-encoding the picture, then as a last resort drop it.
    let mut result = attempt(&art, false);
    if result.is_err() && !matches!(art, ArtPlan::None) {
        let _ = std::fs::remove_file(&tmp);
        result = attempt(&art, true);
        if result.is_err() {
            let _ = std::fs::remove_file(&tmp);
            result = attempt(&ArtPlan::None, false);
        }
    }

    match result {
        Ok(()) => {
            std::fs::rename(&tmp, dst).map_err(|e| e.to_string())?;
            Ok(())
        }
        Err(e) => {
            let _ = std::fs::remove_file(&tmp);
            Err(e)
        }
    }
}

/// Classify one work item and convert it if needed. `out_dir` must exist.
fn prepare_one(item: &WorkItem, out_dir: &Path, art_cache: &ArtCache) -> Prepared {
    if item.cue.is_none() && is_direct_ext(&item.src) {
        return Prepared::Ready(item.src.clone());
    }

    let Some(tools) = tools() else {
        // Without ffprobe an .m4a can't be classified — import it directly,
        // exactly as the app behaved before conversion existed.
        if item.cue.is_none() && lower_ext(&item.src) == "m4a" {
            return Prepared::Ready(item.src.clone());
        }
        return Prepared::Rejected(FFMPEG_MISSING.into());
    };

    let probe = match probe_media(&tools.ffprobe, &item.src) {
        Some(p) if !p.codec.is_empty() => p,
        _ => return Prepared::Rejected("unreadable audio file".into()),
    };

    if !probe.is_lossless() {
        // AAC inside .m4a plays natively; other lossy codecs have nothing to
        // gain from an ALAC re-encode and can't play on the iPod anyway.
        if item.cue.is_none() && matches!(probe.codec.as_str(), "aac" | "mp3") {
            return Prepared::Ready(item.src.clone());
        }
        return Prepared::Rejected(format!("lossy source ({})", probe.codec));
    }

    if item.cue.is_none() && lower_ext(&item.src) == "m4a" && !probe.needs_work() {
        return Prepared::Ready(item.src.clone()); // already iPod-spec ALAC
    }

    let dst = out_dir.join(&item.dst_name);
    if let Some(parent) = dst.parent() {
        if std::fs::create_dir_all(parent).is_err() {
            return Prepared::Rejected("couldn't create scratch directory".into());
        }
    }
    match convert_one(tools, &probe, &item.src, &dst, item.cue.as_ref(), art_cache) {
        Ok(()) => Prepared::Ready(dst),
        Err(e) => Prepared::Rejected(format!("conversion failed: {e}")),
    }
}

/// Convert a batch on a worker pool, reporting progress through `on_progress`
/// (done-count high-water mark handled by the caller's counter semantics —
/// calls arrive monotonically). Results come back in input order.
pub fn prepare_batch(
    items: &[WorkItem],
    out_dir: &Path,
    on_progress: &(dyn Fn(usize, &str) + Sync),
) -> Vec<Prepared> {
    if items.is_empty() {
        return Vec::new();
    }
    let _ = std::fs::create_dir_all(out_dir);
    let art_cache = ArtCache::new(out_dir);

    // Half the cores: ffmpeg's ALAC path is single-threaded but the decode +
    // resample chain still saturates a core; leave headroom for the UI.
    let workers = std::thread::available_parallelism()
        .map(|n| n.get() / 2)
        .unwrap_or(4)
        .clamp(2, 8)
        .min(items.len());

    let next = AtomicUsize::new(0);
    let done = AtomicUsize::new(0);
    let results: Vec<Mutex<Option<Prepared>>> = (0..items.len()).map(|_| Mutex::new(None)).collect();

    std::thread::scope(|s| {
        for _ in 0..workers {
            s.spawn(|| loop {
                let i = next.fetch_add(1, Ordering::Relaxed);
                let Some(item) = items.get(i) else { break };
                let prepared = prepare_one(item, out_dir, &art_cache);
                *results[i].lock().unwrap() = Some(prepared);
                let n = done.fetch_add(1, Ordering::Relaxed) + 1;
                on_progress(n, &item.display());
            });
        }
    });

    results
        .into_iter()
        .map(|m| m.into_inner().unwrap().unwrap())
        .collect()
}

/// Scratch directory for one conversion run, unique per call.
pub fn fresh_out_dir() -> PathBuf {
    static COUNTER: AtomicUsize = AtomicUsize::new(0);
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    std::env::temp_dir().join(format!(
        "PodSyncConvert-{stamp}-{}",
        COUNTER.fetch_add(1, Ordering::Relaxed)
    ))
}

// ---------------------------------------------------------------------- tests

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn target_rate_stays_in_clock_family() {
        assert_eq!(target_rate(44100), 44100);
        assert_eq!(target_rate(88200), 44100);
        assert_eq!(target_rate(176400), 44100);
        assert_eq!(target_rate(352800), 44100);
        assert_eq!(target_rate(48000), 48000);
        assert_eq!(target_rate(96000), 48000);
        assert_eq!(target_rate(192000), 48000);
        assert_eq!(target_rate(32000), 44100);
        assert_eq!(target_rate(64000), 48000);
        assert_eq!(target_rate(0), 44100);
    }

    #[test]
    fn bits_fall_back_to_sample_fmt() {
        assert_eq!(bits_from_sample_fmt("s16"), 16);
        assert_eq!(bits_from_sample_fmt("s16p"), 16);
        assert_eq!(bits_from_sample_fmt("s32"), 32);
        assert_eq!(bits_from_sample_fmt("flt"), 32);
        assert_eq!(bits_from_sample_fmt("fltp"), 32);
        assert_eq!(bits_from_sample_fmt("dsd_lsbf"), 1);
        assert_eq!(bits_from_sample_fmt(""), 0);
    }

    #[test]
    fn needs_work_matrix() {
        let base = MediaProbe {
            codec: "alac".into(),
            sample_rate: 44100,
            channels: 2,
            bits: 16,
            sample_fmt: "s16p".into(),
            ..Default::default()
        };
        assert!(!base.needs_work());
        assert!(MediaProbe { sample_rate: 96000, ..base.clone() }.needs_work());
        assert!(MediaProbe { bits: 24, ..base.clone() }.needs_work());
        assert!(MediaProbe { channels: 6, ..base.clone() }.needs_work());
        assert!(MediaProbe { codec: "dsd_lsbf".into(), ..base.clone() }.needs_work());
        assert!(MediaProbe { sample_fmt: "s32p".into(), ..base }.needs_work());
    }

    #[test]
    fn cue_parses_tracks_and_encodings() {
        let dir = std::env::temp_dir().join(format!("podsync-cue-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("album.flac"), b"x").unwrap();
        let cue = "REM GENRE \"Jazz\"\nREM DATE 1959\nPERFORMER \"Miles Davis\"\nTITLE \"Kind of Blue\"\nFILE \"album.flac\" WAVE\n  TRACK 01 AUDIO\n    TITLE \"So What\"\n    INDEX 01 00:00:00\n  TRACK 02 AUDIO\n    TITLE \"Freddie Freeloader\"\n    PERFORMER \"M. Davis\"\n    INDEX 01 09:22:15\n";
        let cue_path = dir.join("album.cue");
        std::fs::write(&cue_path, cue).unwrap();

        let sheet = parse_cue(&cue_path).expect("cue should parse");
        assert_eq!(sheet.audio_file, dir.join("album.flac"));
        assert_eq!(sheet.tracks.len(), 2);
        let t1 = &sheet.tracks[0];
        assert_eq!(t1.title, "So What");
        assert_eq!(t1.artist, "Miles Davis");
        assert_eq!(t1.album, "Kind of Blue");
        assert_eq!(t1.genre, "Jazz");
        assert_eq!(t1.date, "1959");
        assert_eq!(t1.start, 0.0);
        assert_eq!(t1.end, Some(9.0 * 60.0 + 22.0 + 15.0 / 75.0));
        let t2 = &sheet.tracks[1];
        assert_eq!(t2.artist, "M. Davis");
        assert_eq!(t2.end, None);
        assert_eq!(t2.track_num, 2);
        assert_eq!(t2.track_total, 2);

        // single-track cue is not an album image — rejected
        let single = "FILE \"album.flac\" WAVE\nTRACK 01 AUDIO\nINDEX 01 00:00:00\n";
        std::fs::write(dir.join("single.cue"), single).unwrap();
        assert!(parse_cue(&dir.join("single.cue")).is_none());

        // cp1251 title decodes (Кровь = 0xCA 0xF0 0xEE 0xE2 0xFC)
        let mut cp1251 = Vec::new();
        cp1251.extend_from_slice(b"TITLE \"");
        cp1251.extend_from_slice(&[0xCA, 0xF0, 0xEE, 0xE2, 0xFC]);
        cp1251.extend_from_slice(b"\"\nFILE \"album.flac\" WAVE\nTRACK 01 AUDIO\nINDEX 01 00:00:00\nTRACK 02 AUDIO\nINDEX 01 01:00:00\n");
        std::fs::write(dir.join("ru.cue"), &cp1251).unwrap();
        let sheet = parse_cue(&dir.join("ru.cue")).expect("cp1251 cue should parse");
        assert_eq!(sheet.tracks[0].album, "Кровь");

        std::fs::remove_dir_all(&dir).unwrap();
    }

    /// Full pipeline against a real ffmpeg: hi-res FLAC + folder cover +
    /// cue-split album image all come out as iPod-spec ALAC. Skips silently
    /// when ffmpeg isn't installed (CI without Homebrew).
    #[test]
    fn e2e_converts_hires_and_cue_split() {
        let Some(tools) = tools() else {
            eprintln!("skipping: ffmpeg not installed");
            return;
        };
        let dir = std::env::temp_dir().join(format!("podsync-e2e-test-{}", std::process::id()));
        let album = dir.join("Album");
        std::fs::create_dir_all(&album).unwrap();

        let gen = |args: &[&str], out: &Path| {
            let ok = Command::new(&tools.ffmpeg)
                .args(["-hide_banner", "-v", "error", "-y"])
                .args(args)
                .arg(out)
                .status()
                .unwrap()
                .success();
            assert!(ok, "fixture generation failed for {}", out.display());
        };

        // 24-bit / 96 kHz stereo FLAC — must downconvert to 16/48.
        gen(
            &[
                "-f", "lavfi", "-i", "sine=frequency=440:duration=2",
                "-af", "aformat=sample_fmts=s32:channel_layouts=stereo",
                "-ar", "96000", "-sample_fmt", "s32",
                "-c:a", "flac", "-bits_per_raw_sample", "24",
            ],
            &album.join("hires.flac"),
        );
        // Oversized PNG folder cover — must be normalized and embedded.
        gen(
            &["-f", "lavfi", "-i", "color=c=red:size=1200x1200", "-frames:v", "1"],
            &album.join("cover.png"),
        );
        // 4-second 44.1/16 album image with a 2-track cue.
        gen(
            &[
                "-f", "lavfi", "-i", "sine=frequency=330:duration=4",
                "-af", "aformat=sample_fmts=s16:channel_layouts=stereo",
                "-ar", "44100", "-c:a", "flac",
            ],
            &album.join("image.flac"),
        );
        std::fs::write(
            album.join("image.cue"),
            "PERFORMER \"Tester\"\nTITLE \"Cue Album\"\nFILE \"image.flac\" WAVE\nTRACK 01 AUDIO\nTITLE \"One\"\nINDEX 01 00:00:00\nTRACK 02 AUDIO\nTITLE \"Two\"\nINDEX 01 00:02:00\n",
        )
        .unwrap();

        let items = scan(&[dir.display().to_string()]);
        assert_eq!(items.len(), 3, "hires + 2 cue tracks");

        let out_dir = dir.join("out");
        let results = prepare_batch(&items, &out_dir, &|_, _| {});

        let mut checked_hires = false;
        let mut cue_outputs = 0;
        for (item, prepared) in items.iter().zip(&results) {
            let Prepared::Ready(path) = prepared else {
                panic!("{} was rejected", item.display());
            };
            let probe = probe_media(&tools.ffprobe, path).expect("output must probe");
            assert_eq!(probe.codec, "alac", "{}", item.display());
            assert!(probe.sample_rate <= 48000);
            assert!(probe.sample_fmt.starts_with("s16"));
            assert!(probe.channels <= 2);
            if item.cue.is_none() {
                checked_hires = true;
                assert_eq!(probe.sample_rate, 48000, "96k stays in 48k family");
                assert!(probe.art_codec.is_some(), "folder cover embedded");
                assert!(
                    probe.art_w <= 600 && probe.art_h <= 600,
                    "cover normalized to <=600px"
                );
            } else {
                cue_outputs += 1;
                // Split tracks carry the cue tags.
                let tagged = lofty::probe::Probe::open(path).unwrap().read().unwrap();
                use lofty::file::TaggedFileExt;
                use lofty::prelude::*;
                let tag = tagged.primary_tag().expect("cue tags embedded");
                assert_eq!(tag.artist().as_deref(), Some("Tester"));
                assert_eq!(tag.album().as_deref(), Some("Cue Album"));
                let secs = tagged.properties().duration().as_secs_f64();
                assert!(
                    (secs - 2.0).abs() < 0.15,
                    "each cue slice is ~2s, got {secs}"
                );
            }
        }
        assert!(checked_hires);
        assert_eq!(cue_outputs, 2);

        // Oversized JPEG folder cover (right extension, wrong size) must
        // still be rescaled — its size only shows via an ffprobe of the
        // image itself.
        let album2 = dir.join("Album2");
        std::fs::create_dir_all(&album2).unwrap();
        gen(
            &["-f", "lavfi", "-i", "color=c=blue:size=1400x1400", "-frames:v", "1", "-q:v", "3"],
            &album2.join("cover.jpg"),
        );
        gen(
            &[
                "-f", "lavfi", "-i", "sine=frequency=220:duration=1",
                "-af", "aformat=sample_fmts=s16:channel_layouts=stereo",
                "-ar", "44100", "-c:a", "flac",
            ],
            &album2.join("song.flac"),
        );
        let items = scan(&[album2.display().to_string()]);
        let results = prepare_batch(&items, &out_dir, &|_, _| {});
        let Prepared::Ready(path) = &results[0] else {
            panic!("in-spec flac with big jpeg cover was rejected");
        };
        let probe = probe_media(&tools.ffprobe, path).unwrap();
        assert!(probe.art_codec.is_some(), "big jpeg cover embedded");
        assert!(
            probe.art_w <= 600 && probe.art_h <= 600,
            "oversized jpeg cover rescaled, got {}x{}",
            probe.art_w,
            probe.art_h
        );

        // In-spec ALAC m4a passes through untouched (same path back).
        let inspec = album.join("already.m4a");
        gen(
            &[
                "-f", "lavfi", "-i", "sine=frequency=550:duration=1",
                "-af", "aformat=sample_fmts=s16:channel_layouts=stereo",
                "-ar", "44100", "-c:a", "alac", "-sample_fmt", "s16p",
            ],
            &inspec,
        );
        let items = scan(&[inspec.display().to_string()]);
        let results = prepare_batch(&items, &out_dir, &|_, _| {});
        match &results[0] {
            Prepared::Ready(p) => assert_eq!(p, &inspec, "no pointless re-encode"),
            Prepared::Rejected(r) => panic!("in-spec alac rejected: {r}"),
        }

        // Lossy-in-lossless-container is rejected, not converted.
        let lossy = album.join("lossy.wv.wav");
        gen(
            &[
                "-f", "lavfi", "-i", "sine=frequency=550:duration=1",
                "-c:a", "adpcm_ima_wav",
            ],
            &lossy,
        );
        let items = scan(&[lossy.display().to_string()]);
        let results = prepare_batch(&items, &out_dir, &|_, _| {});
        assert!(
            matches!(&results[0], Prepared::Rejected(r) if r.contains("lossy")),
            "adpcm wav must be rejected as lossy"
        );

        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn scan_recurses_dedupes_and_splits() {
        let dir = std::env::temp_dir().join(format!("podsync-scan-test-{}", std::process::id()));
        let sub = dir.join("Album");
        std::fs::create_dir_all(&sub).unwrap();
        std::fs::write(dir.join("loose.mp3"), b"x").unwrap();
        std::fs::write(dir.join("notes.txt"), b"x").unwrap();
        std::fs::write(sub.join("image.flac"), b"x").unwrap();
        std::fs::write(sub.join("cover.jpg"), b"x").unwrap();
        std::fs::write(
            sub.join("image.cue"),
            "FILE \"image.flac\" WAVE\nTRACK 01 AUDIO\nTITLE \"A\"\nINDEX 01 00:00:00\nTRACK 02 AUDIO\nTITLE \"B\"\nINDEX 01 01:00:00\n",
        )
        .unwrap();

        // dropping the folder AND the cue AND the image must not duplicate
        let items = scan(&[
            dir.display().to_string(),
            sub.join("image.cue").display().to_string(),
            sub.join("image.flac").display().to_string(),
        ]);
        let cue_items: Vec<_> = items.iter().filter(|i| i.cue.is_some()).collect();
        let direct: Vec<_> = items.iter().filter(|i| i.cue.is_none()).collect();
        assert_eq!(cue_items.len(), 2, "two cue tracks");
        assert_eq!(direct.len(), 1, "one loose mp3");
        assert!(direct[0].src.ends_with("loose.mp3"));
        assert!(cue_items[0].dst_name.ends_with("/01 A.m4a"));

        std::fs::remove_dir_all(&dir).unwrap();
    }
}
