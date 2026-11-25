/**
 * Application state + actions. Every user action updates local state
 * optimistically and sends the matching SysEx to the ES-9; incoming SysEx
 * replaces local state with the device's truth.
 */
import { createTransport, type MidiTransport, type PortList } from "./midi";
import {
  build,
  captureLabel,
  captureLinkIndex,
  defaultConfig,
  FlashSlot,
  mixLinkIndex,
  OPT_MIDI_THRU,
  OPT_MIXER2,
  outputLabel,
  parseIncoming,
  toHex,
  type EqBand,
  type Es9Config,
} from "./protocol";

export type LogDir = "tx" | "rx" | "info" | "error";
export interface LogEntry {
  id: number;
  time: Date;
  dir: LogDir;
  text: string;
  hex?: string;
  count: number;
}
export interface Toast {
  id: number;
  kind: "info" | "success" | "error";
  text: string;
}

const LOG_LIMIT = 400;
const POLL_MS = 4000;
const FLUSH_MS = 16;
const STORAGE_KEY = "es9.ports";
const ES9_IN = "ES-9 MIDI In";
const ES9_OUT = "ES-9 MIDI Out";

let nextId = 1;

function pickPort(ports: string[], preferred: string | null, exact: string): string | null {
  if (preferred && ports.includes(preferred)) return preferred;
  if (ports.includes(exact)) return exact;
  return ports.find((p) => /ES-?9/i.test(p)) ?? null;
}

class Es9Store {
  cfg = $state<Es9Config>(defaultConfig());
  haveConfig = $state(false);

  ports = $state<PortList>({ inputs: [], outputs: [] });
  inputName = $state<string | null>(null);
  outputName = $state<string | null>(null);
  connected = $state(false);
  simulated = $state(false);

  version = $state<string | null>(null);
  sampleRate = $state<number | null>(null);
  usage = $state<(number | null)[]>([null, null]);

  log = $state<LogEntry[]>([]);
  toasts = $state<Toast[]>([]);
  lastTx = $state<string>("");
  lastRx = $state<string>("");

  private transport: MidiTransport | null = null;
  private pending = new Map<string, { data: number[]; text: string; quiet: boolean }>();
  private flushScheduled = false;
  private awaitingVersion = false;
  private pollTimer: ReturnType<typeof setInterval> | null = null;

  // ───────────── derived helpers ─────────────

  get mixer2Enabled() {
    return (this.cfg.options & OPT_MIXER2) !== 0;
  }
  get midiThru() {
    return (this.cfg.options & OPT_MIDI_THRU) !== 0;
  }
  isCaptureLinked(v: number) {
    const i = captureLinkIndex(v);
    return i >= 0 && this.cfg.links[i];
  }
  isMixStereo(m: number) {
    return (m & 1) === 0 && this.cfg.links[mixLinkIndex(m)];
  }
  mixDest(m: number) {
    return outputLabel(this.cfg.outputs[2 + (m >> 3)][m & 7]);
  }
  mixTitle(m: number) {
    if (this.isMixStereo(m)) return `Mix ${m + 1}/${m + 2}`;
    return `Mix ${m + 1}`;
  }
  mixDestTitle(m: number) {
    if (this.isMixStereo(m)) return `${this.mixDest(m)} / ${this.mixDest(m + 1)}`;
    return this.mixDest(m);
  }
  /** Source label of mixer channel (mixer 0 = DSP 2, mixer 1 = DSP 3). */
  channelLabel(mixer: number, ch: number, stereoAware = false) {
    const v = this.cfg.capture[2 + mixer][ch];
    const label = captureLabel(v);
    if (stereoAware && this.isCaptureLinked(v)) return `${label}/${(v & 0xe) + 2}`;
    return label;
  }
  /** Channels shown on the macro mixer for a mix (linked inputs collapse into one strip). */
  visibleChannels(mixer: number): number[] {
    const out: number[] = [];
    for (let ch = 0; ch < 8; ch++) {
      out.push(ch);
      if ((ch & 1) === 0 && this.isCaptureLinked(this.cfg.capture[2 + mixer][ch])) ch++;
    }
    return out;
  }

