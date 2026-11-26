import { describe, expect, it } from "vitest";
import {
  applySetMessage,
  build,
  captureFromWire,
  checkConfigFile,
  CONFIG_DUMP_BYTES,
  configUploadChunks,
  captureLinkIndex,
  captureToWire,
  dbToVmix,
  defaultConfig,
  diffMessages,
  encodeConfigDump,
  encodeConfigDumpV12,
  encodeMixDump,
  eqFreqToHz,
  FlashSlot,
  mixLinkIndex,
  parseIncoming,
  rawMixToDb,
  vmixToDb,
} from "./protocol";
import realDumpHex from "./fixtures/es9-config-dump-fw13.hex?raw";
import realMixHex from "./fixtures/es9-mix-dump-fw13.hex?raw";

describe("message builders (byte-exact vs original tool)", () => {
  it("requests", () => {
    expect(build.reqConfig()).toEqual([0xf0, 0x00, 0x21, 0x27, 0x19, 0x23, 0xf7]);
    expect(build.reqVersion()).toEqual([0xf0, 0x00, 0x21, 0x27, 0x19, 0x22, 0xf7]);
    expect(build.save(FlashSlot.Hosted)).toEqual([0xf0, 0x00, 0x21, 0x27, 0x19, 0x24, 1, 0xf7]);
    expect(build.restore(FlashSlot.Standalone)).toEqual([0xf0, 0x00, 0x21, 0x27, 0x19, 0x25, 0, 0xf7]);
    expect(build.reset(FlashSlot.Hosted)).toEqual([0xf0, 0x00, 0x21, 0x27, 0x19, 0x26, 1, 0xf7]);
    expect(build.reset(FlashSlot.Standalone)).toEqual([0xf0, 0x00, 0x21, 0x27, 0x19, 0x26, 0, 0xf7]);
  });

  it("raw mix packs 15-bit value", () => {
    expect(build.rawMix(3, 5, 0x7fff)).toEqual([0xf0, 0, 0x21, 0x27, 0x19, 0x63, 5, 1, 0x7f, 0x7f, 0xf7]);
    expect(build.rawMix(0, 0, 8192)).toEqual([0xf0, 0, 0x21, 0x27, 0x19, 0x60, 0, 0, 0x40, 0, 0xf7]);
  });

  it("signed DC offset packs like the original ((w>>14)&3, (w>>7)&127, w&127)", () => {
    const w = -100;
    expect(build.dcOffset(2, w)).toEqual([0xf0, 0, 0x21, 0x27, 0x19, 0x36, 2, (w >> 14) & 3, (w >> 7) & 0x7f, w & 0x7f, 0xf7]);
  });

  it("vmix / vpan addressing", () => {
    expect(build.vmix(2, 3, 103)).toEqual([0xf0, 0, 0x21, 0x27, 0x19, 0x34, 19, 103, 0xf7]);
    expect(build.vpan(2, 3, -10)).toEqual([0xf0, 0, 0x21, 0x27, 0x19, 0x34, 27, 54, 0xf7]);
  });

  it("inputs are translated to hardware codes", () => {
    const msg = build.inputs(1, [0x70, 0x71, 0x7d, 0x60, 0x05, 0x20, 48, 49]);
    expect(msg.slice(6, -1)).toEqual([0x78, 0x79, 0x7f, 0x60, 0x05, 0x20, 48, 49]);
    expect(msg[5]).toBe(0x41);
  });

  it("filter message", () => {
    const b = { enabled: true, type: 5, freq: 20000, q: 12341, gain: 32767 };
    const m = build.filter(1, 2, 3, b);
    expect(m.slice(5, 9)).toEqual([0x39, 10, 3, 11]);
    // high shelf gain is clamped to 12 dB
    const g = Math.floor((32767 * 12) / 15);
    expect(m.slice(15, 18)).toEqual([(g >> 14) & 3, (g >> 7) & 0x7f, g & 0x7f]);
  });
});

describe("capture codes", () => {
  it("round-trips every analogue input", () => {
    for (let i = 0; i < 14; i++) expect(captureFromWire(captureToWire(0x70 + i))).toBe(0x70 + i);
  });
  it("link indices", () => {
    expect(captureLinkIndex(0x70)).toBe(0);
    expect(captureLinkIndex(0x7d)).toBe(6);
    expect(captureLinkIndex(0x63)).toBe(9);
    expect(captureLinkIndex(0x07)).toBe(19);
    expect(captureLinkIndex(0x18)).toBe(20 + 4); // USB 9.. → (0x18&0xe)>>1 = 4
    expect(captureLinkIndex(0x25)).toBe(26);
    expect(mixLinkIndex(0)).toBe(24);
    expect(mixLinkIndex(6)).toBe(27);
    expect(mixLinkIndex(10)).toBe(29);
  });
});

