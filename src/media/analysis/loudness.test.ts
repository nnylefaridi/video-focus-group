import { describe, expect, it } from "vitest";
import { LoudnessMeter, kWeighting, loudnessPerSecond } from "./loudness";

function sine(freq: number, amp: number, rate: number, seconds: number): Float32Array {
  const out = new Float32Array(Math.round(rate * seconds));
  for (let i = 0; i < out.length; i++) out[i] = amp * Math.sin((2 * Math.PI * freq * i) / rate);
  return out;
}

describe("loudness", () => {
  // A mono 1 kHz sine at −20 dBFS peak has mean-square 0.005 (−23.01 dB). K-weighting is ≈ 0 dB at
  // 1 kHz and the −0.691 offset cancels it, so the meter reads about −23.0 LUFS. (The EBU's "−20 LUFS"
  // test signal is the same sine on two channels, which adds 3 dB.)
  it("reads a 1 kHz sine at −20 dBFS as −23.0 LUFS, at any common sample rate", () => {
    for (const rate of [48000, 44100, 16000]) {
      const loud = loudnessPerSecond(sine(1000, 0.1, rate, 3), rate, 3);
      expect(loud).toHaveLength(3);
      expect(Math.abs((loud[1] as number) + 23.0)).toBeLessThan(0.15);
      expect(Math.abs((loud[2] as number) + 23.0)).toBeLessThan(0.15);
    }
  });

  it("reads 10 dB quieter as 10 dB lower", () => {
    const a = loudnessPerSecond(sine(1000, 0.1, 48000, 2), 48000, 2)[1] as number;
    const b = loudnessPerSecond(sine(1000, 0.1 * Math.pow(10, -0.5), 48000, 2), 48000, 2)[1] as number;
    expect(a - b).toBeCloseTo(10, 1);
  });

  it("gives null for silence and below −70 LUFS", () => {
    expect(loudnessPerSecond(new Float32Array(48000 * 2), 48000, 2)).toEqual([null, null]);
    expect(loudnessPerSecond(sine(1000, 0.0001, 48000, 2), 48000, 2)).toEqual([null, null]);
  });

  it("returns ceil(duration) readings and takes the loudest per second", () => {
    expect(loudnessPerSecond(sine(1000, 0.1, 48000, 2.5), 48000, 2.5)).toHaveLength(3);
    const loud = loudnessPerSecond(new Float32Array(0), 48000, 2.2);
    expect(loud).toEqual([null, null, null]);
  });

  it("gives the same answer whatever the chunk size", () => {
    const x = sine(440, 0.2, 48000, 2);
    const whole = loudnessPerSecond(x, 48000, 2);
    const m = new LoudnessMeter(48000);
    for (let i = 0; i < x.length; i += 1000) m.push(x.subarray(i, i + 1000));
    expect(m.perSecond(2)).toEqual(whole);
  });

  it("rounds to a tenth", () => {
    const v = loudnessPerSecond(sine(1000, 0.1, 48000, 2), 48000, 2)[1] as number;
    expect(String(v).split(".")[1]?.length ?? 0).toBeLessThanOrEqual(1);
  });

  it("derives the 48 kHz K-weighting coefficients of the standard", () => {
    const [shelf, hp] = kWeighting(48000);
    expect(shelf.b0).toBeCloseTo(1.53512485958697, 9);
    expect(shelf.b1).toBeCloseTo(-2.69169618940638, 9);
    expect(shelf.a1).toBeCloseTo(-1.69065929318241, 9);
    expect(hp.a1).toBeCloseTo(-1.99004745483398, 9);
    expect(hp.a2).toBeCloseTo(0.99007225036621, 9);
  });

  it("refuses a nonsense sample rate", () => {
    expect(() => new LoudnessMeter(0)).toThrow();
  });
});
