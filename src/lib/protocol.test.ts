import { describe, expect, it } from "vitest";
import {
  build,
  captureFromWire,
  captureLinkIndex,
  captureToWire,
  dbToVmix,
  defaultConfig,
  encodeConfigDump,
  encodeMixDump,
  eqFreqToHz,
  FlashSlot,
  mixLinkIndex,
  parseIncoming,
  rawMixToDb,
  vmixToDb,
} from "./protocol";

describe("message builders (byte-exact vs original tool)", () => {
  it("requests", () => {
    expect(build.reqConfig()).toEqual([0xf0, 0x00, 0x21, 0x27, 0x19, 0x23, 0xf7]);
    expect(build.reqVersion()).toEqual([0xf0, 0x00, 0x21, 0x27, 0x19, 0x22, 0xf7]);
    expect(build.save(FlashSlot.Hosted)).toEqual([0xf0, 0x00, 0x21, 0x27, 0x19, 0x24, 1, 0xf7]);
    expect(build.restore(FlashSlot.Standalone)).toEqual([0xf0, 0x00, 0x21, 0x27, 0x19, 0x25, 0, 0xf7]);
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

    const parsed = parseIncoming(encodeConfigDump(cfg));
    expect(parsed?.kind).toBe("config");
    if (parsed?.kind === "config") expect(parsed.config).toEqual(cfg);
  });

  it("rejects other config versions", () => {
    const dump = encodeConfigDump(defaultConfig());
    dump[8] = 2;
    expect(parseIncoming(dump)).toEqual({ kind: "configVersionMismatch", version: 2 });
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
