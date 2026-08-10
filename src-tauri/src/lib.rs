mod commands;
pub mod convert;
pub mod convert_job;
pub mod fsinfo;
pub mod gpod;
mod library;
mod tags;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(library::new_shared())
        .manage(convert_job::new_queue())
        .on_window_event(|window, event| {
            // Normal quit: flush any dirty state before the process exits.
            // (Force-quit can't be caught; the 1.5s auto-flush covers that gap
            // for all but the most recent edit.)
            if let tauri::WindowEvent::CloseRequested { .. } = event {
                let lib = window.app_handle().state::<library::SharedLibrary>();
                let _ = lib.lock().unwrap().flush_if_dirty();
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::list_volumes,
            commands::open_library,
            commands::close_library,
            commands::eject_ipod,
            commands::save_library,
            commands::open_privacy_settings,
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
