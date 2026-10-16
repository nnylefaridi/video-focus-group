/**
 * Exercises the real upload route against real files made with ffmpeg:
 * a valid video is accepted and queued; disguised, too-long, too-large and
 * audio-only files are rejected with a friendly message and leave nothing behind.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { beforeAll, describe, expect, it } from "vitest";

const DATA = fs.mkdtempSync(path.join(os.tmpdir(), "panel-test-"));
process.env.DATA_DIR = DATA;
const FILES = fs.mkdtempSync(path.join(os.tmpdir(), "panel-files-"));

type Mods = {
  PUT: (req: Request, ctx: { params: Promise<{ id: string }> }) => Promise<Response>;
  reviews: typeof import("@/server/reviews");
  jobs: typeof import("@/server/db");
};
let m: Mods;

function ff(args: string[]) {
  execFileSync("ffmpeg", ["-y", "-v", "error", ...args]);
}

beforeAll(async () => {
  ff(["-f", "lavfi", "-i", "testsrc=size=320x568:rate=24:duration=3", "-f", "lavfi", "-i", "sine=frequency=440:duration=3", "-shortest", "-c:v", "libx264", "-c:a", "aac", path.join(FILES, "ok.mov")]);
  ff(["-f", "lavfi", "-i", "testsrc=size=64x64:rate=5:duration=190", "-c:v", "libx264", "-preset", "ultrafast", path.join(FILES, "long.mp4")]);
  ff(["-f", "lavfi", "-i", "sine=frequency=440:duration=3", "-c:a", "aac", path.join(FILES, "audio.m4a")]);
  fs.writeFileSync(path.join(FILES, "fake.mp4"), "this is just text pretending to be a video".repeat(20));
  const route = await import("@/app/api/reviews/[id]/video/route");
  m = { PUT: route.PUT as Mods["PUT"], reviews: await import("@/server/reviews"), jobs: await import("@/server/db") };
});

function newReview() {
  const id = m.reviews.newReviewId();
  m.reviews.createReview({ id, answers: [], intent: { category: "creator" }, board: ["mrbeast"], title: "test" });
  return id;
}

async function upload(id: string, file: string, headers: Record<string, string> = {}) {
  const body = fs.readFileSync(file);
  const req = new Request(`http://localhost/api/reviews/${id}/video`, {
    method: "PUT",
    body,
    headers: { "content-length": String(body.length), "x-file-name": path.basename(file), ...headers },
  });
  const res = await m.PUT(req, { params: Promise.resolve({ id }) });
  return { status: res.status, body: (await res.json()) as { ok?: boolean; error?: string } };
}

describe("video upload", () => {
  it("accepts a real video, stores it outside public/, and queues processing", async () => {
    const id = newReview();
    const r = await upload(id, path.join(FILES, "ok.mov"));
    expect(r.status).toBe(200);
    const rec = m.reviews.getReview(id)!;
    expect(rec.stage).toBe("queued");
    expect(rec.video?.durationSec).toBeCloseTo(3, 0);
    expect(rec.video?.hasAudio).toBe(true);
    expect(fs.existsSync(path.join(DATA, "media", id, "original.mp4"))).toBe(true);
    const job = m.jobs.db().prepare("SELECT kind, status FROM jobs WHERE review_id = ?").get(id);
    expect(job).toEqual({ kind: "process", status: "pending" });
  });

  it("rejects a text file renamed to .mp4 and cleans up", async () => {
    const id = newReview();
    const r = await upload(id, path.join(FILES, "fake.mp4"));
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/isn't an MP4, MOV or WebM/);
    expect(m.reviews.getReview(id)).toBeNull();
    expect(fs.existsSync(path.join(DATA, "media", id))).toBe(false);
  });

  it("rejects a video longer than 3 minutes", async () => {
    const id = newReview();
    const r = await upload(id, path.join(FILES, "long.mp4"));
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/limit is 3 minutes/);
    expect(m.reviews.getReview(id)).toBeNull();
  });

  it("rejects an audio-only file", async () => {
    const id = newReview();
    const r = await upload(id, path.join(FILES, "audio.m4a"));
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/doesn't contain a video track/);
  });

  it("rejects a declared size over 250 MB before reading it", async () => {
    const id = newReview();
    const req = new Request(`http://localhost/api/reviews/${id}/video`, {
      method: "PUT",
      body: "x",
      headers: { "content-length": String(300 * 1024 * 1024) },
    });
    const res = await m.PUT(req, { params: Promise.resolve({ id }) });
    expect(res.status).toBe(413);
    expect(m.reviews.getReview(id)).toBeNull();
  });

  it("refuses a second upload to the same review", async () => {
    const id = newReview();
    await upload(id, path.join(FILES, "ok.mov"));
    const again = await upload(id, path.join(FILES, "ok.mov"));
    expect(again.status).toBe(409);
  });

  it("removes uploads that were abandoned mid-way", () => {
    const id = newReview();
    m.jobs.db().prepare("UPDATE reviews SET created_at = ? WHERE id = ?").run(Date.now() - 2 * 3600 * 1000, id);
    expect(m.reviews.cleanupAbandonedUploads()).toBeGreaterThanOrEqual(1);
    expect(m.reviews.getReview(id)).toBeNull();
  });
});