describe("conversions", () => {
  it("dB scales", () => {
    expect(rawMixToDb(8192)).toBe(0);
    expect(rawMixToDb(0x7fff)).toBe(12);
    expect(vmixToDb(103)).toBe(0);
    expect(dbToVmix(0)).toBe(103);
    expect(vmixToDb(0)).toBe(-Infinity);
    expect(eqFreqToHz(0)).toBeCloseTo(10);
    expect(eqFreqToHz(32767)).toBeCloseTo(22000);
  });
});

describe("parsing", () => {
  it("config dump round-trip", () => {
    const cfg = defaultConfig();
    cfg.hpf = 0b1010101;
    cfg.capture[0] = [0x70, 0x71, 0x72, 0x7d, 0x60, 0x0f, 0x27, 49];
    cfg.outputs[2] = [6, 7, 12, 13, 8, 9, 0x10, 0x1f];
    cfg.mix[5][3] = 12345;
    cfg.mix[15][7] = 0x7fff;
    cfg.options = 3;
    cfg.links[0] = cfg.links[6] = cfg.links[9] = cfg.links[15] = cfg.links[16] = cfg.links[31] = true;
    cfg.midiChUsb = 5;
    cfg.midiChDin = 16;
    cfg.dcOffset = [0, -3176, 3176, -1, 1, 100, -100, 42];
    cfg.eq[1][7][3] = { enabled: true, type: 6, freq: 30000, q: 100, gain: -20000 };
    cfg.eq[0][0][0] = { enabled: false, type: 1, freq: 1, q: 32767, gain: 32767 };
    cfg.smoothing[0] = cfg.smoothing[15] = cfg.smoothing[7] = true;

    // Firmware 1.3+ word dump (0x08) carries vmix/vpan too.
    cfg.vmix[0] = 103;
    cfg.vmix[127] = 127;
    cfg.vpan[3] = -63;
    cfg.vpan[100] = 63;
    const dump = encodeConfigDump(cfg);
    expect(dump[5]).toBe(0x08);
    expect(dump.length).toBe(2313);
    const parsed = parseIncoming(dump);
    expect(parsed?.kind).toBe("config");
    if (parsed?.kind === "config") expect(parsed.config).toEqual(cfg);

    // Firmware 1.2 byte dump (0x10) has no vmix/vpan.
    const v12 = { ...cfg, vmix: defaultConfig().vmix, vpan: defaultConfig().vpan };
    const parsed12 = parseIncoming(encodeConfigDumpV12(v12));
    expect(parsed12?.kind).toBe("config");
    if (parsed12?.kind === "config") expect(parsed12.config).toEqual(v12);
  });

  it("real ES-9 config dump (firmware 1.3, command 0x08)", () => {
    const bytes = realDumpHex.trim().split(/\s+/).map((b) => parseInt(b, 16));
    expect(bytes.length).toBe(2313);
    const parsed = parseIncoming(bytes);
    expect(parsed?.kind).toBe("config");
    if (parsed?.kind !== "config") return;
    const c = parsed.config;
    expect(c.hpf).toBe(0x1f);
    // DSP 0: analogue inputs 1-8 in order (hardware codes are scrambled on the wire).
    expect(c.capture[0]).toEqual([0x70, 0x71, 0x72, 0x73, 0x74, 0x75, 0x76, 0x77]);
    expect(c.capture[1]).toEqual([0x78, 0x79, 0x7a, 0x7b, 0x7c, 0x7d, 48, 49]);
    expect(c.capture[2]).toEqual([0, 1, 2, 3, 4, 5, 0x16, 0x17]);
    expect(c.outputs[2]).toEqual([6, 7, 12, 13, 8, 9, 12, 13]);
    expect(c.mix[0][0]).toBe(0x2000);
    expect(c.mix[2][0]).toBe(0x1fbe);
    expect(c.vmix[0]).toBe(103);
    expect(c.vpan[0]).toBe(0);
    expect(c.options).toBe(0);
    // USB 1/2, 3/4 and Mix 1/2, 3/4 linked.
    expect(c.links.flatMap((on, i) => (on ? [i] : []))).toEqual([16, 17, 24, 25]);
    expect(c.eq[0][0][2]).toEqual({ enabled: false, type: 6, freq: 23908, q: 12341, gain: -14770 });
    expect(c.eq[0][0][3]).toEqual({ enabled: false, type: 6, freq: 12116, q: 12341, gain: 22300 });
  });

  it("rejects other config versions", () => {
    const dump = encodeConfigDump(defaultConfig());
    dump[10] = 2; // low byte of the first 3-byte word
    expect(parseIncoming(dump)).toEqual({ kind: "configVersionMismatch", version: 2 });
    const v12 = encodeConfigDumpV12(defaultConfig());
    v12[8] = 2;
    expect(parseIncoming(v12)).toEqual({ kind: "configVersionMismatch", version: 2 });
  });

  it("mix dump", () => {
    const cfg = defaultConfig();
    cfg.mix[1][2] = 999;
    cfg.vmix[10] = 77;
    cfg.vpan[10] = -20;
    const parsed = parseIncoming(encodeMixDump(cfg.mix, cfg.vmix, cfg.vpan));
    expect(parsed).toEqual({ kind: "mix", mix: cfg.mix, vmix: cfg.vmix, vpan: cfg.vpan });
  });

  it("messages, sample rate, usage, raw mix echo", () => {
    const text = [..."v1.2.3"].map((c) => c.charCodeAt(0));
    expect(parseIncoming([0xf0, 0, 0x21, 0x27, 0x19, 0x32, ...text, 0, 0xf7])).toEqual({ kind: "message", text: "v1.2.3" });
    // 48000 / 4 = 12000 = 0b10_1110111_0000000 → [0, 93, 96]
    expect(parseIncoming([0xf0, 0, 0x21, 0x27, 0x19, 0x14, 0, 93, 96, 0xf7])).toEqual({ kind: "sampleRate", hz: 48000 });
    const u = parseIncoming([0xf0, 0, 0x21, 0x27, 0x19, 0x12, 0, 96, 1, 0, 0, 0, 0, 0, 0xf7]);
    expect(u?.kind).toBe("usage");
    if (u?.kind === "usage") {
      expect(u.dsp[0]).toBeCloseTo(((128 - 96) * 100) / (4096 - 96));
      expect(u.dsp[1]).toBeNull();
    }
    expect(parseIncoming(build.rawMix(4, 6, 1000))).toEqual({ kind: "rawMix", mix: 4, ch: 6, value: 1000 });
    expect(parseIncoming([0xf0, 0x7e, 0x00, 0x06, 0x02, 0xf7])).toBeNull();
  });
});

