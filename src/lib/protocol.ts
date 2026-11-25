/**
 * ES-9 SysEx protocol: constants, value conversions, message builders and
 * parsers. Pure functions only, no UI or I/O, so the module is unit-testable.
 *
 * Ported from the official Expert Sleepers web config tool (firmware ≥ 1.2.0,
 * config dump version 3). Byte layouts follow that tool exactly.
 */

// ───────────────────────────── Constants ─────────────────────────────

export const HEADER = [0xf0, 0x00, 0x21, 0x27, 0x19] as const;
export const SYSEX_END = 0xf7;
export const CONFIG_VERSION = 3;

export const NUM_DSP = 4;
export const NUM_CH = 8;
export const NUM_MIX = 16;
export const NUM_FILTERS = 4;

export const RAW_MIX_MAX = 0x7fff;
export const RAW_MIX_UNITY = 0x2000; // 0 dB
export const VMIX_MAX = 127;
export const VMIX_UNITY = 103; // 0 dB on the macro faders
export const PAN_RANGE = 63;
export const DC_OFFSET_RANGE = 3176;
export const EQ_RAW_MAX = 32767;
export const EQ_Q_DEFAULT = 12341; // ≈ 0.707

/** Messages sent by the ES-9. */
export const RX = {
  CONFIG_DUMP: 0x10,
  MIX_DUMP: 0x11,
  USAGE: 0x12,
  SAMPLE_RATE: 0x14,
  MESSAGE: 0x32,
} as const;

/** Commands understood by the ES-9. */
export const TX = {
  REQ_VERSION: 0x22,
  REQ_CONFIG: 0x23,
  REQ_SAVE: 0x24,
  REQ_RESTORE: 0x25,
  REQ_RESET: 0x26,
  REQ_MIX: 0x2a,
  REQ_USAGE: 0x2b,
  REQ_SAMPLE_RATE: 0x2c,
  SET_HPF: 0x31,
  SET_OPTIONS: 0x32,
  SET_LINK: 0x33,
  SET_VMIX: 0x34,
  SET_MIDI_CHANNELS: 0x35,
  SET_DC_OFFSET: 0x36,
  SET_FILTER: 0x39,
  SET_SMOOTHING: 0x3a,
  SET_INPUTS: 0x40, // + dsp
  SET_OUTPUTS: 0x50, // + dsp
  SET_MIX: 0x60, // + mix
} as const;

export const enum FlashSlot {
  Standalone = 0,
  Hosted = 1,
}

export const OPT_MIXER2 = 1 << 0;
export const OPT_MIDI_THRU = 1 << 1;

/**
 * The UI addresses the 14 analogue inputs as 0x70+n (n = 0..13), but the
 * hardware uses this scrambled set of codes.
 */
export const INPUT_CAPTURE_LOOKUP = [
  0x78, 0x79, 0x76, 0x75, 0x74, 0x7b, 0x7a, 0x77, 0x73, 0x72, 0x7d, 0x7c, 0x7e, 0x7f,
] as const;

export const DC_BLOCK_LABELS = [
  "Inputs 1/2",
  "Inputs 3/8",
  "Inputs 4/5",
  "Inputs 6/7",
  "Inputs 9/10",
  "Inputs 11/12",
  "Inputs 13/14",
] as const;

// ─────────────────────── Sources / destinations ───────────────────────

export interface Option {
  value: number;
  label: string;
}
export interface OptionGroup {
  label: string;
  options: Option[];
}

const range = (n: number) => Array.from({ length: n }, (_, i) => i);

/** Sources selectable for a DSP input ("capture") slot. Values are UI codes. */
export const CAPTURE_GROUPS: OptionGroup[] = [
  { label: "Inputs", options: range(14).map((i) => ({ value: 0x70 + i, label: `Input ${i + 1}` })) },
  { label: "Buses", options: range(16).map((i) => ({ value: 0x60 + i, label: `Bus ${i + 1}` })) },
  {
    label: "USB",
    options: [
      ...range(8).map((i) => ({ value: 0x00 + i, label: `USB ${i + 1}` })),
      ...range(8).map((i) => ({ value: 0x10 + i, label: `USB ${i + 9}` })),
    ],
  },
  { label: "Mixer", options: range(8).map((i) => ({ value: 0x20 + i, label: `MIX ${i + 1}` })) },
  {
    label: "S/PDIF",
    options: [
      { value: 48, label: "S/PDIF L" },
      { value: 49, label: "S/PDIF R" },
    ],
  },
];

