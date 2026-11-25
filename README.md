# ES-9 Control

A fast desktop configuration tool for the **Expert Sleepers ES-9** USB audio interface. It is a local, native rewrite of the official web-based config tool (in `original_app/`). That tool needed Chrome and Web MIDI.

Built with **Tauri 2** (Rust) and **Svelte 5 + TypeScript**. The release app is about 3 MB.

## Features

- **Auto-detect**: the app finds the ES-9 MIDI ports and connects on its own, including hot-plug. You can also pick the ports by hand.
- **Routing**: USB capture and playback (16 + 16), Mixer 1, and Mixer 2 or the S/PDIF ports. Stereo links are applied automatically.
- **Mixer**: macro mix with faders and pan knobs. Linked pairs show up as stereo strips.
- **Raw matrix**: the 16×8 gain matrix that actually runs on the hardware.
- **Input EQ**: 4 bands per mixer input. The response graph has draggable handles, and DSP usage is shown alongside.
- **Settings**: S/PDIF ↔ Mixer 2, MIDI Thru, mixer MIDI channels, input DC blocking, mix smoothing, and output DC offsets.
- **Flash**: save or load the Hosted and Standalone slots, and reset to defaults.
- **MIDI monitor**: a log of all SysEx traffic, with hex dumps.

Shortcuts: `⌘1…6` switch views, `⌘R` reloads the config from the unit, `⌘S` / `⇧⌘S` save to the Hosted / Standalone flash slot.

## Requirements

- ES-9 firmware **v1.2.0 or later** (config dump version 3)
- To build: Rust (stable), Node.js 22.12+ (see `.nvmrc`), and Xcode command-line tools on macOS

## Development

```sh
npm install
npm run tauri dev      # run the desktop app with hot reload
npm run dev            # UI only, in a browser, against a simulated ES-9
npm test               # protocol unit tests (vitest)
npm run check          # svelte-check / TypeScript
cd src-tauri && cargo test   # SysEx reassembly + CoreMIDI loopback (IAC bus) tests
```

## Build

```sh
npm run tauri build    # → src-tauri/target/release/bundle/
```

## Architecture

```
src-tauri/src/
  midi.rs      midir-based MIDI bridge: list/open/close/send, hot-plug watcher
  sysex.rs     reassembles SysEx split across packets (CoreMIDI)
src/lib/
  protocol.ts  ES-9 SysEx codec: builders, parsers, value conversions (pure, tested)
  store.svelte.ts  reactive device state + actions, message coalescing
  midi.ts      transport: Tauri commands/events, or a simulated ES-9 in the browser
  eqmath.ts    approximate EQ magnitude response for display
  components/  Fader, Knob, HSlider, Select, Toggle, EqGraph, Icon
  views/       Routing, Mixer, Matrix, Eq, Settings, Monitor
```

The WebView that Tauri uses on macOS (WKWebView) has no Web MIDI. All MIDI I/O therefore goes through Rust, and the UI talks to it over Tauri commands and events. Continuous controls are coalesced (one message per control every 16 ms) so dragging a fader never floods the MIDI port.