describe("config files (.syx)", () => {
  const real = realDumpHex
    .trim()
    .split(/\s+/)
    .map((b) => parseInt(b, 16));

  it("accepts a real dump and rejects anything else", () => {
    const ok = checkConfigFile(real);
    expect(ok.ok).toBe(true);
    expect(checkConfigFile(real.slice(0, -1)).ok).toBe(false);
    expect(checkConfigFile(encodeConfigDumpV12(defaultConfig())).ok).toBe(false);
    const badByte = [...real];
    badByte[100] = 0x80;
    expect(checkConfigFile(badByte).ok).toBe(false);
    const badVersion = [...real];
    badVersion[10] = 2;
    expect(checkConfigFile(badVersion)).toEqual({ ok: false, error: "Config dump version 2 is not supported (expected 3)" });
  });

  it("splits an upload into 24 chunks like the official tool", () => {
    const chunks = configUploadChunks(real);
    expect(chunks).toHaveLength(24);
    chunks.forEach((c, i) => {
      expect(c.slice(0, 8)).toEqual([0xf0, 0x00, 0x21, 0x27, 0x19, 0x09, i, 0]);
      expect(c).toHaveLength(8 + 96 + 1);
      expect(c[c.length - 1]).toBe(0xf7);
    });
    // Reassembling the chunk payloads gives back the dump.
    const rebuilt = [...real.slice(0, 8), ...chunks.flatMap((c) => c.slice(8, -1)), 0xf7];
    expect(rebuilt).toEqual(real);
    expect(rebuilt).toHaveLength(CONFIG_DUMP_BYTES);
  });
});

describe("pan (checked on hardware)", () => {
  const bytes = (hex: string) =>
    hex
      .trim()
      .split(/\s+/)
      .map((b) => parseInt(b, 16));

  it("mix dump and config dump agree, centre reads as 0", () => {
    const mix = parseIncoming(bytes(realMixHex));
    const cfg = parseIncoming(bytes(realDumpHex));
    expect(mix?.kind).toBe("mix");
    expect(cfg?.kind).toBe("config");
    if (mix?.kind !== "mix" || cfg?.kind !== "config") return;
    expect(mix.vpan).toEqual(cfg.config.vpan);
    expect(mix.vmix).toEqual(cfg.config.vmix);
    // Untouched channels are centred (stored byte 64); Mix 3 ch 7/8 are hard left/right.
    expect(mix.vpan.filter((p) => p === 0)).toHaveLength(126);
    expect(mix.vpan[22]).toBe(-63); // stored 0, clamped to the UI range
    expect(mix.vpan[23]).toBe(62);
  });

  it("set and read use the same offset", () => {
    expect(build.vpan(0, 0, 0)[7]).toBe(64);
    const cfg = defaultConfig();
    cfg.vpan[5] = 0;
    cfg.vpan[6] = 63;
    cfg.vpan[7] = -63;
    const parsed = parseIncoming(encodeMixDump(cfg.mix, cfg.vmix, cfg.vpan));
    expect(parsed?.kind === "mix" && parsed.vpan.slice(5, 8)).toEqual([0, 63, -63]);
  });
});