/** Destinations selectable for a DSP output slot. */
export const OUTPUT_GROUPS: OptionGroup[] = [
  {
    label: "Monitor",
    options: [
      { value: 6, label: "Main Out L" },
      { value: 7, label: "Main Out R" },
      { value: 12, label: "Phones L" },
      { value: 13, label: "Phones R" },
      { value: 14, label: "ES-5 L" },
      { value: 15, label: "ES-5 R" },
    ],
  },
  {
    label: "Outputs",
    options: [
      { value: 8, label: "Output 1" },
      { value: 9, label: "Output 2" },
      { value: 4, label: "Output 3" },
      { value: 5, label: "Output 4" },
      { value: 2, label: "Output 5" },
      { value: 3, label: "Output 6" },
      { value: 11, label: "Output 7" },
      { value: 10, label: "Output 8" },
    ],
  },
  { label: "Buses", options: range(16).map((i) => ({ value: 0x10 + i, label: `Bus ${i + 1}` })) },
];

const captureLabelMap = new Map(CAPTURE_GROUPS.flatMap((g) => g.options).map((o) => [o.value, o.label]));
const outputLabelMap = new Map(OUTPUT_GROUPS.flatMap((g) => g.options).map((o) => [o.value, o.label]));

export const captureLabel = (v: number) => captureLabelMap.get(v) ?? `? ${v}`;
export const outputLabel = (v: number) => outputLabelMap.get(v) ?? `? ${v}`;

/** UI capture code → hardware byte. */
export function captureToWire(v: number): number {
  return v >> 4 === 7 ? INPUT_CAPTURE_LOOKUP[v & 0xf] : v;
}
/** Hardware byte → UI capture code. */
export function captureFromWire(v: number): number {
  if (v >> 4 === 7) {
    const i = (INPUT_CAPTURE_LOOKUP as readonly number[]).indexOf(v);
    return i >= 0 ? 0x70 + i : v;
  }
  return v;
}

// ───────────────────────────── Stereo links ─────────────────────────────

/**
 * Link bits (32 total):
 *   0..6   Inputs 1/2 … 13/14
 *   8..15  Bus 1/2 … 15/16
 *   16..19 USB 1/2 … 7/8
 *   20..23 USB 9/10 … 15/16
 *   24..27 Mix 1/2 … 7/8
 *   28..31 Mix 9/10 … 15/16 (Mixer 2 mode)
 *
 * The fourth DSP block runs either Mixer 2 or the S/PDIF ports, so the same
 * bits are shared: in S/PDIF mode bit 28 is the S/PDIF L/R link (source codes
 * 0x30/0x31 share the 0x3_ nibble with Mixer 2) and bits 29..31 are unused.
 */
export interface LinkDef {
  index: number;
  label: string;
}
export interface LinkGroup {
  label: string;
  links: LinkDef[];
}

/** Link groups as shown in the UI; the last group depends on the DSP 4 mode. */
export function linkGroups(mixer2: boolean): LinkGroup[] {
  return [
    { label: "Inputs", links: range(7).map((p) => ({ index: p, label: `${2 * p + 1}/${2 * p + 2}` })) },
    { label: "Buses", links: range(8).map((p) => ({ index: 8 + p, label: `${2 * p + 1}/${2 * p + 2}` })) },
    {
      label: "USB",
      links: [
        ...range(4).map((p) => ({ index: 16 + p, label: `${2 * p + 1}/${2 * p + 2}` })),
        ...range(4).map((p) => ({ index: 20 + p, label: `${2 * p + 9}/${2 * p + 10}` })),
      ],
    },
    {
      label: "Mixes",
      links: [
        ...range(4).map((p) => ({ index: 24 + p, label: `${2 * p + 1}/${2 * p + 2}` })),
        ...(mixer2 ? range(4).map((p) => ({ index: 28 + p, label: `${2 * p + 9}/${2 * p + 10}` })) : []),
      ],
    },
    ...(mixer2 ? [] : [{ label: "S/PDIF", links: [{ index: 28, label: "L/R" }] }]),
  ];
}

