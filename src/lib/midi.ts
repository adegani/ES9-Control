/**
 * Thin MIDI transport. Inside Tauri it talks to the Rust backend; in a plain
 * browser (e.g. `npm run dev`) it falls back to a simulated ES-9 so the UI can
 * be developed without hardware.
 */
import {
  build,
  defaultConfig,
  encodeConfigDump,
  encodeMixDump,
  HEADER,
  hzToEqFreq,
  isEs9Sysex,
  TX,
  type Es9Config,
} from "./protocol";

export interface PortList {
  inputs: string[];
  outputs: string[];
}

export interface MidiTransport {
  readonly simulated: boolean;
  listPorts(): Promise<PortList>;
  openInput(name: string): Promise<void>;
  openOutput(name: string): Promise<void>;
  close(): Promise<void>;
  send(data: number[]): Promise<void>;
  onMessage(cb: (data: number[]) => void): void;
  onPortsChanged(cb: (ports: PortList) => void): void;
}

const isTauri = () => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

// ───────────────────────────── Tauri transport ─────────────────────────────

async function createTauriTransport(): Promise<MidiTransport> {
  const { invoke } = await import("@tauri-apps/api/core");
  const { listen } = await import("@tauri-apps/api/event");
  return {
    simulated: false,
    listPorts: () => invoke<PortList>("midi_list_ports"),
    openInput: (name) => invoke("midi_open_input", { name }),
    openOutput: (name) => invoke("midi_open_output", { name }),
    close: () => invoke("midi_close"),
    send: (data) => invoke("midi_send", { data }),
    onMessage: (cb) => void listen<number[]>("midi-in", (e) => cb(e.payload)),
    onPortsChanged: (cb) => void listen<PortList>("midi-ports", (e) => cb(e.payload)),
  };
}

// ───────────────────────────── Simulated ES-9 ─────────────────────────────

const SIM_IN = "ES-9 MIDI In";
/** Rough macro-fader → raw gain mapping used only by the simulator. */
const vToRaw = (v: number) => (v === 0 ? 0 : Math.min(0x7fff, Math.round(8192 * Math.pow(2, (v - 103) / 12))));
const SIM_OUT = "ES-9 MIDI Out";

function simulatedConfig(): Es9Config {
  const c = defaultConfig();
  c.capture[0] = [0x70, 0x71, 0x72, 0x73, 0x74, 0x75, 0x76, 0x77];
  c.capture[1] = [0x78, 0x79, 0x7a, 0x7b, 0x7c, 0x7d, 0x20, 0x21];
  c.outputs[0] = [6, 7, 8, 9, 4, 5, 2, 3];
  c.outputs[1] = [11, 10, 12, 13, 14, 15, 0x10, 0x11];
  c.capture[2] = [0x00, 0x01, 0x02, 0x03, 0x70, 0x71, 0x60, 0x61];
  c.outputs[2] = [6, 7, 12, 13, 8, 9, 0x10, 0x11];
  c.capture[3] = [48, 49, 0x04, 0x05, 0x06, 0x07, 0x72, 0x73];
  c.outputs[3] = [14, 15, 4, 5, 2, 3, 11, 10];
  c.links[16] = c.links[17] = true; // USB 1/2, 3/4
  c.links[0] = true; // Inputs 1/2
  c.links[24] = c.links[25] = true; // Mix 1/2, 3/4
  c.vmix.fill(0);
  [0, 2, 4, 6].forEach((ch) => (c.vmix[ch] = 103));
  c.vpan[0] = -20;
  c.vpan[2] = 20;
  c.eq[0][0][0] = { enabled: true, type: 3, freq: hzToEqFreq(40), q: 12341, gain: 0 };
  c.eq[0][0][1] = { enabled: true, type: 6, freq: hzToEqFreq(350), q: 14000, gain: -6000 };
  c.eq[0][0][2] = { enabled: true, type: 6, freq: hzToEqFreq(3000), q: 16000, gain: 8000 };
  c.eq[0][0][3] = { enabled: true, type: 5, freq: hzToEqFreq(9000), q: 12341, gain: 6000 };
  // Derive the raw matrix from the macro faders, as the hardware does.
  for (let m = 0; m < 16; m++) for (let ch = 0; ch < 8; ch++) c.mix[m][ch] = vToRaw(c.vmix[m * 8 + ch]);
  c.mix[4][1] = 6000;
  c.mix[5][3] = 20000;
  c.smoothing[0] = true;
  c.midiChUsb = 1;
  c.midiChDin = 2;
  return c;
}

function createSimTransport(): MidiTransport {
  const cfg = simulatedConfig();
  let msgCb: (d: number[]) => void = () => {};
  let open = false;
  const reply = (d: number[]): void => {
    setTimeout(() => open && msgCb(d), 15 + Math.random() * 25);
  };
  const text = (s: string) => [...HEADER, 0x32, ...[...s].map((c) => c.charCodeAt(0)), 0, 0xf7];


  return {
    simulated: true,
    listPorts: async () => ({ inputs: [SIM_IN, "IAC Driver Bus 1"], outputs: [SIM_OUT, "IAC Driver Bus 1"] }),
    openInput: async () => void (open = true),
    openOutput: async () => {},
    close: async () => void (open = false),
    onMessage: (cb) => (msgCb = cb),
    onPortsChanged: () => {},
    send: async (d) => {
      if (!isEs9Sysex(d)) return;
      const cmd = d[5];
      switch (cmd) {
        case TX.REQ_VERSION:
          return reply(text("ES-9 v1.3.2 (simulated)"));
        case TX.REQ_CONFIG:
          return reply(encodeConfigDump(cfg));
        case TX.REQ_MIX:
          return reply(encodeMixDump(cfg.mix, cfg.vmix, cfg.vpan));
        case TX.REQ_USAGE: {
          const enabled = cfg.eq.flat(2).filter((b) => b.enabled).length;
          const used = 96 + 4 + enabled * 6;
          return reply([...HEADER, 0x12, 0, 96, used >> 7, used & 0x7f, 0, 90, 0, 98, 0xf7]);
        }
        case TX.REQ_SAMPLE_RATE:
          return reply([...HEADER, 0x14, 0, 93, 96, 0xf7]);
        case TX.REQ_SAVE:
          return reply(text("OK"));
        case TX.REQ_RESTORE:
        case TX.REQ_RESET:
          return reply(text("OK"));
        case TX.SET_VMIX: {
          const idx = d[6];
          const m = idx >> 3;
          const ch = idx & 7;
          // In a stereo-linked pair the odd mix slot carries the pan.
          const isPan = (m & 1) === 1 && cfg.links[m < 8 ? 24 + (m >> 1) : 28 + ((m - 8) >> 1)];
          if (isPan) {
            cfg.vpan[(m - 1) * 8 + ch] = d[7] - 64;
            return;
          }
          cfg.vmix[idx] = d[7];
          if (m < 16) {
            cfg.mix[m][ch] = vToRaw(d[7]);
            reply(build.rawMix(m, ch, cfg.mix[m][ch]));
          }
          return;
        }
      }
      if ((cmd & 0xf0) === TX.SET_MIX) cfg.mix[cmd & 0xf][d[6]] = (d[7] << 14) | (d[8] << 7) | d[9];
    },
  };
}

export async function createTransport(): Promise<MidiTransport> {
  return isTauri() ? createTauriTransport() : createSimTransport();
}