describe("set messages and undo diffs", () => {
  const realConfig = () => {
    const parsed = parseIncoming(
      realDumpHex
        .trim()
        .split(/\s+/)
        .map((b) => parseInt(b, 16)),
    );
    if (parsed?.kind !== "config") throw new Error("fixture");
    return parsed.config;
  };

  it("applySetMessage inverts every builder", () => {
    const cfg = defaultConfig();
    const apply = (m: number[]) => expect(applySetMessage(cfg, m)).toBe(true);
    apply(build.inputs(2, [0x70, 0x7d, 0x60, 0x0f, 0x27, 49, 0x00, 0x17]));
    expect(cfg.capture[2]).toEqual([0x70, 0x7d, 0x60, 0x0f, 0x27, 49, 0x00, 0x17]);
    apply(build.outputs(3, [6, 7, 12, 13, 8, 9, 0x10, 0x1f]));
    expect(cfg.outputs[3]).toEqual([6, 7, 12, 13, 8, 9, 0x10, 0x1f]);
    apply(build.rawMix(15, 7, 0x7fff));
    expect(cfg.mix[15][7]).toBe(0x7fff);
    apply(build.hpf(0x55));
    apply(build.options(3));
    apply(build.link(25, true));
    apply(build.smoothing(9, true));
    apply(build.midiChannels(5, 16));
    apply(build.dcOffset(4, -3176));
    expect([cfg.hpf, cfg.options, cfg.links[25], cfg.smoothing[9], cfg.midiChUsb, cfg.midiChDin, cfg.dcOffset[4]]).toEqual([0x55, 3, true, true, 5, 16, -3176]);
    const band = { enabled: true, type: 6, freq: 23908, q: 12341, gain: -14770 };
    apply(build.filter(1, 6, 3, band));
    expect(cfg.eq[1][6][3]).toEqual(band);
    apply(build.vmix(2, 5, 90));
    expect(cfg.vmix[2 * 8 + 5]).toBe(90);
    // Mix 3/4 linked (bit 25): the pan of mix 3 goes to the slot of mix 4.
    apply(build.vpan(2, 5, -40));
    expect(cfg.vpan[2 * 8 + 5]).toBe(-40);
    expect(cfg.vmix[3 * 8 + 5]).toBe(0);
    expect(applySetMessage(cfg, build.reqConfig())).toBe(false);
  });

  it("no changes, no messages", () => {
    expect(diffMessages(realConfig(), realConfig())).toEqual([]);
  });

  it("diff messages turn one state into the other", () => {
    const a = realConfig();
    const b = realConfig();
    b.options = 1;
    b.links[0] = true;
    b.links[25] = false;
    b.links[28] = true; // Mix 9/10 becomes stereo
    b.hpf = 0x01;
    b.midiChUsb = 3;
    b.capture[2][7] = 0x60;
    b.capture[3] = [0x70, 0x71, 0x72, 0x73, 0x74, 0x75, 0x76, 0x77];
    b.outputs[0][0] = 6; // was 0x1f (Bus 16)
    b.smoothing[4] = true;
    b.dcOffset[7] = 1234;
    b.eq[1][2][0] = { enabled: true, type: 3, freq: 1000, q: 2000, gain: 300 };
    b.vmix[0] = 90;
    b.vpan[8 * 8 + 1] = 30; // pan of the new stereo mix 9/10
    b.mix[5][5] = 4321; // raw edit where the macro fader did not move

    const msgs = diffMessages(a, b);
    expect(msgs[0].key).toBe("opts");
    const c = structuredClone(a);
    for (const m of msgs) expect(applySetMessage(c, m.data)).toBe(true);
    // The raw gain behind a moved macro fader is the unit's job, not the diff's.
    c.mix[0][0] = b.mix[0][0];
    expect(c).toEqual(b);
    // Keys match the store's live-edit keys, so queued edits coalesce.
    expect(msgs.map((m) => m.key)).toEqual(expect.arrayContaining(["link25", "in2", "in3", "out0", "eq1_2_0", "vmix0_0", "vpan8_1", "raw5_5"]));
  });
});
