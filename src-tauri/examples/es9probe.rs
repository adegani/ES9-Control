//! Read-only ES-9 probe: sends only *request* messages and prints every message
//! the unit sends back as hex, one per line. It cannot change any setting: only
//! the read-only requests below are accepted.
//!
//!   cargo run --example es9probe                   # config dump (default)
//!   cargo run --example es9probe -- config mix     # several requests, in order
//!   cargo run --example es9probe > dump.hex        # save (port list goes to stderr)
//!
//! Requests: config (0x23), mix (0x2A), version (0x22), usage (0x2B), samplerate (0x2C).
//! The output format matches src/lib/fixtures/*.hex, so a dump can be used as a
//! test fixture directly.
use midir::{Ignore, MidiInput, MidiOutput};
use std::sync::{Arc, Mutex};
use std::time::Duration;

const READ_ONLY_REQUESTS: [(&str, u8); 5] = [("config", 0x23), ("mix", 0x2A), ("version", 0x22), ("usage", 0x2B), ("samplerate", 0x2C)];

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let mut names: Vec<String> = std::env::args().skip(1).collect();
    if names.is_empty() {
        names.push("config".into());
    }
    let mut commands = vec![];
    for n in &names {
        let cmd = READ_ONLY_REQUESTS.iter().find(|(k, _)| k == n).map(|(_, c)| *c);
        let known: Vec<&str> = READ_ONLY_REQUESTS.iter().map(|(k, _)| *k).collect();
        commands.push(cmd.ok_or_else(|| format!("unknown request {n:?} (use: {})", known.join(", ")))?);
    }

    let mut inp = MidiInput::new("es9probe-in")?;
    inp.ignore(Ignore::None);
    let out = MidiOutput::new("es9probe-out")?;

    let find = |names: Vec<String>| names.iter().position(|n| n.contains("ES-9"));
    let in_ports = inp.ports();
    let out_ports = out.ports();
    let in_names: Vec<String> = in_ports.iter().map(|p| inp.port_name(p).unwrap_or_default()).collect();
    let out_names: Vec<String> = out_ports.iter().map(|p| out.port_name(p).unwrap_or_default()).collect();
    eprintln!("inputs:  {in_names:?}\noutputs: {out_names:?}");
    let ip = &in_ports[find(in_names).ok_or("no ES-9 MIDI input found")?];
    let op = &out_ports[find(out_names).ok_or("no ES-9 MIDI output found")?];

    let rx: Arc<Mutex<Vec<Vec<u8>>>> = Arc::default();
    let rx2 = rx.clone();
    let _in_conn = inp.connect(ip, "rx", move |_, d, _| rx2.lock().unwrap().push(d.to_vec()), ())?;
    let mut out_conn = out.connect(op, "tx")?;

    std::thread::sleep(Duration::from_millis(300));
    for cmd in commands {
        out_conn.send(&[0xF0, 0x00, 0x21, 0x27, 0x19, cmd, 0xF7])?;
        std::thread::sleep(Duration::from_millis(1500));
    }

    let msgs = rx.lock().unwrap();
    eprintln!("{} message(s) received", msgs.len());
    for d in msgs.iter() {
        let hex: Vec<String> = d.iter().map(|b| format!("{b:02X}")).collect();
        println!("{}", hex.join(" "));
    }
    Ok(())
}