/** Base link bit for each source-code high nibble (0x3_ = S/PDIF or Mixer 2, see above). */
const LINK_BASE: Record<number, number> = { 7: 0, 6: 8, 0: 16, 1: 20, 2: 24, 3: 28 };

/** Link bit governing a capture source code, or -1. */
export function captureLinkIndex(v: number): number {
  const base = LINK_BASE[v >> 4];
  return base === undefined ? -1 : base + ((v & 0xe) >> 1);
}

/** Link bit governing mix output `m` (only meaningful for even m). */
export function mixLinkIndex(m: number): number {
  return m < 8 ? 24 + (m >> 1) : 28 + ((m - 8) >> 1);
}

// ───────────────────────────── Value conversions ─────────────────────────────

export const pack14 = (w: number) => [(w >> 14) & 0x7f, (w >> 7) & 0x7f, w & 0x7f];
/** 16-bit signed value in 3 bytes (top 2 bits, 7, 7). */
export const packS16 = (w: number) => [(w >> 14) & 0x03, (w >> 7) & 0x7f, w & 0x7f];
export const unpack21 = (d: ArrayLike<number>, c: number) => (d[c] << 14) | (d[c + 1] << 7) | d[c + 2];
export const signExtend16 = (v: number) => (v << 16) >> 16;

export function rawMixToDb(v: number): number {
  if (v >= RAW_MIX_MAX) return 12;
  if (v <= 0) return -Infinity;
  return 6 * Math.log2(v / 8192);
}
export function dbToRawMix(db: number): number {
  if (db < -72) return 0;
  return Math.min(Math.round(0x2000 * Math.pow(2, db / 6)), RAW_MIX_MAX);
}
export function vmixToDb(v: number): number {
  if (v <= 0) return -Infinity;
  if (v >= 55) return -24 + 0.5 * (v - 55);
  return -72 + ((v - 1) * (72 - 24)) / (55 - 1);
}
export function dbToVmix(db: number): number {
  if (db < -72) return 0;
  if (db >= -24) return Math.round((db + 24) * 2 + 55);
  return Math.round(((db + 72) * (55 - 1)) / (72 - 24) + 1);
}

export function formatDb(db: number, digits = 1): string {
  if (!isFinite(db) || db <= -72) return "−∞";
  const s = db.toFixed(digits);
  return db > 0 ? `+${s}` : s.replace("-", "−");
}
export function formatRawMix(v: number): string {
  if (v >= RAW_MIX_MAX) return "+12.0";
  return formatDb(rawMixToDb(v));
}
export function formatPan(p: number): string {
  if (p === 0) return "C";
  return p > 0 ? `${p}R` : `${-p}L`;
}

export const EQ_TYPES = [
  { value: 0, label: "Low pass (1st)", short: "LP1", hasQ: false, hasGain: false },
  { value: 1, label: "High pass (1st)", short: "HP1", hasQ: false, hasGain: false },
  { value: 2, label: "Low pass (2nd)", short: "LP2", hasQ: true, hasGain: false },
  { value: 3, label: "High pass (2nd)", short: "HP2", hasQ: true, hasGain: false },
  { value: 4, label: "Low shelf", short: "LS", hasQ: false, hasGain: true },
  { value: 5, label: "High shelf", short: "HS", hasQ: false, hasGain: true },
  { value: 6, label: "Peak", short: "PK", hasQ: true, hasGain: true },
] as const;

export const EQ_FREQ_MIN = 10;
export const EQ_FREQ_MAX = 22000;
export const EQ_Q_MIN = 0.1;
export const EQ_Q_MAX = 18;
export const EQ_GAIN_MAX_DB = 15;
const HIGH_SHELF_GAIN_LIMIT = (32767 * 12) / 15;

export const eqFreqToHz = (v: number) => EQ_FREQ_MIN * Math.exp((Math.log(EQ_FREQ_MAX / EQ_FREQ_MIN) / 32767) * v);
export const eqQToFloat = (v: number) => EQ_Q_MIN * Math.exp((Math.log(EQ_Q_MAX / EQ_Q_MIN) / 32767) * v);
export const hzToEqFreq = (hz: number) =>
  Math.round((Math.log(hz / EQ_FREQ_MIN) * 32767) / Math.log(EQ_FREQ_MAX / EQ_FREQ_MIN));

