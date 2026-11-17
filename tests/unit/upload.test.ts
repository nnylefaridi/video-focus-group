/**
 * Local mode, prepared uploads: the browser sends its prepared files to this computer, then the
 * manifest. Runs the real routes and the runner's check (verifyUpload) against an in-process
 * Postgres and the committed fixtures: a good set is accepted and checked; a bad manifest ends
 * the review and gives the day's review back; files that don't match what was declared, or
 * aren't what they claim, are turned away before anything paid runs.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { makePrepared } from "./helpers/prepared";

const ANON = "a".repeat(32);
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => (name === "panel_anon" ? { value: ANON } : undefined), getAll: () => [], set: () => {} }),
}));
const kick = vi.hoisted(() => vi.fn());
vi.mock("@/server/kick", () => ({ kickAfterResponse: kick, kickNow: kick, kickIfUnattended: kick }));

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "panel-test-"));
process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_test";

type Ctx<P> = { params: Promise<P> };
let files: { PUT: (req: Request, ctx: Ctx<{ id: string; file: string[] }>) => Promise<Response> };
let complete: { POST: (req: Request, ctx: Ctx<{ id: string }>) => Promise<Response> };
let urls: { POST: (req: Request, ctx: Ctx<{ id: string }>) => Promise<Response> };
let reviews: typeof import("@/server/reviews");
let intake: typeof import("@/server/intake");

beforeAll(async () => {
  files = (await import("@/app/api/reviews/[id]/files/[...file]/route")) as unknown as typeof files;
  complete = (await import("@/app/api/reviews/[id]/upload-complete/route")) as unknown as typeof complete;
  urls = (await import("@/app/api/reviews/[id]/upload-urls/route")) as unknown as typeof urls;
  reviews = await import("@/server/reviews");
  intake = await import("@/server/intake");
});

async function newReview() {
  const id = reviews.newReviewId();
  await reviews.createReview({ id, answers: [], intent: { category: "creator" }, board: ["mrbeast"], title: "test", anonId: ANON });
  return id;
}

async function send(id: string, file: string, body: Buffer) {
  return files.PUT(new Request(`http://localhost/api/reviews/${id}/files/${file}`, { method: "PUT", body: new Uint8Array(body), headers: { "content-length": String(body.length) } }), {
    params: Promise.resolve({ id, file: file.split("/") }),
  });
}

async function sendAll(id: string, set: Map<string, Buffer>) {
  for (const [f, b] of set) expect((await send(id, f, b)).status).toBe(200);
}

const post = (id: string, route: string, body: unknown) =>
  new Request(`http://localhost/api/reviews/${id}/${route}`, { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body) });

describe("sending prepared files on this computer", () => {
  it("says where each file goes, and only for names a browser may send", async () => {
    const id = await newReview();
    const res = await urls.POST(post(id, "upload-urls", { files: ["video.mp4", "poster.jpg", "frames/F001.jpg"] }), { params: Promise.resolve({ id }) });
    expect(res.status).toBe(200);
    expect((await res.json()).urls["frames/F001.jpg"]).toBe(`/api/reviews/${id}/files/frames/F001.jpg`);
    const bad = await urls.POST(post(id, "upload-urls", { files: ["video.mp4", "../../etc/passwd"] }), { params: Promise.resolve({ id }) });
    expect(bad.status).toBe(400);
    expect((await send(id, "notes.txt", Buffer.from("x"))).status).toBe(404);
  });

  it("refuses a file over its own limit, keeping nothing", async () => {
    const id = await newReview();
    const res = await send(id, "frames/F001.jpg", Buffer.alloc(400 * 1024, 1));
    expect(res.status).toBe(413);
    expect(fs.existsSync(path.join(reviews.reviewDir(id), "frames/F001.jpg"))).toBe(false);
  });

  it("accepts a good set: queues it, then the check passes and writes captions", async () => {
    const id = await newReview();
    const { manifest, files: set } = await makePrepared();
    await sendAll(id, set);
    const res = await complete.POST(post(id, "upload-complete", manifest), { params: Promise.resolve({ id }) });
    expect(res.status).toBe(200);
    expect((await reviews.getReview(id))?.stage).toBe("queued");
    expect(await intake.verifyUpload(id)).toBe("ready");
    const r = await reviews.getReview(id);
    expect(r?.video).toMatchObject({ originalName: "my clip.mov", width: 720, height: 1280, hasAudio: true });
    expect(r?.video?.durationSec).toBeCloseTo(8, 1);
    expect(fs.readFileSync(path.join(reviews.reviewDir(id), "captions.vtt"), "utf8")).toContain("My cat is judging my cooking tonight.");
  });

  it("ends the review and gives the day back when the manifest breaks a rule", async () => {
    const id = await newReview();
    const { manifest, files: set } = await makePrepared();
    await sendAll(id, set);
    const res = await complete.POST(post(id, "upload-complete", { ...manifest, cuts: [3, 9] }), { params: Promise.resolve({ id }) });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/preparing your video/);
    expect(await reviews.getReview(id)).toBeNull();
    expect(fs.existsSync(reviews.reviewDir(id))).toBe(false);
  });

  it("turns away files that don't match what was declared, before anything paid", async () => {
    for (const spoil of ["size", "missing", "not-jpeg", "not-mp4"] as const) {
      const id = await newReview();
      const { manifest, files: set } = await makePrepared();
      if (spoil === "missing") set.delete("frames/F002.jpg");
      if (spoil === "not-jpeg") set.set("frames/F001.jpg", Buffer.alloc(manifest.frames[0].bytes, 7));
      if (spoil === "not-mp4") set.set("video.mp4", Buffer.alloc(manifest.video.bytes, 7));
      await sendAll(id, set);
      if (spoil === "size") fs.appendFileSync(path.join(reviews.reviewDir(id), "poster.jpg"), "xx");
      expect((await complete.POST(post(id, "upload-complete", manifest), { params: Promise.resolve({ id }) })).status).toBe(200);
      expect(await intake.verifyUpload(id)).toBe("rejected");
      const r = await reviews.getReview(id);
      expect(r).toMatchObject({ stage: "failed", stageDetail: intake.UPLOAD_REJECTED });
      expect(r?.error).toMatch(/preparing your video/);
      expect(fs.existsSync(reviews.reviewDir(id))).toBe(false);
    }
  });

  it("won't take files once the review has its video", async () => {
    const id = await newReview();
    const { manifest, files: set } = await makePrepared();
    await sendAll(id, set);
    await complete.POST(post(id, "upload-complete", manifest), { params: Promise.resolve({ id }) });
    expect((await send(id, "poster.jpg", set.get("poster.jpg")!)).status).toBe(409);
    expect((await complete.POST(post(id, "upload-complete", manifest), { params: Promise.resolve({ id }) })).status).toBe(409);
  });
});
