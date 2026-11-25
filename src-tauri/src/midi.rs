//! MIDI bridge between the web UI and the system MIDI stack (via `midir`).
//!
//! The WebView used by Tauri on macOS (WKWebView) has no Web MIDI support,
//! so all MIDI I/O lives here and is exposed to the UI as commands/events:
//!
//! * `midi_list_ports`  -> `{ inputs: [..], outputs: [..] }`
//! * `midi_open_input`  / `midi_open_output` (by port name)
//! * `midi_close`
//! * `midi_send(data)`
//! * event `midi-in`    : a complete SysEx message (`Vec<u8>`)
//! * event `midi-ports` : the port list changed (hot-plug)

use std::cell::RefCell;
use std::sync::Mutex;
use std::thread;
use std::time::Duration;

use midir::{Ignore, MidiInput, MidiInputConnection, MidiOutput, MidiOutputConnection};
use serde::Serialize;
use tauri::{AppHandle, Emitter, State};

use crate::sysex::SysexAssembler;

const CLIENT_NAME: &str = "ES-9 Control";
const PORT_POLL_INTERVAL: Duration = Duration::from_millis(1500);

#[derive(Serialize, Clone, PartialEq, Eq, Default, Debug)]
pub struct PortList {
    pub inputs: Vec<String>,
    pub outputs: Vec<String>,
}

#[derive(Default)]
pub struct MidiState {
    input: Mutex<Option<(String, MidiInputConnection<()>)>>,
    output: Mutex<Option<(String, MidiOutputConnection)>>,
}

#[derive(Serialize, Clone, Default)]
pub struct ConnectionInfo {
    pub input: Option<String>,
    pub output: Option<String>,
}

// Enumeration clients live on the main thread: CoreMIDI refreshes its device
// list through notifications delivered on the run loop of the thread that
// created the client, and the main thread is the one running a run loop.
thread_local! {
    static LISTERS: RefCell<Option<(MidiInput, MidiOutput)>> = const { RefCell::new(None) };
}

fn list_ports_impl() -> Result<PortList, String> {
    LISTERS.with(|cell| {
        let mut slot = cell.borrow_mut();
        if slot.is_none() {
            let i = MidiInput::new(&format!("{CLIENT_NAME} (scan in)")).map_err(|e| e.to_string())?;
            let o = MidiOutput::new(&format!("{CLIENT_NAME} (scan out)")).map_err(|e| e.to_string())?;
            *slot = Some((i, o));
        }
        let (i, o) = slot.as_ref().unwrap();
        let inputs = i.ports().iter().filter_map(|p| i.port_name(p).ok()).collect();
        let outputs = o.ports().iter().filter_map(|p| o.port_name(p).ok()).collect();
        Ok(PortList { inputs, outputs })
    })
}

#[tauri::command]
pub fn midi_list_ports() -> Result<PortList, String> {
    list_ports_impl()
}

#[tauri::command]
pub fn midi_connection(state: State<'_, MidiState>) -> ConnectionInfo {
    ConnectionInfo {
        input: state.input.lock().unwrap().as_ref().map(|(n, _)| n.clone()),
        output: state.output.lock().unwrap().as_ref().map(|(n, _)| n.clone()),
    }
}

#[tauri::command]
pub fn midi_open_input(app: AppHandle, state: State<'_, MidiState>, name: String) -> Result<(), String> {
    // Drop any existing connection first.
    if let Some((_, conn)) = state.input.lock().unwrap().take() {
        conn.close();
    }

    let mut midi_in = MidiInput::new(&format!("{CLIENT_NAME} in")).map_err(|e| e.to_string())?;
    // SysEx must not be filtered out.
    midi_in.ignore(Ignore::None);

    let port = midi_in
        .ports()
        .into_iter()
        .find(|p| midi_in.port_name(p).map(|n| n == name).unwrap_or(false))
        .ok_or_else(|| format!("MIDI input \"{name}\" not found"))?;

    let mut assembler = SysexAssembler::new();
    let conn = midi_in
        .connect(
            &port,
            "es9-control-in",
            move |_ts, data, _| {
                for msg in assembler.feed(data) {
                    let _ = app.emit("midi-in", msg);
                }
            },
            (),
        )
        .map_err(|e| e.to_string())?;

    *state.input.lock().unwrap() = Some((name, conn));
    Ok(())
}