/** The high shelf is limited to +12 dB by the hardware. */
export function effectiveEqGain(type: number, raw: number): number {
  return type === 5 && raw > HIGH_SHELF_GAIN_LIMIT ? Math.floor(HIGH_SHELF_GAIN_LIMIT) : raw;
}
export const eqGainToDb = (type: number, raw: number) => (effectiveEqGain(type, raw) * EQ_GAIN_MAX_DB) / 32767;

export function formatHz(hz: number): string {
  return hz >= 1000 ? `${(hz / 1000).toFixed(hz >= 10000 ? 1 : 2)} kHz` : `${hz.toFixed(hz < 100 ? 1 : 0)} Hz`;
}

// ───────────────────────────── State model ─────────────────────────────

export interface EqBand {
  enabled: boolean;
  type: number; // 0..6
  freq: number; // 0..32767 (log scale)
  q: number; // 0..32767 (log scale)
  gain: number; // -32767..32767
}

export interface Es9Config {
  hpf: number; // 7 bits
  /** capture[dsp][ch]: UI source codes */
  capture: number[][];
  /** outputs[dsp][ch]: destination codes */
  outputs: number[][];
  /** mix[m][ch]: raw gain 0..32767 */
  mix: number[][];
  /** vmix[m*8+ch]: macro fader 0..127 */
  vmix: number[];
  /** vpan[m*8+ch]: -63..63 */
  vpan: number[];
  options: number;
  links: boolean[]; // 32
  midiChUsb: number;
  midiChDin: number;
  dcOffset: number[]; // 8
  /** eq[mixer][ch][band] */
  eq: EqBand[][][];
  smoothing: boolean[]; // 16
}

export function defaultBand(): EqBand {
  return { enabled: false, type: 6, freq: hzToEqFreq(1000), q: EQ_Q_DEFAULT, gain: 0 };
}

export function defaultConfig(): Es9Config {
  return {
    hpf: 0,
    capture: range(NUM_DSP).map(() => range(NUM_CH).map(() => 0x70)),
    outputs: range(NUM_DSP).map(() => range(NUM_CH).map(() => 6)),
    mix: range(NUM_MIX).map(() => range(NUM_CH).map(() => 0)),
    vmix: range(128).map(() => 0),
    vpan: range(128).map(() => 0),
    options: 0,
    links: range(32).map(() => false),
    midiChUsb: 1,
    midiChDin: 1,
    dcOffset: range(8).map(() => 0),
    eq: range(2).map(() => range(NUM_CH).map(() => range(NUM_FILTERS).map(defaultBand))),
    smoothing: range(16).map(() => false),
  };
}

// ───────────────────────────── Message builders ─────────────────────────────

const msg = (...body: number[]) => [...HEADER, ...body, SYSEX_END];

export const build = {
  reqVersion: () => msg(TX.REQ_VERSION),
  reqConfig: () => msg(TX.REQ_CONFIG),
  reqMix: () => msg(TX.REQ_MIX),
  reqUsage: () => msg(TX.REQ_USAGE),
  reqSampleRate: () => msg(TX.REQ_SAMPLE_RATE),
  save: (slot: FlashSlot) => msg(TX.REQ_SAVE, slot),
  restore: (slot: FlashSlot) => msg(TX.REQ_RESTORE, slot),
  reset: () => msg(TX.REQ_RESET),
  hpf: (bits: number) => msg(TX.SET_HPF, bits & 0x7f),
  options: (opts: number) => msg(TX.SET_OPTIONS, opts & 0x7f),
  link: (index: number, on: boolean) => msg(TX.SET_LINK, index, on ? 1 : 0),
  smoothing: (mix: number, on: boolean) => msg(TX.SET_SMOOTHING, mix, on ? 1 : 0),
  midiChannels: (usb: number, din: number) => msg(TX.SET_MIDI_CHANNELS, usb & 0x7f, din & 0x7f),
  inputs: (dsp: number, sources: number[]) => msg(TX.SET_INPUTS + dsp, ...sources.map(captureToWire)),
  outputs: (dsp: number, dests: number[]) => msg(TX.SET_OUTPUTS + dsp, ...dests.map((d) => d & 0x7f)),
  rawMix: (mix: number, ch: number, value: number) => msg(TX.SET_MIX + mix, ch, ...pack14(value)),
  vmix: (mix: number, ch: number, value: number) => msg(TX.SET_VMIX, mix * 8 + ch, value & 0x7f),
  /**
   * Pan is addressed at (mix+1)*8+ch with a +64 offset, while the mix dump
   * reports it at mix*8+ch with a -63 offset. The asymmetry is copied verbatim
   * from the official tool (known to work); do not "fix" it without hardware.
   */
  vpan: (mix: number, ch: number, pan: number) => msg(TX.SET_VMIX, ((mix + 1) * 8 + ch) & 0x7f, (64 + pan) & 0x7f),
  dcOffset: (ch: number, value: number) => msg(TX.SET_DC_OFFSET, ch, ...packS16(value)),
  filter: (mixer: number, ch: number, band: number, b: EqBand) =>
    msg(
      TX.SET_FILTER,
      8 * mixer + ch,
      band,
      (b.type << 1) | (b.enabled ? 1 : 0),
      ...packS16(b.freq),
      ...packS16(b.q),
      ...packS16(effectiveEqGain(b.type, b.gain)),
    ),
};

