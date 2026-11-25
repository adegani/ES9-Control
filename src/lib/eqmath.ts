/**
 * Approximate magnitude response of the ES-9 EQ bands, using the analogue
 * prototypes of the standard (RBJ) filter shapes. For display only.
 */
import { eqFreqToHz, eqGainToDb, eqQToFloat, type EqBand } from "./protocol";

const SHELF_Q = Math.SQRT1_2;

/** |a·s² + b·s + c|² at s = jw */
const mag2 = (a: number, b: number, c: number, w: number) => {
  const re = c - a * w * w;
  const im = b * w;
  return re * re + im * im;
};

export function bandDb(type: number, f: number, fc: number, q: number, gainDb: number): number {
  const w = f / fc;
  const A = Math.pow(10, gainDb / 40);
  const sA = Math.sqrt(A);
  let n2: number;
  let d2: number;
  switch (type) {
    case 0: // LP 1st
      n2 = 1;
      d2 = mag2(0, 1, 1, w);
      break;
    case 1: // HP 1st
      n2 = mag2(0, 1, 0, w);
      d2 = mag2(0, 1, 1, w);
      break;
    case 2: // LP 2nd
      n2 = 1;
      d2 = mag2(1, 1 / q, 1, w);
      break;
    case 3: // HP 2nd
      n2 = mag2(1, 0, 0, w);
      d2 = mag2(1, 1 / q, 1, w);
      break;
    case 4: // low shelf
      n2 = A * A * mag2(1, sA / SHELF_Q, A, w);
      d2 = mag2(A, sA / SHELF_Q, 1, w);
      break;
    case 5: // high shelf
      n2 = A * A * mag2(A, sA / SHELF_Q, 1, w);
      d2 = mag2(1, sA / SHELF_Q, A, w);
      break;
    default: // peak
      n2 = mag2(1, A / q, 1, w);
      d2 = mag2(1, 1 / (A * q), 1, w);
  }
  return 10 * Math.log10(Math.max(n2 / d2, 1e-12));
}

export const bandParams = (b: EqBand) => ({
  fc: eqFreqToHz(b.freq),
  q: eqQToFloat(b.q),
  gain: eqGainToDb(b.type, b.gain),
});

export function responseDb(bands: EqBand[], f: number): number {
  let sum = 0;
  for (const b of bands) {
    if (!b.enabled) continue;
    const p = bandParams(b);
    sum += bandDb(b.type, f, p.fc, p.q, p.gain);
  }
  return sum;
}
