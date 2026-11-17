import { describe, expect, it } from "vitest";
import { SilenceDetector, silenceSpans } from "./silence";

const RATE = 16000;
const tone = (s: number) => Float32Array.from({ length: Math.round(s * RATE) }, (_, i) => 0.3 * Math.sin((2 * Math.PI * 440 * i) / RATE));
const gap = (s: number) => new Float32Array(Math.round(s * RATE));
const join = (...parts: Float32Array[]) => {
  const out = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
};

describe("silenceSpans", () => {
  it("finds one span with the right edges between two tones", () => {
    const spans = silenceSpans(join(tone(1), gap(1), tone(1)), RATE, 3);
    expect(spans).toHaveLength(1);
    expect(spans[0].start).toBeCloseTo(1, 1);
    expect(spans[0].end).toBeCloseTo(2, 1);
  });

  it("ignores gaps shorter than 0.5 s", () => {
    expect(silenceSpans(join(tone(1), gap(0.4), tone(1)), RATE, 2.4)).toEqual([]);
    expect(silenceSpans(join(tone(1), gap(0.5), tone(1)), RATE, 2.5)).toHaveLength(1);
  });

  it("runs an open span to the end of the video, and starts one at 0", () => {
    expect(silenceSpans(join(gap(1), tone(1), gap(1.5)), RATE, 3.6)).toEqual([
      { start: 0, end: 1 },
      { start: 2, end: 3.6 },
    ]);
  });

  it("counts anything under −45 dBFS as silent and anything over as sound", () => {
    const hiss = (amp: number) => Float32Array.from({ length: RATE }, (_, i) => (i % 2 ? amp : -amp));
    expect(silenceSpans(hiss(0.004), RATE, 1)).toHaveLength(1); // −48 dBFS
    expect(silenceSpans(hiss(0.007), RATE, 1)).toEqual([]); // −43 dBFS
  });

  it("gives the same spans however the audio is chunked", () => {
    const x = join(tone(1), gap(1), tone(1), gap(0.6));
    const d = new SilenceDetector(RATE);
    for (let i = 0; i < x.length; i += 777) d.push(x.subarray(i, i + 777));
    expect(d.result(3.6)).toEqual(silenceSpans(x, RATE, 3.6));
  });
});
