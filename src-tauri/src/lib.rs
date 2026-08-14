mod app_icon;
mod commands;
pub mod convert;
pub mod convert_job;
pub mod fsinfo;
pub mod gpod;
// Public so tests/ can drive the iTunesDB write path through the real FFI.
// Nothing outside this crate consumes it at runtime.
pub mod library;
mod settings;
mod tags;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(library::new_shared())
        .manage(convert_job::new_queue())
        .setup(|app| {
            // Re-apply the stored Dock icon here rather than from the
            // frontend: the swap is runtime-only, and waiting for the webview
            // to boot would flash the default icon on every single launch.
            if let Some(id) = settings::load(app.handle()).app_icon {
                if let Err(e) = app_icon::apply(app.handle(), Some(&id)) {
                    // A stored id that this build no longer ships must not be
                    // fatal — fall back to the bundle icon and forget it, so
                    // the failure doesn't repeat at every launch.
                    eprintln!("app icon: {e}");
                    let mut stored = settings::load(app.handle());
                    stored.app_icon = None;
                    let _ = settings::save(app.handle(), &stored);
                }
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            // Normal quit: flush any dirty state before the process exits.
            // (Force-quit can't be caught; the 1.5s auto-flush covers that gap
            // for all but the most recent edit.)
            //
            // The flush runs on a worker and the close is deferred until it
            // finishes. Doing it inline blocks the main thread for a full
            // iTunesDB write — and if an import holds the library mutex, for
            // the rest of that import — which reads as a hung window.
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                // Held for every request, including an impatient second click
                // while the first flush is still running. Letting that one
                // through would tear the process down mid-itdb_write, which is
                // the one way to actually corrupt the library.
                api.prevent_close();
                static FLUSHING: std::sync::atomic::AtomicBool =
                    std::sync::atomic::AtomicBool::new(false);
                if FLUSHING.swap(true, std::sync::atomic::Ordering::SeqCst) {
                    return;
                }
                let handle = window.app_handle().clone();
                let window = window.clone();
                std::thread::spawn(move || {
                    {
                        let lib = handle.state::<library::SharedLibrary>();
                        // Poison must not turn a quit into a panic: the edits
                        // are still worth writing.
                        let mut lib = lib.lock().unwrap_or_else(|e| e.into_inner());
                        let _ = lib.flush_if_dirty();
                    }
                    let _ = window.destroy();
                });
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::list_volumes,
            commands::scan_volume,
            commands::open_library,
            commands::close_library,
            commands::eject_ipod,
            commands::save_library,
            commands::open_privacy_settings,
            commands::list_app_icons,
            commands::get_app_icon,
            commands::set_app_icon,
            commands::read_tags,
            commands::import_tracks,
            commands::import_files,
            commands::update_track,
            commands::set_field,
            commands::set_artwork,
            commands::remove_tracks,
            commands::get_artwork,
            commands::convert_formats,
            commands::convert_add,
            commands::convert_remove,
            commands::convert_clear,
            commands::convert_estimate,
            commands::convert_start,
            commands::cancel_convert,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
