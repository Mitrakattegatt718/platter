//! The session log — one file, written by both halves of the app.
//!
//! Rust logs through `log::`; the webview batches its lines and ships them to
//! `ui_log`, which re-emits them under the `ui` target so a reader can tell the
//! two apart. One stream, in order, is the whole point: nearly every backend
//! entry exists because of something the user did in the UI a moment earlier,
//! and correlating two files by eye is how support logs go unread.
//!
//! Cleared at every launch, so what a user exports after hitting a problem is
//! that problem and nothing else. The finished session is renamed aside rather
//! than deleted — the log that matters most is usually the one from the run
//! that just crashed, and by the time the user relaunches to export it, a
//! delete would have taken it. Export carries both.

use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

use tauri::{AppHandle, Manager};

pub const LOG_FILE: &str = "platter.log";
pub const PREVIOUS_LOG_FILE: &str = "platter.previous.log";

/// `~/Library/Logs/<identifier>`.
///
/// Resolved by hand rather than through `app.path().app_log_dir()` because the
/// old file has to be moved before the log plugin opens the new one, and the
/// plugin is installed before there is an `AppHandle` to ask. macOS only, so
/// the layout is fixed and this can't drift from what Tauri computes.
pub fn log_dir(identifier: &str) -> Option<PathBuf> {
    let home = std::env::var_os("HOME")?;
    Some(Path::new(&home).join("Library").join("Logs").join(identifier))
}

/// Set the directory up for a fresh session. Best-effort throughout: a log we
/// can't rotate is not a reason to refuse to launch, and the plugin will
/// happily append to whatever is left.
pub fn rotate(dir: &Path) {
    let _ = fs::create_dir_all(dir);
    let current = dir.join(LOG_FILE);
    if !current.exists() {
        return;
    }
    if fs::rename(&current, dir.join(PREVIOUS_LOG_FILE)).is_err() {
        // Rename across a full or read-only disk. Truncating still gets the
        // user a clean session, which is what was asked for.
        let _ = fs::remove_file(&current);
    }
}

/// macOS product version, or "unknown" if `sw_vers` isn't answerable. Worth a
/// process spawn once per launch: "works here, not there" bug reports turn on
/// exactly this line.
pub fn macos_version() -> String {
    Command::new("sw_vers")
        .arg("-productVersion")
        .output()
        .ok()
        .filter(|o| o.status.success())
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
        .filter(|v| !v.is_empty())
        .unwrap_or_else(|| "unknown".into())
}

/// The first lines of every session. Pure so it can be asserted on; the
/// caller supplies the facts.
pub fn session_header(app_version: &str, os_version: &str, arch: &str) -> Vec<String> {
    vec![
        format!("Platter {app_version} on macOS {os_version} ({arch})"),
        "session log — cleared at each launch, and it records file paths, \
         volume names and track titles"
            .into(),
    ]
}

/// A line the webview asked us to record. Its level is carried rather than
/// baked into the text so the file's own level column stays truthful, and so
/// a `warn` in the UI is greppable the same way a `warn` in Rust is.
#[derive(serde::Deserialize)]
pub struct UiLogLine {
    pub level: String,
    pub message: String,
}

#[tauri::command]
pub async fn ui_log(lines: Vec<UiLogLine>) -> Result<(), String> {
    for line in lines {
        match line.level.as_str() {
            "error" => log::error!(target: "ui", "{}", line.message),
            "warn" => log::warn!(target: "ui", "{}", line.message),
            _ => log::info!(target: "ui", "{}", line.message),
        }
    }
    Ok(())
}

/// `~` for the home directory. The full path is half username and half
/// boilerplate, and it is being shown in a 420px dialog — the part that says
/// *which file* is the tail. Works pasted into a shell, which is what the line
/// is for.
pub fn tilde(path: &str, home: Option<&str>) -> String {
    match home.filter(|h| !h.is_empty()) {
        Some(home) if path == home => "~".into(),
        Some(home) => match path.strip_prefix(home).filter(|r| r.starts_with('/')) {
            Some(rest) => format!("~{rest}"),
            None => path.to_string(),
        },
        None => path.to_string(),
    }
}

/// Where the log lives, for the Advanced section to show. The user needs the
/// path when export itself is what's broken.
#[tauri::command]
pub async fn log_path(app: AppHandle) -> Result<String, String> {
    let dir = app.path().app_log_dir().map_err(|e| e.to_string())?;
    let full = dir.join(LOG_FILE);
    let home = std::env::var("HOME").ok();
    Ok(tilde(&full.to_string_lossy(), home.as_deref()))
}

/// One file the user can attach to a bug report: this session, and the one
/// before it when there is one.
#[tauri::command]
pub async fn export_logs(app: AppHandle, dest: String) -> Result<(), String> {
    let dir = app.path().app_log_dir().map_err(|e| e.to_string())?;
    tauri::async_runtime::spawn_blocking(move || write_export(&dir, Path::new(&dest)))
        .await
        .map_err(|e| e.to_string())?
}