  // ───────────── lifecycle ─────────────

  async init() {
    this.transport = await createTransport();
    this.simulated = this.transport.simulated;
    this.transport.onMessage((d) => this.handleIncoming(d));
    this.transport.onPortsChanged((p) => this.handlePorts(p));
    try {
      this.handlePorts(await this.transport.listPorts());
    } catch (e) {
      this.error(`Unable to list MIDI ports: ${e}`);
    }
    if (this.simulated) this.info("Running in browser: using a simulated ES-9");
  }

  private savedPorts(): { input: string | null; output: string | null } {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
    } catch {
      return { input: null, output: null };
    }
  }

  private handlePorts(p: PortList) {
    this.ports = p;
    // Lost the device?
    if (this.connected && (!p.inputs.includes(this.inputName!) || !p.outputs.includes(this.outputName!))) {
      this.connected = false;
      this.stopPolling();
      this.transport?.close();
      this.info("ES-9 disconnected");
      this.toast("error", "ES-9 disconnected");
    }
    if (!this.connected) {
      const saved = this.savedPorts();
      const i = pickPort(p.inputs, saved.input, ES9_IN);
      const o = pickPort(p.outputs, saved.output, ES9_OUT);
      if (i && o) void this.connect(i, o);
      else {
        this.inputName ??= p.inputs[0] ?? null;
        this.outputName ??= p.outputs[0] ?? null;
      }
    }
  }

  async connect(input: string, output: string) {
    if (!this.transport) return;
    try {
      await this.transport.close();
      await this.transport.openInput(input);
      await this.transport.openOutput(output);
      this.inputName = input;
      this.outputName = output;
      this.connected = true;
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ input, output }));
      this.info(`Connected: in "${input}", out "${output}"`);
      this.requestVersion();
      this.requestConfig();
      this.send("sr", build.reqSampleRate(), "sample rate request");
      this.send("usage", build.reqUsage(), "usage request");
      this.startPolling();
    } catch (e) {
      this.connected = false;
      this.error(`Connection failed: ${e}`);
      this.toast("error", `Connection failed: ${e}`);
    }
  }

  async disconnect() {
    this.stopPolling();
    await this.transport?.close();
    this.connected = false;
    this.info("Disconnected");
  }

  private startPolling() {
    this.stopPolling();
    this.pollTimer = setInterval(() => {
      this.send("usage", build.reqUsage(), "usage request", true);
      this.send("sr", build.reqSampleRate(), "sample rate request", true);
    }, POLL_MS);
  }
  private stopPolling() {
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.pollTimer = null;
  }

  // ───────────── transport ─────────────

  /**
   * Queue a message. Messages with the same key are coalesced and flushed at
   * most every FLUSH_MS, so dragging a fader never floods the MIDI port.
   * (Timer-based rather than requestAnimationFrame, which is paused while the
   * window is hidden.)
   */
  send(key: string, data: number[], text: string, quiet = false) {
    if (!this.connected) return;
    this.pending.delete(key); // keep latest at the end to preserve ordering
    this.pending.set(key, { data, text, quiet });
    if (!this.flushScheduled) {
      this.flushScheduled = true;
      const wait = Math.max(0, this.lastFlush + FLUSH_MS - performance.now());
      setTimeout(() => this.flush(), wait);
    }
  }

  private lastFlush = 0;

  private sendOnce(data: number[], text: string) {
    this.send(`once-${nextId++}`, data, text);
  }

  private flushChain: Promise<void> = Promise.resolve();

  private flush() {
    this.flushScheduled = false;
    this.lastFlush = performance.now();
    this.flushChain = this.flushChain.then(() => this.flushNow());
  }

  private async flushNow() {
    const items = [...this.pending.values()];
    this.pending.clear();
    for (const { data, text, quiet } of items) {
      try {
        await this.transport!.send(data);
        if (!quiet) {
          const hex = toHex(data);
          this.lastTx = hex;
          this.addLog("tx", text, hex);
        }
      } catch (e) {
        this.error(`Send failed: ${e}`);
      }
    }
  }

  private addLog(dir: LogDir, text: string, hex?: string) {
    const last = this.log[this.log.length - 1];
    if (last && last.dir === dir && last.text === text) {
      last.count++;
      last.time = new Date();
      last.hex = hex;
      return;
    }
    this.log.push({ id: nextId++, time: new Date(), dir, text, hex, count: 1 });
    if (this.log.length > LOG_LIMIT) this.log.splice(0, this.log.length - LOG_LIMIT);
  }
  info(text: string) {
    this.addLog("info", text);
  }
  error(text: string) {
    this.addLog("error", text);
  }
  clearLog() {
    this.log = [];
  }

  toast(kind: Toast["kind"], text: string, ms = 3200) {
    const id = nextId++;
    this.toasts.push({ id, kind, text });
    setTimeout(() => (this.toasts = this.toasts.filter((t) => t.id !== id)), ms);
  }

  // ───────────── incoming ─────────────

  private handleIncoming(data: number[]) {
    const msg = parseIncoming(data);
    if (!msg) return;
    const quiet = msg.kind === "usage" || msg.kind === "sampleRate";
    if (!quiet) {
      this.lastRx = toHex(data);
    }
    switch (msg.kind) {
      case "config":
        this.cfg = msg.config;
        this.haveConfig = true;
        this.addLog("rx", `config dump (${data.length} bytes)`, this.lastRx);
        this.requestMix();
        break;
      case "configVersionMismatch":
        this.addLog("error", `config dump version ${msg.version} is not supported (expected 3)`);
        this.toast("error", "This tool does not match the ES-9 firmware (needs v1.2.0+).", 6000);
        break;
      case "mix":
        this.cfg.mix = msg.mix;
        this.cfg.vmix = msg.vmix;
        this.cfg.vpan = msg.vpan;
        this.addLog("rx", `mix dump (${data.length} bytes)`, this.lastRx);
        break;
      case "rawMix":
        this.cfg.mix[msg.mix][msg.ch] = msg.value;
        this.addLog("rx", "mix update", this.lastRx);
        break;
      case "usage":
        this.usage = msg.dsp;
        break;
      case "sampleRate":
        this.sampleRate = msg.hz;
        break;
      case "message":
        this.addLog("rx", `message: "${msg.text}"`, this.lastRx);
        if (this.awaitingVersion) {
          this.awaitingVersion = false;
          this.version = msg.text;
        } else {
          this.toast(msg.text.toUpperCase() === "OK" ? "success" : "info", `ES-9: ${msg.text}`);
        }
        break;
      case "unknown":
        this.addLog("rx", `unknown message 0x${msg.command.toString(16)}`, this.lastRx);
    }
  }

  // ───────────── requests ─────────────

  requestVersion() {
    this.awaitingVersion = true;
    this.send("ver", build.reqVersion(), "version request");
    // Don't mistake a later "OK" for the version if the unit never answers.
    setTimeout(() => (this.awaitingVersion = false), 1500);
  }
  requestConfig() {
    this.send("cfg", build.reqConfig(), "config request");
  }
  requestMix() {
    this.send("mixreq", build.reqMix(), "mix request");
  }
  requestUsageSoon() {
    setTimeout(() => this.send("usage", build.reqUsage(), "usage request", true), 100);
  }
  saveToFlash(slot: FlashSlot) {
    this.sendOnce(build.save(slot), `save to flash (${slot === FlashSlot.Hosted ? "hosted" : "standalone"})`);
  }
  restoreFromFlash(slot: FlashSlot) {
    this.sendOnce(build.restore(slot), `load from flash (${slot === FlashSlot.Hosted ? "hosted" : "standalone"})`);
    setTimeout(() => this.requestConfig(), 250);
  }
  resetToDefaults() {
    this.sendOnce(build.reset(), "reset to defaults");
    setTimeout(() => this.requestConfig(), 250);
  }

  // ───────────── routing ─────────────

  setCapture(dsp: number, ch: number, v: number) {
    const cap = this.cfg.capture[dsp];
    cap[ch] = v;
    if (this.isCaptureLinked(v)) {
      cap[ch & 0xe] = v & 0xfe;
      cap[(ch & 0xe) + 1] = (v & 0xfe) + 1;
    }
    this.send(`in${dsp}`, build.inputs(dsp, [...cap]), `inputs DSP ${dsp}`);
    if (dsp >= 2) this.requestMix();
  }

  setOutput(dsp: number, ch: number, v: number) {
    this.cfg.outputs[dsp][ch] = v;
    this.send(`out${dsp}`, build.outputs(dsp, [...this.cfg.outputs[dsp]]), `outputs DSP ${dsp}`);
  }

  setLink(index: number, on: boolean) {
    this.cfg.links[index] = on;
    this.send(`link${index}`, build.link(index, on), `stereo link ${index} ${on ? "on" : "off"}`);
    this.requestMix();
  }

  // ───────────── mixer ─────────────

  setRawMix(m: number, ch: number, v: number) {
    this.cfg.mix[m][ch] = v;
    this.send(`raw${m}_${ch}`, build.rawMix(m, ch, v), "raw mix");
  }
  setVmix(m: number, ch: number, v: number) {
    this.cfg.vmix[m * 8 + ch] = v;
    this.send(`vmix${m}_${ch}`, build.vmix(m, ch, v), "macro mix level");
  }
  setVpan(m: number, ch: number, p: number) {
    this.cfg.vpan[m * 8 + ch] = p;
    this.send(`vpan${m}_${ch}`, build.vpan(m, ch, p), "macro mix pan");
  }
  setSmoothing(m: number, on: boolean) {
    this.cfg.smoothing[m] = on;
    this.send(`sm${m}`, build.smoothing(m, on), `smoothing mix ${m + 1} ${on ? "on" : "off"}`);
    this.requestUsageSoon();
  }

  // ───────────── EQ ─────────────

  setEq(mixer: number, ch: number, band: number, patch: Partial<EqBand>) {
    const b = this.cfg.eq[mixer][ch][band];
    Object.assign(b, patch);
    this.send(`eq${mixer}_${ch}_${band}`, build.filter(mixer, ch, band, { ...b }), "EQ update");
    if ("enabled" in patch) this.requestUsageSoon();
  }

  // ───────────── settings ─────────────

  setHpfBit(bit: number, on: boolean) {
    this.cfg.hpf = on ? this.cfg.hpf | (1 << bit) : this.cfg.hpf & ~(1 << bit);
    this.send("hpf", build.hpf(this.cfg.hpf), "DC blocking");
  }
  private setOptions(opts: number) {
    this.cfg.options = opts;
    this.send("opts", build.options(opts), "options");
    this.requestMix();
  }
  setMixer2(on: boolean) {
    this.setOptions(on ? this.cfg.options | OPT_MIXER2 : this.cfg.options & ~OPT_MIXER2);
  }
  setMidiThru(on: boolean) {
    this.setOptions(on ? this.cfg.options | OPT_MIDI_THRU : this.cfg.options & ~OPT_MIDI_THRU);
  }
  setMidiChannels(usb: number, din: number) {
    this.cfg.midiChUsb = usb;
    this.cfg.midiChDin = din;
    this.send("midich", build.midiChannels(usb, din), "mixer MIDI channels");
  }
  setDcOffset(ch: number, v: number) {
    this.cfg.dcOffset[ch] = v;
    this.send(`dc${ch}`, build.dcOffset(ch, v), "output DC offset");
  }
}

export const es9 = new Es9Store();
export { FlashSlot };
