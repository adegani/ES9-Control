mod files;
mod midi;
mod sysex;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(midi::MidiState::default())
        .setup(|app| {
            midi::spawn_port_watcher(app.handle().clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            midi::midi_list_ports,
            midi::midi_connection,
            midi::midi_open_input,
            midi::midi_open_output,
            midi::midi_close,
            midi::midi_send,
            files::file_read,
            files::file_write,
            files::presets_list,
            files::preset_read,
            files::preset_write,
            files::preset_delete,
            files::presets_reveal,
        ])
        .run(tauri::generate_context!())
        .expect("error while running ES-9 Control");
}
