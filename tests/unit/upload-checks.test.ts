import { describe, expect, it } from "vitest";
import { checkFile, checkVideo, isTallerThanWide } from "@/core/uploadChecks";

const file = (name: string, type: string, size = 5 * 1024 * 1024) => ({ name, type, size });

describe("checks before uploading", () => {
  it("accepts MP4, MOV, M4V and WebM by name and type", () => {
    expect(checkFile(file("a.mp4", "video/mp4"), 250)).toBeNull();
    expect(checkFile(file("a.MOV", "video/quicktime"), 250)).toBeNull();
    expect(checkFile(file("a.m4v", "video/x-m4v"), 250)).toBeNull();
    expect(checkFile(file("a.webm", "video/webm"), 250)).toBeNull();
  });

  it("accepts a blank type when the extension is right (some browsers don't know it)", () => {
    expect(checkFile(file("clip.mov", ""), 250)).toBeNull();
  });

  it("refuses other extensions, and a video extension on the wrong type", () => {
    expect(checkFile(file("a.avi", "video/x-msvideo"), 250)).toMatch(/MP4, MOV or WebM/);
    expect(checkFile(file("a.mp4", "image/png"), 250)).toMatch(/MP4, MOV or WebM/);
    expect(checkFile(file("noextension", "video/mp4"), 250)).toMatch(/MP4, MOV or WebM/);
  });

  it("refuses empty and over-size files, naming the limit", () => {
    expect(checkFile(file("a.mp4", "video/mp4", 0), 250)).toMatch(/empty/);
    expect(checkFile(file("a.mp4", "video/mp4", 251 * 1024 * 1024), 250)).toMatch(/larger than 250 MB/);
    expect(checkFile(file("a.mp4", "video/mp4", 51 * 1024 * 1024), 50)).toMatch(/larger than 50 MB/);
    expect(checkFile(file("a.mp4", "video/mp4", 250 * 1024 * 1024), 250)).toBeNull();
  });

  it("allows vertical videos up to 3 minutes", () => {
    expect(checkVideo({ durationSec: 30, width: 1080, height: 1920 })).toBeNull();
    expect(checkVideo({ durationSec: 180, width: 720, height: 1280 })).toBeNull();
    expect(checkVideo({ durationSec: 20, width: 1000, height: 1001 })).toBeNull();
  });

  it("blocks videos over 3 minutes and says how long they are", () => {
    expect(checkVideo({ durationSec: 200, width: 1080, height: 1920 })).toMatch(/3:20 long.*3 minutes/);
    expect(checkVideo({ durationSec: 181, width: 1080, height: 1920 })).toMatch(/3:01/);
  });

  it("blocks horizontal and square videos with a friendly explanation", () => {
    for (const [width, height] of [[1920, 1080], [1080, 1080]]) {
      const problem = checkVideo({ durationSec: 20, width, height });
      expect(problem).toMatch(/vertical/);
      expect(problem).toMatch(/Video Focus Group/);
      expect(problem).not.toMatch(/Panel/);
    }
    expect(isTallerThanWide({ width: 1080, height: 1080 })).toBe(false);
  });

  it("still catches a long video when its size can't be read", () => {
    expect(checkVideo({ durationSec: 400, width: 0, height: 0 })).toMatch(/3 minutes/);
    expect(checkVideo({ durationSec: 20, width: 0, height: 0 })).toBeNull();
  });
});
