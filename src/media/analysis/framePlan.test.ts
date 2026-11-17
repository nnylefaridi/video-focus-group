import { describe, expect, it } from "vitest";
import { planDenseTimes, planFrameTimes, planFrames, planSprites, shotAt, spriteCount } from "./framePlan";
import { shotsFromCuts } from "./scenes";

describe("planFrameTimes", () => {
  it("samples the hook every 0.25 s, then every second", () => {
    expect(planFrameTimes(8, [])).toEqual([0, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.25, 2.5, 2.75, 3, 4, 5, 6, 7]);
  });

  it("adds the start and middle of each shot, without near-duplicates", () => {
    const shots = shotsFromCuts([3, 5.5], 8);
    expect(planFrameTimes(8, shots)).toEqual([0, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.25, 2.5, 2.75, 3, 4, 4.25, 5, 5.55, 6, 6.75, 7]);
  });

  it("never plans a frame past the end, and thins out long videos to the cap", () => {
    const t = planFrameTimes(180, shotsFromCuts([10, 20, 30, 40, 50, 60, 70, 80, 90, 100], 180));
    expect(t.length).toBeLessThanOrEqual(120);
    expect(Math.max(...t)).toBeLessThanOrEqual(179.95);
    for (let i = 1; i < t.length; i++) expect(t[i] - t[i - 1]).toBeGreaterThanOrEqual(0.15);
    expect(planFrameTimes(0.5, [])).toEqual([0, 0.25]);
  });
});

describe("planFrames", () => {
  it("fills the first 1.5 s in at 8 per second and keeps everything in time order", () => {
    const shots = shotsFromCuts([3, 5.5], 8);
    const frames = planFrames(8, shots);
    const dense = frames.filter((f) => f.dense).map((f) => f.t);
    expect(dense).toEqual([0.13, 0.38, 0.63, 0.88, 1.13, 1.38]);
    expect(frames.map((f) => f.t)).toEqual([...frames.map((f) => f.t)].sort((a, b) => a - b));
    expect(frames).toHaveLength(26);
  });

  it("is deterministic, so the server can re-derive what the browser planned", () => {
    const shots = shotsFromCuts([2.5, 7.1], 12.3);
    expect(planFrames(12.3, shots)).toEqual(planFrames(12.3, shots));
  });

  it("skips dense times already covered", () => {
    expect(planDenseTimes([0, 0.125, 0.25], 8, 0.75, 0.75)).not.toContain(0.13);
  });
});

describe("planSprites", () => {
  it("makes one tile per quarter second, 40 to a sheet", () => {
    const sheets = planSprites(8);
    expect(sheets).toHaveLength(1);
    expect(sheets[0]).toHaveLength(32);
    expect(sheets[0][0]).toBe(0);
    expect(sheets[0].at(-1)).toBe(7.75);
    expect(planSprites(180)).toHaveLength(18);
    expect(planSprites(180).every((s) => s.length === 40)).toBe(true);
    expect(spriteCount(180.5)).toBe(19);
  });
});

describe("shotAt", () => {
  const shots = shotsFromCuts([3], 8);
  it("finds the shot a time is in, and the last shot at the very end", () => {
    expect(shotAt(shots, 1)).toBe("S01");
    expect(shotAt(shots, 3)).toBe("S02");
    expect(shotAt(shots, 8)).toBe("S02");
  });
});