// ───────────────────────────── Parsers ─────────────────────────────

export type Incoming =
  | { kind: "config"; config: Es9Config }
  | { kind: "configVersionMismatch"; version: number }
  | { kind: "mix"; mix: number[][]; vmix: number[]; vpan: number[] }
  | { kind: "usage"; dsp: (number | null)[] }
  | { kind: "sampleRate"; hz: number }
  | { kind: "message"; text: string }
  | { kind: "rawMix"; mix: number; ch: number; value: number }
  | { kind: "unknown"; command: number };

export function isEs9Sysex(data: ArrayLike<number>): boolean {
  if (data.length < 7) return false;
  for (let i = 0; i < HEADER.length; i++) if (data[i] !== HEADER[i]) return false;
  return true;
}

function parseMixMatrix(d: ArrayLike<number>, c: number): [number[][], number] {
  const mix: number[][] = [];
  for (let m = 0; m < NUM_MIX; m++) {
    const row: number[] = [];
    for (let ch = 0; ch < NUM_CH; ch++) {
      row.push(unpack21(d, c));
      c += 3;
    }
    mix.push(row);
  }
  return [mix, c];
}

/** Parses the payload of a config dump (after the 8-byte prefix). */
export function parseConfigPayload(d: ArrayLike<number>): Incoming {
  const version = d[0];
  if (version !== CONFIG_VERSION) return { kind: "configVersionMismatch", version };
  const cfg = defaultConfig();
  cfg.hpf = d[1];
  for (let dsp = 0; dsp < NUM_DSP; dsp++)
    for (let ch = 0; ch < NUM_CH; ch++) {
      cfg.capture[dsp][ch] = captureFromWire(d[2 + dsp * 8 + ch]);
      cfg.outputs[dsp][ch] = d[2 + 32 + dsp * 8 + ch];
    }
  let c = 2 + 32 + 32;
  [cfg.mix, c] = parseMixMatrix(d, c);
  cfg.options = d[c++];

  let links0 = 0;
  let links1 = 0;
  for (let i = 0; i < 4; i++) links0 = (links0 << 4) | d[c++];
  for (let i = 0; i < 4; i++) links1 = (links1 << 4) | d[c++];
  for (let i = 0; i < 16; i++) {
    cfg.links[i] = ((links0 >> i) & 1) === 1;
    cfg.links[16 + i] = ((links1 >> i) & 1) === 1;
  }

  cfg.midiChUsb = d[c++];
  cfg.midiChDin = d[c++];

  for (let i = 0; i < 8; i++) {
    cfg.dcOffset[i] = signExtend16(unpack21(d, c));
    c += 3;
  }
  for (let m = 0; m < 2; m++)
    for (let ch = 0; ch < NUM_CH; ch++)
      for (let f = 0; f < NUM_FILTERS; f++) {
        const type = d[c++];
        const freq = unpack21(d, c);
        const q = unpack21(d, c + 3);
        const gain = signExtend16(unpack21(d, c + 6));
        c += 9;
        cfg.eq[m][ch][f] = { enabled: (type & 1) === 1, type: type >> 1, freq, q, gain };
      }
  const smoothing = unpack21(d, c);
  for (let i = 0; i < 16; i++) cfg.smoothing[i] = ((smoothing >> i) & 1) === 1;
  return { kind: "config", config: cfg };
}

