import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { inspectMp4, mp4Problems } from "./mp4";

const fixture = (name: string) => new Uint8Array(fs.readFileSync(path.resolve(import.meta.dirname, "../../tests/fixtures", name)));
const problems = (name: string) => {
  const r = inspectMp4(fixture(name));
  if (!r.ok) throw new Error(r.reason);
  return { info: r.info, problems: mp4Problems(r.info) };
};

describe("reading an MP4's header", () => {
  it("accepts a prepared 720p H.264 file with its index first", () => {
    const { info, problems: p } = problems("prepared-720.mp4");
    expect(info).toMatchObject({ width: 720, height: 1280 });
    expect(info.durationSec).toBeCloseTo(8, 1);
    expect(p).toEqual([]);
  });

  it("flags an index at the end of the file", () => {
    expect(problems("not-faststart.mp4").problems.join(" ")).toMatch(/index/);
  });

  it("flags a video that isn't H.264", () => {
    expect(problems("hevc.mp4").problems.join(" ")).toMatch(/H\.264/);
  });

  it("says so, without throwing, for bytes that aren't an MP4", () => {
    const r = inspectMp4(new TextEncoder().encode("not a video at all".repeat(10)));
    expect(r.ok).toBe(false);
  });
});
