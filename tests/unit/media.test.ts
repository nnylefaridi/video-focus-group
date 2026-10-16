/**
 * Signed media URLs: valid signatures work, tampered or expired ones don't,
 * and only whitelisted files inside a review folder can ever be served.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "panel-media-"));

describe("signed media urls", async () => {
  const { signedMediaUrl, verifyMediaSignature, isServable } = await import("@/server/media");
  const id = "AAAAAAAAAAAAAAAA";

  it("accepts its own signature", () => {
    const u = new URL(signedMediaUrl(id, "video.mp4"), "http://x");
    expect(verifyMediaSignature(id, "video.mp4", u.searchParams.get("exp"), u.searchParams.get("sig"))).toBe(true);
  });
  it("rejects a signature for another file or review", () => {
    const u = new URL(signedMediaUrl(id, "video.mp4"), "http://x");
    expect(verifyMediaSignature(id, "poster.jpg", u.searchParams.get("exp"), u.searchParams.get("sig"))).toBe(false);
    expect(verifyMediaSignature("BBBBBBBBBBBBBBBB", "video.mp4", u.searchParams.get("exp"), u.searchParams.get("sig"))).toBe(false);
  });
  it("rejects expired and missing signatures", () => {
    const u = new URL(signedMediaUrl(id, "video.mp4", -10), "http://x");
    expect(verifyMediaSignature(id, "video.mp4", u.searchParams.get("exp"), u.searchParams.get("sig"))).toBe(false);
    expect(verifyMediaSignature(id, "video.mp4", null, null)).toBe(false);
  });
  it("never serves originals, audio, transcripts or paths outside the folder", () => {
    expect(isServable("video.mp4")).toBe(true);
    expect(isServable("frames/F012.jpg")).toBe(true);
    for (const f of ["original.mp4", "audio.wav", "transcript.json", "../app.db", "frames/../../x.jpg", "frames/F1.jpg"]) expect(isServable(f)).toBe(false);
  });
});
