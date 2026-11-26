/**
 * Application state + actions. Every user action updates local state
 * optimistically and sends the matching SysEx to the ES-9; incoming SysEx
 * replaces local state with the device's truth.
 */
import { confirmAction, openBytes, presets, saveBytes, type PresetInfo } from "./files";
import { createTransport, type MidiTransport, type PortList } from "./midi";
import {
  build,
  captureLabel,
  captureLinkIndex,
  checkConfigFile,
  configUploadChunks,
  diffMessages,
  defaultConfig,
  FlashSlot,
  mixLinkIndex,
  OPT_MIDI_THRU,
  OPT_MIXER2,
  outputLabel,
  parseIncoming,
  RX,
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
const UNDO_LIMIT = 200;
/** Edits of the same control closer together than this are one undo step (e.g. a fader drag). */
const UNDO_MERGE_MS = 800;
/** Minimum gap between automatic re-syncs when the window regains focus. */
const AUTO_SYNC_MS = 2000;
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

  /** True once the unit's state differs from what was last saved to / loaded from flash in this session. */
  unsaved = $state(false);
  presetList = $state<PresetInfo[]>([]);
  canUndo = $state(false);
  canRedo = $state(false);
  private undoStack: Es9Config[] = [];
  private redoStack: Es9Config[] = [];
  private lastEdit = { key: "", t: 0 };
  private pendingSave = false;
  /**
   * Edit counter, and its value when the last config / mix dump was requested.
   * A dump requested before a later edit describes the state before that edit:
   * applying it would undo the edit on screen, so it is re-requested instead.
   */
  private editSeq = 0;
  private configReqSeq = 0;
  private mixReqSeq = 0;
  private lastAutoSync = 0;

  private transport: MidiTransport | null = null;
  private pending = new Map<string, { data: number[]; text: string; quiet: boolean }>();
  private flushScheduled = false;
  private awaitingVersion = false;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  /** Callbacks waiting for the next config dump (raw bytes). */
  private dumpWaiters: ((raw: number[]) => void)[] = [];

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
    void this.refreshPresets();
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
      this.clearHistory();
      this.unsaved = false;
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
        if (this.configReqSeq !== this.editSeq) {
          this.addLog("rx", "config dump (outdated by a newer edit: reading again)", this.lastRx);
          this.requestConfig();
          break;
        }
        this.cfg = msg.config;
        this.haveConfig = true;
        for (const w of this.dumpWaiters.splice(0)) w(data);
        this.addLog("rx", `config dump (${data.length} bytes)`, this.lastRx);
        this.requestMix();
        break;
      case "configVersionMismatch":
        this.addLog("error", `config dump version ${msg.version} is not supported (expected 3)`);
        this.toast("error", "This tool does not match the ES-9 firmware (needs v1.2.0+).", 6000);
        break;
      case "mix":
        if (this.mixReqSeq !== this.editSeq) {
          this.addLog("rx", "mix dump (outdated by a newer edit: reading again)", this.lastRx);
          this.requestMix();
          break;
        }
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
          if (this.pendingSave && msg.text.toUpperCase() === "OK") this.unsaved = false;
          this.pendingSave = false;
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
    this.configReqSeq = this.editSeq;
    this.send("cfg", build.reqConfig(), "config request");
  }
  requestMix() {
    this.mixReqSeq = this.editSeq;
    this.send("mixreq", build.reqMix(), "mix request");
  }
  requestUsageSoon() {
    setTimeout(() => this.send("usage", build.reqUsage(), "usage request", true), 100);
  }
  /** Re-reads the config when the window regains focus: the unit never reports changes made elsewhere. */
  autoSync() {
    if (!this.connected || performance.now() - this.lastAutoSync < AUTO_SYNC_MS) return;
    this.lastAutoSync = performance.now();
    this.requestConfig();
  }
  saveToFlash(slot: FlashSlot) {
    this.pendingSave = true;
    this.sendOnce(build.save(slot), `save to flash (${slot === FlashSlot.Hosted ? "hosted" : "standalone"})`);
  }
  restoreFromFlash(slot: FlashSlot) {
    this.record("bulk");
    this.unsaved = false;
    this.sendOnce(build.restore(slot), `load from flash (${slot === FlashSlot.Hosted ? "hosted" : "standalone"})`);
    setTimeout(() => this.requestConfig(), 250);
  }
  // ───────────── config files (.syx) ─────────────

  /** Requests a fresh config dump and resolves with its raw bytes. */
  private fetchConfigDump(timeoutMs = 3000): Promise<number[]> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.dumpWaiters = this.dumpWaiters.filter((w) => w !== waiter);
        reject(new Error("the ES-9 did not answer"));
      }, timeoutMs);
      const waiter = (raw: number[]) => {
        clearTimeout(timer);
        resolve(raw);
      };
      this.dumpWaiters.push(waiter);
      this.requestConfig();
    });
  }

  /** Saves the unit's current configuration to a .syx file (raw 0x08 dump, like the official tool). */
  async exportConfigFile() {
    if (!this.connected) return;
    try {
      const raw = await this.fetchConfigDump();
      if (raw[5] !== RX.CONFIG_DUMP) throw new Error("saving to a file needs ES-9 firmware 1.3 or later");
      const name = await saveBytes(`es9-config-${new Date().toISOString().slice(0, 10)}.syx`, raw);
      if (!name) return;
      this.info(`Config saved to ${name}`);
      this.toast("success", `Config saved to ${name}`);
    } catch (e) {
      this.error(`Save config failed: ${e instanceof Error ? e.message : e}`);
      this.toast("error", `Save config failed: ${e instanceof Error ? e.message : e}`);
    }
  }

  /** Loads a .syx config file into the unit (not into flash). */
  async importConfigFile() {
    if (!this.connected) return;
    try {
      const file = await openBytes();
      if (!file) return;
      const check = checkConfigFile(file.bytes);
      if (!check.ok) throw new Error(`${file.name}: ${check.error}`);
      const ok = await confirmAction(
        "Load config file",
        `Send "${file.name}" to the ES-9? It replaces the current settings. Flash memory is not changed until you save to flash.`,
        "Load",
      );
      if (!ok) return;
      this.record("bulk");
      for (const chunk of configUploadChunks(file.bytes)) this.sendOnce(chunk, `config upload: ${file.name}`);
      setTimeout(() => this.requestConfig(), 400);
      this.toast("success", `Loaded ${file.name}`);
    } catch (e) {
      this.error(`Load config failed: ${e instanceof Error ? e.message : e}`);
      this.toast("error", `Load config failed: ${e instanceof Error ? e.message : e}`);
    }
  }

  // ───────────── presets ─────────────

  async refreshPresets() {
    try {
      this.presetList = await presets.list();
    } catch (e) {
      this.error(`Cannot list presets: ${e}`);
    }
  }

  /** Stores the unit's current configuration as a named preset. */
  async savePreset(name: string) {
    name = name.trim();
    if (!this.connected || !name) return false;
    try {
      if (this.presetList.some((p) => p.name === name)) {
        const ok = await confirmAction("Overwrite preset", `Replace the preset "${name}" with the current configuration?`, "Replace");
        if (!ok) return false;
      }
      const raw = await this.fetchConfigDump();
      if (raw[5] !== RX.CONFIG_DUMP) throw new Error("presets need ES-9 firmware 1.3 or later");
      await presets.write(name, raw);
      await this.refreshPresets();
      this.info(`Preset "${name}" saved`);
      this.toast("success", `Preset "${name}" saved`);
      return true;
    } catch (e) {
      this.error(`Save preset failed: ${e instanceof Error ? e.message : e}`);
      this.toast("error", `Save preset failed: ${e instanceof Error ? e.message : e}`);
      return false;
    }
  }

  /** Sends a preset to the unit (undoable; flash is not changed). */
  async loadPreset(name: string) {
    if (!this.connected) return;
    try {
      const bytes = await presets.read(name);
      const check = checkConfigFile(bytes);
      if (!check.ok) throw new Error(check.error);
      this.record("bulk");
      for (const chunk of configUploadChunks(bytes)) this.sendOnce(chunk, `load preset: ${name}`);
      setTimeout(() => this.requestConfig(), 400);
      this.toast("success", `Preset "${name}" loaded`);
    } catch (e) {
      this.error(`Load preset failed: ${e instanceof Error ? e.message : e}`);
      this.toast("error", `Load preset failed: ${e instanceof Error ? e.message : e}`);
    }
  }

  async deletePreset(name: string) {
    try {
      const ok = await confirmAction("Delete preset", `Delete the preset "${name}"? This cannot be undone.`, "Delete");
      if (!ok) return;
      await presets.remove(name);
      await this.refreshPresets();
      this.toast("info", `Preset "${name}" deleted`);
    } catch (e) {
      this.error(`Delete preset failed: ${e instanceof Error ? e.message : e}`);
      this.toast("error", `Delete preset failed: ${e instanceof Error ? e.message : e}`);
    }
  }

  revealPresets() {
    presets.reveal().catch((e) => this.toast("error", `Cannot open the presets folder: ${e}`));
  }

  resetToDefaults(kind: FlashSlot) {
    this.record("bulk");
    this.sendOnce(build.reset(kind), `reset to ${kind === FlashSlot.Hosted ? "hosted" : "standalone"} defaults`);
    setTimeout(() => this.requestConfig(), 250);
  }

  // ───────────── undo / redo ─────────────

  /**
   * Call before every edit. Saves the current state as an undo step, unless the
   * same control was edited a moment ago (one drag = one step). "bulk" edits
   * (reset, load, upload) always make their own step.
   */
  private record(key: string) {
    const now = performance.now();
    this.editSeq++;
    this.unsaved = true;
    const merge = key !== "bulk" && key === this.lastEdit.key && now - this.lastEdit.t < UNDO_MERGE_MS;
    this.lastEdit = { key, t: now };
    if (merge) return;
    this.undoStack.push($state.snapshot(this.cfg));
    if (this.undoStack.length > UNDO_LIMIT) this.undoStack.shift();
    this.redoStack = [];
    this.syncHistoryFlags();
  }
  private clearHistory() {
    this.undoStack = [];
    this.redoStack = [];
    this.lastEdit = { key: "", t: 0 };
    this.syncHistoryFlags();
  }
  private syncHistoryFlags() {
    this.canUndo = this.undoStack.length > 0;
    this.canRedo = this.redoStack.length > 0;
  }
  undo() {
    this.stepHistory(this.undoStack, this.redoStack, "undo");
  }
  redo() {
    this.stepHistory(this.redoStack, this.undoStack, "redo");
  }
  private stepHistory(from: Es9Config[], to: Es9Config[], what: string) {
    const target = from.pop();
    if (!target || !this.connected) return;
    to.push($state.snapshot(this.cfg));
    this.editSeq++;
    this.lastEdit = { key: "", t: 0 };
    this.syncHistoryFlags();
    const msgs = diffMessages($state.snapshot(this.cfg), target);
    for (const m of msgs) this.send(m.key, m.data, `${what}: ${m.text}`);
    this.cfg = target;
    this.unsaved = true;
    // The unit derives the raw matrix from the macro faders: read back the truth.
    this.requestMix();
    this.requestUsageSoon();
  }

  // ───────────── routing ─────────────

  setCapture(dsp: number, ch: number, v: number) {
    this.record(`in${dsp}_${ch}`);
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
    this.record(`out${dsp}_${ch}`);
    this.cfg.outputs[dsp][ch] = v;
    this.send(`out${dsp}`, build.outputs(dsp, [...this.cfg.outputs[dsp]]), `outputs DSP ${dsp}`);
  }

  setLink(index: number, on: boolean) {
    this.record(`link${index}`);
    this.cfg.links[index] = on;
    this.send(`link${index}`, build.link(index, on), `stereo link ${index} ${on ? "on" : "off"}`);
    this.requestMix();
  }

  // ───────────── mixer ─────────────

  setRawMix(m: number, ch: number, v: number) {
    this.record(`raw${m}_${ch}`);
    this.cfg.mix[m][ch] = v;
    this.send(`raw${m}_${ch}`, build.rawMix(m, ch, v), "raw mix");
  }
  setVmix(m: number, ch: number, v: number) {
    this.record(`vmix${m}_${ch}`);
    this.cfg.vmix[m * 8 + ch] = v;
    this.send(`vmix${m}_${ch}`, build.vmix(m, ch, v), "macro mix level");
  }
  setVpan(m: number, ch: number, p: number) {
    this.record(`vpan${m}_${ch}`);
    this.cfg.vpan[m * 8 + ch] = p;
    this.send(`vpan${m}_${ch}`, build.vpan(m, ch, p), "macro mix pan");
  }
  setSmoothing(m: number, on: boolean) {
    this.record(`sm${m}`);
    this.cfg.smoothing[m] = on;
    this.send(`sm${m}`, build.smoothing(m, on), `smoothing mix ${m + 1} ${on ? "on" : "off"}`);
    this.requestUsageSoon();
  }

  // ───────────── EQ ─────────────

  setEq(mixer: number, ch: number, band: number, patch: Partial<EqBand>) {
    this.record(`eq${mixer}_${ch}_${band}`);
    const b = this.cfg.eq[mixer][ch][band];
    Object.assign(b, patch);
    this.send(`eq${mixer}_${ch}_${band}`, build.filter(mixer, ch, band, { ...b }), "EQ update");
    if ("enabled" in patch) this.requestUsageSoon();
  }

  // ───────────── settings ─────────────

  setHpfBit(bit: number, on: boolean) {
    this.record(`hpf${bit}`);
    this.cfg.hpf = on ? this.cfg.hpf | (1 << bit) : this.cfg.hpf & ~(1 << bit);
    this.send("hpf", build.hpf(this.cfg.hpf), "DC blocking");
  }
  private setOptions(opts: number) {
    this.record("opts");
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
    this.record("midich");
    this.cfg.midiChUsb = usb;
    this.cfg.midiChDin = din;
    this.send("midich", build.midiChannels(usb, din), "mixer MIDI channels");
  }
  setDcOffset(ch: number, v: number) {
    this.record(`dc${ch}`);
    this.cfg.dcOffset[ch] = v;
    this.send(`dc${ch}`, build.dcOffset(ch, v), "output DC offset");
  }
}

export const es9 = new Es9Store();
export { FlashSlot };

// Dev builds only: expose the store for debugging and UI tests from the console.
if (import.meta.env.DEV) (window as unknown as { es9: Es9Store }).es9 = es9;