/** Parses any SysEx received from the ES-9. Returns null for foreign SysEx. */
export function parseIncoming(data: ArrayLike<number>): Incoming | null {
  if (!isEs9Sysex(data)) return null;
  const arr = Array.from(data);
  const cmd = arr[5];
  const body = arr.slice(6, -1);

  switch (cmd) {
    case RX.MESSAGE: {
      const end = body.indexOf(0);
      const bytes = end >= 0 ? body.slice(0, end) : body;
      return { kind: "message", text: String.fromCharCode(...bytes).trim() };
    }
    case RX.CONFIG_DUMP:
      return parseConfigPayload(arr.slice(8, -1));
    case RX.MIX_DUMP: {
      const [mix, c0] = parseMixMatrix(body, 0);
      const vmix: number[] = [];
      const vpan: number[] = [];
      let c = c0;
      for (let i = 0; i < 128; i++) {
        vmix.push(body[c++] ?? 0);
        vpan.push((body[c++] ?? 63) - 63);
      }
      return { kind: "mix", mix, vmix, vpan };
    }
    case RX.USAGE: {
      const u = [0, 2, 4, 6].map((i) => (body[i] << 7) | body[i + 1]);
      const pct = (a: number, b: number) => ((b - a) * 100) / (4096 - a);
      return { kind: "usage", dsp: [pct(u[0], u[1]), u[2] !== 0 ? pct(u[2], u[3]) : null] };
    }
    case RX.SAMPLE_RATE:
      return { kind: "sampleRate", hz: unpack21(body, 0) * 4 };
  }
  if ((cmd & 0xf0) === TX.SET_MIX) {
    return { kind: "rawMix", mix: cmd & 0xf, ch: arr[6], value: unpack21(arr, 7) };
  }
  return { kind: "unknown", command: cmd };
}

// ───────────────────────────── Encoders (for tests / simulation) ─────────────────────────────

/** Serialises a config into a full `0x10` dump message (inverse of the parser). */
export function encodeConfigDump(cfg: Es9Config): number[] {
  const d: number[] = [CONFIG_VERSION, cfg.hpf & 0x7f];
  for (let dsp = 0; dsp < NUM_DSP; dsp++) for (const v of cfg.capture[dsp]) d.push(captureToWire(v));
  for (let dsp = 0; dsp < NUM_DSP; dsp++) for (const v of cfg.outputs[dsp]) d.push(v);
  for (const row of cfg.mix) for (const v of row) d.push(...pack14(v));
  d.push(cfg.options);
  let l0 = 0;
  let l1 = 0;
  for (let i = 0; i < 16; i++) {
    if (cfg.links[i]) l0 |= 1 << i;
    if (cfg.links[16 + i]) l1 |= 1 << i;
  }
  for (let i = 3; i >= 0; i--) d.push((l0 >> (4 * i)) & 0xf);
  for (let i = 3; i >= 0; i--) d.push((l1 >> (4 * i)) & 0xf);
  d.push(cfg.midiChUsb, cfg.midiChDin);
  for (const v of cfg.dcOffset) d.push(...packS16(v));
  for (const mixer of cfg.eq)
    for (const ch of mixer)
      for (const b of ch) d.push((b.type << 1) | (b.enabled ? 1 : 0), ...packS16(b.freq), ...packS16(b.q), ...packS16(b.gain));
  let sm = 0;
  cfg.smoothing.forEach((on, i) => on && (sm |= 1 << i));
  d.push(...pack14(sm));
  return [...HEADER, RX.CONFIG_DUMP, 0, 0, ...d, SYSEX_END];
}

export function encodeMixDump(mix: number[][], vmix: number[], vpan: number[]): number[] {
  const d: number[] = [];
  for (const row of mix) for (const v of row) d.push(...pack14(v));
  for (let i = 0; i < 128; i++) d.push(vmix[i] & 0x7f, (vpan[i] + 63) & 0x7f);
  return [...HEADER, RX.MIX_DUMP, ...d, SYSEX_END];
}

export function toHex(data: ArrayLike<number>): string {
  return Array.from(data, (b) => b.toString(16).toUpperCase().padStart(2, "0")).join(" ");
}
