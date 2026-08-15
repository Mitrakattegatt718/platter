//! Preferences that outlive the process, stored as JSON in the app config dir.
//!
//! Deliberately separate from the localStorage prefs the frontend keeps
//! (grouping, sort, last view): those are only ever read by React, while this
//! one has to be readable *before* a webview exists. The Dock icon is applied
//! in the setup hook, and routing it through the frontend would show the
//! default icon for as long as the webview takes to boot — on every launch.

use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
#[serde(default, rename_all = "camelCase")]
pub struct Settings {
    /// An id from `app_icon::ICONS`, or None for the bundle's own icon.
    pub app_icon: Option<String>,
}

fn path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e| format!("no app config dir: {e}"))?;
    Ok(dir.join("settings.json"))
}

/// Never fails. A missing file, an unreadable one and a malformed one all mean
/// "defaults" — settings here are a convenience, and refusing to start over a
/// corrupt prefs file would be a far worse outcome than forgetting a choice.
/// `#[serde(default)]` covers the narrower case of a file written by an older
/// build that lacks a field.
pub fn load(app: &AppHandle) -> Settings {
    path(app)
        .ok()
        .and_then(|p| std::fs::read(p).ok())
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
        .unwrap_or_default()
}

pub fn save(app: &AppHandle, settings: &Settings) -> Result<(), String> {
    let path = path(app)?;
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)
            .map_err(|e| format!("couldn't create {}: {e}", dir.display()))?;
    }
    let json = serde_json::to_vec_pretty(settings).map_err(|e| e.to_string())?;
    std::fs::write(&path, json).map_err(|e| format!("couldn't write {}: {e}", path.display()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trips_through_json() {
        let settings = Settings {
            app_icon: Some("midnight".into()),
        };
        let json = serde_json::to_vec(&settings).unwrap();
        assert_eq!(serde_json::from_slice::<Settings>(&json).unwrap(), settings);
    }

    #[test]
    fn default_is_the_bundle_icon() {
        assert_eq!(Settings::default().app_icon, None);
    }

    #[test]
    fn missing_and_unknown_fields_fall_back_to_defaults() {
        // A prefs file written by an older build, and one written by a newer
        // one, both have to load rather than wiping every other preference.
        assert_eq!(
            serde_json::from_str::<Settings>("{}").unwrap(),
            Settings::default()
        );
        assert_eq!(
            serde_json::from_str::<Settings>(r#"{"appIcon":null}"#).unwrap(),
            Settings::default()
        );
        assert_eq!(
            serde_json::from_str::<Settings>(r#"{"appIcon":"mint","somethingNew":42}"#)
                .unwrap()
                .app_icon
                .as_deref(),
            Some("mint")
        );
    }

    #[test]
    fn serialises_camel_case() {
        // The frontend reads this shape; snake_case here would silently break
        // the picker's initial selection.
        let json = serde_json::to_string(&Settings {
            app_icon: Some("sunset".into()),
        })
        .unwrap();
        assert!(json.contains("appIcon"), "unexpected shape: {json}");
    }
}
