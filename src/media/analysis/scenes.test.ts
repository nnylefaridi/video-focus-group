import { describe, expect, it } from "vitest";
import { SceneDetector, finalizeCuts, shotsFromCuts, type SceneFrame } from "./scenes";

const W = 16;
const H = 28;
function solid(t: number, r: number, g = r, b = r): SceneFrame {
  const rgba = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < W * H; i++) rgba.set([r, g, b, 255], i * 4);
  return { t, width: W, height: H, rgba };
}

/** A 30 fps run of frames whose grey level comes from `level(frameIndex)`. */
function run(frames: number, level: (i: number) => number, fps = 30): SceneFrame[] {
  return Array.from({ length: frames }, (_, i) => solid(i / fps, level(i)));
}

function cutsOf(frames: SceneFrame[]) {
  const d = new SceneDetector();
  for (const f of frames) d.push(f);
  return d.rawCuts;
}

describe("SceneDetector", () => {
  it("finds a cut at the frame where a flat shot jumps to another", () => {
    const frames = run(90, (i) => (i < 30 ? 40 : i < 60 ? 200 : 20));
    const cuts = cutsOf(frames);
    expect(cuts).toHaveLength(2);
    expect(cuts[0]).toBeCloseTo(1, 5);
    expect(cuts[1]).toBeCloseTo(2, 5);
  });

  it("scores the frame after a cut as no cut, as ffmpeg does", () => {
    const d = new SceneDetector();
    const scores = run(6, (i) => (i < 3 ? 40 : 200)).map((f) => d.push(f));
    expect(scores[0]).toBeNull(); // nothing to compare with yet
    expect(scores[3]).toBeGreaterThan(0.3);
    expect(scores[4]).toBe(0);
  });

  it("ignores a gradual change", () => {
    expect(cutsOf(run(60, (i) => 40 + i * 2))).toEqual([]);
  });

  it("sees a hard cut between a dark red and a bright cyan shot", () => {
    const frames = [solid(0, 120, 0, 0), solid(1 / 30, 120, 0, 0), solid(2 / 30, 0, 255, 255), solid(3 / 30, 0, 255, 255)];
    expect(cutsOf(frames)).toEqual([2 / 30]);
  });

  it("treats a 60 fps video like a 30 fps one", () => {
    const frames = run(180, (i) => (i < 60 ? 40 : 200), 60);
    const d = new SceneDetector();
    let used = 0;
    for (const f of frames) if (d.push(f) !== null) used++;
    expect(used).toBeLessThanOrEqual(90);
    expect(d.rawCuts).toHaveLength(1);
    expect(d.rawCuts[0]).toBeGreaterThan(0.95);
    expect(d.rawCuts[0]).toBeLessThan(1.05);
  });
});

describe("finalizeCuts", () => {
  it("drops cuts within 0.2 s of either end and of the cut before", () => {
    expect(finalizeCuts([0.1, 0.2, 1, 1.15, 3, 7.9, 8], 8)).toEqual([1, 3]);
  });
  it("keeps cuts in order and rounds to hundredths", () => {
    expect(finalizeCuts([2.504, 5.5], 8)).toEqual([2.5, 5.5]);
  });
});

describe("shotsFromCuts", () => {
  it("makes S01… from 0 to each cut to the end", () => {
    expect(shotsFromCuts([3, 5.5], 8)).toEqual([
      { id: "S01", start: 0, end: 3 },
      { id: "S02", start: 3, end: 5.5 },
      { id: "S03", start: 5.5, end: 8 },
    ]);
    expect(shotsFromCuts([], 4)).toEqual([{ id: "S01", start: 0, end: 4 }]);
  });
});