#[tauri::command]
pub fn midi_open_output(state: State<'_, MidiState>, name: String) -> Result<(), String> {
    if let Some((_, conn)) = state.output.lock().unwrap().take() {
        conn.close();
    }

    let midi_out = MidiOutput::new(&format!("{CLIENT_NAME} out")).map_err(|e| e.to_string())?;
    let port = midi_out
        .ports()
        .into_iter()
        .find(|p| midi_out.port_name(p).map(|n| n == name).unwrap_or(false))
        .ok_or_else(|| format!("MIDI output \"{name}\" not found"))?;

    let conn = midi_out
        .connect(&port, "es9-control-out")
        .map_err(|e| e.to_string())?;

    *state.output.lock().unwrap() = Some((name, conn));
    Ok(())
}

#[tauri::command]
pub fn midi_close(state: State<'_, MidiState>) {
    if let Some((_, conn)) = state.input.lock().unwrap().take() {
        conn.close();
    }
    if let Some((_, conn)) = state.output.lock().unwrap().take() {
        conn.close();
    }
}

#[tauri::command]
pub fn midi_send(state: State<'_, MidiState>, data: Vec<u8>) -> Result<(), String> {
    let mut guard = state.output.lock().unwrap();
    match guard.as_mut() {
        Some((_, conn)) => conn.send(&data).map_err(|e| e.to_string()),
        None => Err("No MIDI output open".into()),
    }
}

/// Polls the port list in the background and emits `midi-ports` on change.
/// The actual enumeration is scheduled on the main thread (see `LISTERS`).
pub fn spawn_port_watcher(app: AppHandle) {
    thread::spawn(move || {
        let last: std::sync::Arc<Mutex<Option<PortList>>> = Default::default();
        loop {
            let handle = app.clone();
            let last = last.clone();
            let _ = app.run_on_main_thread(move || {
                if let Ok(ports) = list_ports_impl() {
                    let mut prev = last.lock().unwrap();
                    if prev.as_ref() != Some(&ports) {
                        let _ = handle.emit("midi-ports", ports.clone());
                        *prev = Some(ports);
                    }
                }
            });
            thread::sleep(PORT_POLL_INTERVAL);
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Smoke test against the real system MIDI stack (no device required).
    #[test]
    fn can_enumerate_ports() {
        let ports = list_ports_impl().expect("MIDI client creation failed");
        println!("inputs: {:?}\noutputs: {:?}", ports.inputs, ports.outputs);
    }

    /// Loopback through the macOS IAC bus, if present: a config-dump-sized
    /// SysEx must arrive intact after reassembly.
    #[test]
    fn iac_loopback_large_sysex() {
        let ports = list_ports_impl().unwrap();
        let Some(name) = ports.inputs.iter().find(|n| n.contains("IAC")).cloned() else {
            eprintln!("no IAC bus, skipping");
            return;
        };
        let (tx, rx) = std::sync::mpsc::channel::<Vec<u8>>();
        let mut midi_in = MidiInput::new("loop in").unwrap();
        midi_in.ignore(Ignore::None);
        let port = midi_in.ports().into_iter().find(|p| midi_in.port_name(p).unwrap() == name).unwrap();
        let mut asm = SysexAssembler::new();
        let _conn_in = midi_in
            .connect(&port, "loop", move |_, d, _| {
                for m in asm.feed(d) {
                    tx.send(m).unwrap();
                }
            }, ())
            .unwrap();
        let midi_out = MidiOutput::new("loop out").unwrap();
        let oport = midi_out.ports().into_iter().find(|p| midi_out.port_name(p).unwrap() == name).unwrap();
        let mut conn_out = midi_out.connect(&oport, "loop").unwrap();

        let mut msg = vec![0xF0, 0x00, 0x21, 0x27, 0x19, 0x10, 0, 0];
        msg.extend((0..1128).map(|i| (i % 128) as u8));
        msg.push(0xF7);
        conn_out.send(&msg).unwrap();

        let got = rx.recv_timeout(Duration::from_secs(3)).expect("no SysEx received");
        assert_eq!(got, msg);
    }
}
