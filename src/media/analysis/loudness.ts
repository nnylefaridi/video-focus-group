/**
 * Momentary loudness (EBU R128 / ITU-R BS.1770): K-weighting, a 400 ms window, a reading every 100 ms.
 * The same numbers ffmpeg's `ebur128` prints as `M:`, kept as the loudest reading above −70 LUFS in
 * each second (rounded to 0.1), or null. Pure and streaming: feed mono samples in chunks.
 */

type Biquad = { b0: number; b1: number; b2: number; a1: number; a2: number };

/** The two K-weighting filters for any sample rate (coefficients from the BS.1770 definitions, as libebur128 derives them). */
export function kWeighting(sampleRate: number): [Biquad, Biquad] {
  // Stage 1: a high shelf that models the head.
  const f1 = 1681.974450955533;
  const G = 3.999843853973347;
  const Q1 = 0.7071752369554196;
  const k1 = Math.tan((Math.PI * f1) / sampleRate);
  const Vh = Math.pow(10, G / 20);
  const Vb = Math.pow(Vh, 0.4996667741545416);
  const a01 = 1 + k1 / Q1 + k1 * k1;
  const shelf: Biquad = {
    b0: (Vh + (Vb * k1) / Q1 + k1 * k1) / a01,
    b1: (2 * (k1 * k1 - Vh)) / a01,
    b2: (Vh - (Vb * k1) / Q1 + k1 * k1) / a01,
    a1: (2 * (k1 * k1 - 1)) / a01,
    a2: (1 - k1 / Q1 + k1 * k1) / a01,
  };
  // Stage 2: a high-pass (the "revised low-frequency B" curve).
  const f2 = 38.13547087602444;
  const Q2 = 0.5003270373238773;
  const k2 = Math.tan((Math.PI * f2) / sampleRate);
  const a02 = 1 + k2 / Q2 + k2 * k2;
  const highpass: Biquad = { b0: 1, b1: -2, b2: 1, a1: (2 * (k2 * k2 - 1)) / a02, a2: (1 - k2 / Q2 + k2 * k2) / a02 };
  return [shelf, highpass];
}

export const LOUDNESS_FLOOR_LUFS = -70;

export class LoudnessMeter {
  private readonly stages: [Biquad, Biquad];
  private readonly state = [new Float64Array(2), new Float64Array(2)]; // transposed direct form II
  private readonly hop: number;
  private blockSum = 0;
  private blockCount = 0;
  /** Mean-square of each completed 100 ms block. */
  private readonly blocks: number[] = [];

  constructor(readonly sampleRate: number) {
    if (!(sampleRate >= 8000 && sampleRate <= 384000)) throw new Error(`Unsupported sample rate ${sampleRate}`);
    this.stages = kWeighting(sampleRate);
    this.hop = Math.max(1, Math.round(sampleRate / 10));
  }

  /** Add the next mono samples (−1…1), in order. */
  push(samples: ArrayLike<number>): void {
    const [s1, s2] = this.stages;
    const [z1, z2] = this.state;
    for (let i = 0; i < samples.length; i++) {
      const x = samples[i];
      const y1 = s1.b0 * x + z1[0];
      z1[0] = s1.b1 * x - s1.a1 * y1 + z1[1];
      z1[1] = s1.b2 * x - s1.a2 * y1;
      const y2 = s2.b0 * y1 + z2[0];
      z2[0] = s2.b1 * y1 - s2.a1 * y2 + z2[1];
      z2[1] = s2.b2 * y1 - s2.a2 * y2;
      this.blockSum += y2 * y2;
      if (++this.blockCount === this.hop) {
        this.blocks.push(this.blockSum / this.hop);
        this.blockSum = 0;
        this.blockCount = 0;
      }
    }
  }

  /** Momentary loudness at the end of each completed 100 ms block (the first three use zeros before the start, as ffmpeg does). */
  momentary(): { t: number; lufs: number }[] {
    const out: { t: number; lufs: number }[] = [];
    for (let k = 0; k < this.blocks.length; k++) {
      let sum = 0;
      for (let j = Math.max(0, k - 3); j <= k; j++) sum += this.blocks[j];
      const ms = sum / 4;
      out.push({ t: ((k + 1) * this.hop) / this.sampleRate, lufs: ms > 0 ? -0.691 + 10 * Math.log10(ms) : -Infinity });
    }
    return out;
  }

  /** The loudest reading above −70 LUFS in each second, rounded to 0.1; null where there's nothing. Length is ceil(duration). */
  perSecond(durationSec: number): (number | null)[] {
    const seconds = Math.max(0, Math.ceil(durationSec));
    const loud: (number | null)[] = Array(seconds).fill(null);
    if (seconds === 0) return loud;
    for (const { t, lufs } of this.momentary()) {
      const sec = Math.min(seconds - 1, Math.floor(t));
      if (lufs > LOUDNESS_FLOOR_LUFS && (loud[sec] === null || lufs > (loud[sec] as number))) loud[sec] = Math.round(lufs * 10) / 10;
    }
    return loud;
  }
}

/** Convenience for whole buffers (tests, short clips). */
export function loudnessPerSecond(samples: ArrayLike<number>, sampleRate: number, durationSec: number): (number | null)[] {
  const m = new LoudnessMeter(sampleRate);
  m.push(samples);
  return m.perSecond(durationSec);
}