fn write_export(dir: &Path, dest: &Path) -> Result<(), String> {
    let current = fs::read_to_string(dir.join(LOG_FILE)).unwrap_or_default();
    let previous = fs::read_to_string(dir.join(PREVIOUS_LOG_FILE)).ok();
    let body = joined_sessions(previous.as_deref(), &current);
    if body.trim().is_empty() {
        return Err("The log is empty — there is nothing to export yet.".into());
    }
    fs::write(dest, body).map_err(|e| format!("Couldn't write {}: {e}", dest.display()))
}

/// Previous session first, so the file reads forwards in time.
pub fn joined_sessions(previous: Option<&str>, current: &str) -> String {
    match previous {
        Some(prev) if !prev.trim().is_empty() => format!(
            "──────── previous session ────────\n{}\n──────── current session ────────\n{}",
            prev.trim_end(),
            current,
        ),
        _ => current.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Per-case directory: the suite runs threaded, and two cases sharing one
    /// path would rotate each other's files.
    fn scratch(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "platter-log-test-{}-{}",
            name,
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn log_dir_sits_under_the_users_library() {
        let dir = log_dir("com.example.app").expect("HOME is set under test");
        assert!(dir.ends_with("Library/Logs/com.example.app"), "{dir:?}");
    }

    #[test]
    fn the_header_names_the_build_and_warns_what_is_in_the_file() {
        let header = session_header("1.2.3", "26.0", "aarch64");
        assert!(header[0].contains("1.2.3"));
        assert!(header[0].contains("26.0"));
        assert!(header[0].contains("aarch64"));
        // The privacy note is the only warning a user gets before sharing it.
        assert!(header[1].contains("track titles"));
    }

    #[test]
    fn rotate_moves_the_finished_session_aside() {
        let dir = scratch("rotate");
        fs::write(dir.join(LOG_FILE), "old session").unwrap();

        rotate(&dir);

        assert!(!dir.join(LOG_FILE).exists());
        let moved = fs::read_to_string(dir.join(PREVIOUS_LOG_FILE)).unwrap();
        assert_eq!(moved, "old session");
    }

    #[test]
    fn rotate_is_fine_with_a_first_launch() {
        let dir = scratch("first-launch").join("not-yet");
        rotate(&dir);
        assert!(dir.exists());
    }

    #[test]
    fn rotate_keeps_only_one_previous_session() {
        let dir = scratch("one-previous");
        fs::write(dir.join(PREVIOUS_LOG_FILE), "two runs ago").unwrap();
        fs::write(dir.join(LOG_FILE), "last run").unwrap();

        rotate(&dir);

        let previous = fs::read_to_string(dir.join(PREVIOUS_LOG_FILE)).unwrap();
        assert_eq!(previous, "last run");
    }

    #[test]
    fn an_export_reads_forwards_in_time() {
        let joined = joined_sessions(Some("earlier\n"), "later\n");
        let earlier = joined.find("earlier").unwrap();
        let later = joined.find("later").unwrap();
        assert!(earlier < later);
        assert!(joined.contains("previous session"));
    }

    #[test]
    fn a_first_run_exports_without_an_empty_previous_banner() {
        assert_eq!(joined_sessions(None, "only\n"), "only\n");
        assert_eq!(joined_sessions(Some("  \n"), "only\n"), "only\n");
    }

    #[test]
    fn exporting_nothing_is_an_error_rather_than_an_empty_file() {
        let dir = scratch("empty-export");
        let dest = dir.join("out.log");
        assert!(write_export(&dir, &dest).is_err());
        assert!(!dest.exists());
    }

    #[test]
    fn tilde_shortens_only_a_real_home_prefix() {
        let home = Some("/Users/ada");
        assert_eq!(tilde("/Users/ada/Library/Logs/x.log", home), "~/Library/Logs/x.log");
        assert_eq!(tilde("/Users/ada", home), "~");
        // A longer username starting with the same letters is a different user.
        assert_eq!(tilde("/Users/adalovelace/x", home), "/Users/adalovelace/x");
        assert_eq!(tilde("/var/log/x", home), "/var/log/x");
    }

    #[test]
    fn tilde_leaves_the_path_alone_without_a_home() {
        assert_eq!(tilde("/Users/ada/x", None), "/Users/ada/x");
        assert_eq!(tilde("/Users/ada/x", Some("")), "/Users/ada/x");
    }

    #[test]
    fn an_export_carries_both_sessions() {
        let dir = scratch("export");
        fs::write(dir.join(PREVIOUS_LOG_FILE), "the run that broke\n").unwrap();
        fs::write(dir.join(LOG_FILE), "the run that exports\n").unwrap();
        let dest = dir.join("out.log");

        write_export(&dir, &dest).unwrap();

        let out = fs::read_to_string(&dest).unwrap();
        assert!(out.contains("the run that broke"));
        assert!(out.contains("the run that exports"));
    }
}
