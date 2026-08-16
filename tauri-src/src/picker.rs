//! One open panel that takes audio files *and* folders.
//!
//! Tauri's dialog plugin models this as a mode switch — `directory: true` or
//! `false` — because rfd underneath exposes `pick_files` and `pick_folders` as
//! separate calls. That forces the UI to ask which kind of thing the user is
//! about to choose before they have chosen it, which is a question the rest of
//! the pipeline does not care about: `convert_add` probes whatever paths it is
//! handed and walks the ones that turn out to be directories.
//!
//! AppKit has no such split. `NSOpenPanel` takes `canChooseFiles` and
//! `canChooseDirectories` independently, so setting both gives one panel where
//! either is selectable — and that is the whole reason this module exists.

use objc2::rc::Retained;
use objc2::MainThreadMarker;
use objc2_app_kit::{NSModalResponse, NSModalResponseOK, NSOpenPanel};
use objc2_foundation::{NSArray, NSString};
use tauri::AppHandle;

/// Extensions `convert_add` can actually do something with. Kept in step with
/// the filter the file dialog used to carry on the JS side; a folder is not
/// filtered by it, since the walk inside decides what counts.
const AUDIO: &[&str] = &[
    "mp3", "m4a", "aac", "flac", "alac", "wav", "wave", "aif", "aiff", "aifc", "ape", "wv", "tta",
    "dsf", "dff", "shn", "caf", "w64", "rf64", "cue",
];

/// Runs the panel and returns the chosen paths. Empty when the user cancels —
/// cancelling is not an error, and reporting it as one would put a toast on
/// screen every time somebody changed their mind.
///
/// `runModal` is main-thread-only and blocks until dismissed, while commands
/// run on the blocking pool. The channel is what bridges the two: the closure
/// is handed to the main thread and this side waits for its answer, so the
/// command stays synchronous from the caller's point of view without ever
/// touching AppKit off-thread.
pub fn pick_music(app: &AppHandle) -> Result<Vec<String>, String> {
    let (tx, rx) = std::sync::mpsc::channel::<Vec<String>>();

    app.run_on_main_thread(move || {
        let Some(mtm) = MainThreadMarker::new() else {
            let _ = tx.send(Vec::new());
            return;
        };
        let _ = tx.send(run_panel(mtm));
    })
    .map_err(|e| format!("couldn't open the picker: {e}"))?;

    // No timeout: the panel is modal, so "still waiting" means the user has it
    // open. A deadline here would abandon a live dialog and leak its result.
    rx.recv()
        .map_err(|_| "the picker closed without answering".to_string())
}

// Scoped to this function, not the module: the only deprecated call is
// `setAllowedFileTypes`, and a file-wide allow would hide the next one.
#[allow(deprecated)]
fn run_panel(mtm: MainThreadMarker) -> Vec<String> {
    let panel = NSOpenPanel::openPanel(mtm);

    // Both, which is the point.
    panel.setCanChooseFiles(true);
    panel.setCanChooseDirectories(true);
    panel.setAllowsMultipleSelection(true);
    // A folder picked here is a thing to walk, not a package to descend into:
    // without this, choosing a .bundle-shaped directory hands back its
    // contents instead of itself.
    panel.setTreatsFilePackagesAsDirectories(false);
    panel.setResolvesAliases(true);
    panel.setMessage(Some(&NSString::from_str(
        "Choose audio files, or a folder to add everything inside it.",
    )));
    panel.setPrompt(Some(&NSString::from_str("Add")));

    // Greys out what `convert_add` would only reject, the way the file-only
    // dialog this replaces did. Folders stay selectable regardless — the
    // filter applies to files, and what is inside a chosen directory is
    // decided by the walk, not here.
    //
    // Deprecated since macOS 12 in favour of `allowedContentTypes`, which would
    // mean a UTType dependency to say the same thing; still honoured, and the
    // panel stays usable if that ever stops being true — it would just show
    // every file rather than only the ones the queue accepts.
    let types: Vec<Retained<NSString>> = AUDIO.iter().map(|e| NSString::from_str(e)).collect();
    panel.setAllowedFileTypes(Some(&NSArray::from_retained_slice(&types)));

    let response: NSModalResponse = panel.runModal();
    if response != NSModalResponseOK {
        return Vec::new();
    }

    let urls = panel.URLs();
    let mut out = Vec::with_capacity(urls.len());
    for url in urls.iter() {
        if let Some(path) = url.path() {
            out.push(path.to_string());
        }
    }
    out
}
