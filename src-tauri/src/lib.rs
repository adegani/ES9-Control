mod midi;
mod sysex;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
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
        ])
        .run(tauri::generate_context!())
        .expect("error while running ES-9 Control");
}
