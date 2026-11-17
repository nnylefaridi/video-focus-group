/**
 * Hosted uploads go straight from the browser to private storage. Runs the real routes and the
 * worker's intake against an in-process Postgres and real ffmpeg files, with Supabase Storage
 * replaced by an in-memory stand-in (no network): only the owner gets an upload address, it's
 * given once, "upload complete" checks the object is there and within the size limit, and the
 * worker turns away files that are the wrong kind, too long, too big or not vertical.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "panel-direct-"));
process.env.PANEL_MODE = "hosted";
process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_test";
process.env.HOSTED_PUBLIC_URL = "https://panel.example.com";
process.env.MAX_UPLOAD_MB = "5";
const FILES = fs.mkdtempSync(path.join(os.tmpdir(), "panel-direct-files-"));

const state = vi.hoisted(() => ({
  user: null as null | { sub: string; email: string },
  /** Storage objects by "<user>/<review>", as local file paths, plus a size to report for them. */
  objects: new Map<string, { file: string; size: number }>(),
  issued: [] as string[],
  removed: [] as string[],
}));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, getAll: () => [], set: () => {} }) }));
vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({ auth: { getClaims: async () => ({ data: state.user ? { claims: state.user } : null }) } }),
}));
vi.mock("@/server/storage", () => ({
  createUploadUrl: async (userId: string, reviewId: string) => {
    state.issued.push(`${userId}/${reviewId}`);
    return `https://example.supabase.co/storage/v1/object/upload/sign/review-uploads/${userId}/${reviewId}/upload?token=t`;
  },
  uploadedSize: async (userId: string, reviewId: string) => state.objects.get(`${userId}/${reviewId}`)?.size ?? null,
  downloadUpload: async (userId: string, reviewId: string, dest: string) => {
    fs.copyFileSync(state.objects.get(`${userId}/${reviewId}`)!.file, dest);
  },
  removeUpload: async (userId: string, reviewId: string) => {
    state.removed.push(`${userId}/${reviewId}`);
    state.objects.delete(`${userId}/${reviewId}`);
  },
  removeStoredMedia: async () => {},
}));

const OWNER = "4f1c1f2e-8e0e-4b9a-9d55-0d6c1b2a3c4d";
const OTHER = "9a8b7c6d-1111-4222-8333-444455556666";

let urlRoute: typeof import("@/app/api/reviews/[id]/upload-url/route");
let completeRoute: typeof import("@/app/api/reviews/[id]/upload-complete/route");
let reviews: typeof import("@/server/reviews");
let intake: typeof import("@/server/intake");
let db: typeof import("@/server/db");

function ff(args: string[]) {
  execFileSync("ffmpeg", ["-y", "-v", "error", ...args]);
}

beforeAll(async () => {
  const video = (name: string, size: string, seconds: number, rate = 24) =>
    ff(["-f", "lavfi", "-i", `testsrc=size=${size}:rate=${rate}:duration=${seconds}`, "-c:v", "libx264", "-preset", "ultrafast", path.join(FILES, name)]);
  video("vertical.mp4", "320x568", 3);
  video("horizontal.mp4", "568x320", 3);
  video("long.mp4", "64x128", 190, 5);
  ff(["-f", "lavfi", "-i", "sine=frequency=440:duration=3", "-c:a", "aac", path.join(FILES, "audio.m4a")]);
  fs.writeFileSync(path.join(FILES, "fake.mp4"), "this is just text pretending to be a video".repeat(20));
  urlRoute = await import("@/app/api/reviews/[id]/upload-url/route");
  completeRoute = await import("@/app/api/reviews/[id]/upload-complete/route");
  reviews = await import("@/server/reviews");
  intake = await import("@/server/intake");
  db = await import("@/server/db");
});

beforeEach(() => {
  state.user = { sub: OWNER, email: "maker@example.com" };
  state.objects.clear();
  state.issued.length = 0;
  state.removed.length = 0;
});

const ctx = (id: string) => ({ params: Promise.resolve({ id }) }) as never;
const req = (id: string, route: string, body: unknown = {}) =>
  new Request(`https://panel.example.com/api/reviews/${id}/${route}`, { method: "POST", body: JSON.stringify(body) });

async function newReview(userId = OWNER) {
  const id = reviews.newReviewId();
  await reviews.createReview({ id, answers: [], intent: { category: "creator" }, board: ["mrbeast"], title: "test", userId });
  return id;
}
const put = (id: string, file: string, size = fs.statSync(path.join(FILES, file)).size, userId = OWNER) =>
  state.objects.set(`${userId}/${id}`, { file: path.join(FILES, file), size });

describe("getting an upload address", () => {
  it("gives the review's owner an address for their own review's path", async () => {
    const id = await newReview();
    const res = await urlRoute.POST(req(id, "upload-url"), ctx(id));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.url).toContain(`/review-uploads/${OWNER}/${id}/upload`);
    expect(body.maxMb).toBe(5);
    expect(state.issued).toEqual([`${OWNER}/${id}`]);
  });

  it("refuses someone signed out, without making an address", async () => {
    const id = await newReview();
    state.user = null;
    const res = await urlRoute.POST(req(id, "upload-url"), ctx(id));
    // A signed-in person's review isn't visible to anyone else, signed in or not.
    expect(res.status).toBe(404);
    expect(state.issued).toEqual([]);
  });

  it("refuses another account as if the review didn't exist", async () => {
    const id = await newReview();
    state.user = { sub: OTHER, email: "other@example.com" };
    const res = await urlRoute.POST(req(id, "upload-url"), ctx(id));
    expect(res.status).toBe(404);
    expect(state.issued).toEqual([]);
  });

  it("gives only one upload per review: not once a video is there, nor once it's queued", async () => {
    const id = await newReview();
    put(id, "vertical.mp4");
    expect((await urlRoute.POST(req(id, "upload-url"), ctx(id))).status).toBe(409);
    state.objects.clear();
    await reviews.updateReview(id, { stage: "queued" });
    expect((await urlRoute.POST(req(id, "upload-url"), ctx(id))).status).toBe(409);
    expect(state.issued).toEqual([]);
  });
});

describe("saying the upload is complete", () => {
  it("queues a review whose video is in storage, passing on the file's name", async () => {
    const id = await newReview();
    put(id, "vertical.mp4");
    const res = await completeRoute.POST(req(id, "upload-complete", { name: "my cat.mp4" }), ctx(id));
    expect(res.status).toBe(200);
    expect((await reviews.getReview(id))!.stage).toBe("queued");
    const job = await db.one<{ kind: string; payload: { name: string } | string }>("SELECT kind, payload FROM app.jobs WHERE review_id = $1", [id]);
    expect(job?.kind).toBe("process");
    const payload = typeof job!.payload === "string" ? JSON.parse(job!.payload) : job!.payload;
    expect(payload.name).toBe("my cat.mp4");
  });

  it("doesn't queue when nothing arrived, and lets them try again", async () => {
    const id = await newReview();
    const res = await completeRoute.POST(req(id, "upload-complete"), ctx(id));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/didn't arrive/);
    expect((await reviews.getReview(id))!.stage).toBe("uploading");
    expect(await db.one("SELECT 1 FROM app.jobs WHERE review_id = $1", [id])).toBeNull();
  });

  it("removes an upload over the size limit and the review with it", async () => {
    const id = await newReview();
    put(id, "vertical.mp4", 6 * 1024 * 1024);
    const res = await completeRoute.POST(req(id, "upload-complete"), ctx(id));
    expect(res.status).toBe(413);
    expect((await res.json()).error).toMatch(/larger than 5 MB/);
    expect(state.removed).toEqual([`${OWNER}/${id}`]);
    expect(await reviews.getReview(id)).toBeNull();
  });

  it("refuses another account and a second completion", async () => {
    const id = await newReview();
    put(id, "vertical.mp4");
    state.user = { sub: OTHER, email: "other@example.com" };
    expect((await completeRoute.POST(req(id, "upload-complete"), ctx(id))).status).toBe(404);
    state.user = { sub: OWNER, email: "maker@example.com" };
    expect((await completeRoute.POST(req(id, "upload-complete"), ctx(id))).status).toBe(200);
    expect((await completeRoute.POST(req(id, "upload-complete"), ctx(id))).status).toBe(409);
  });
});

describe("the worker's check of an uploaded video", () => {
  async function run(file: string, size?: number) {
    const id = await newReview();
    put(id, file, size);
    await reviews.updateReview(id, { stage: "queued" });
    const result = await intake.intakeUpload(id, "clip.mp4");
    return { id, result, review: (await reviews.getReview(id))! };
  }

  it("keeps a good vertical video as the original, with its details", async () => {
    const { id, result, review } = await run("vertical.mp4");
    expect(result).toBe("ready");
    expect(fs.existsSync(path.join(process.env.DATA_DIR!, "media", id, "original.mp4"))).toBe(true);
    expect(review.video).toMatchObject({ originalName: "clip.mp4", width: 320, height: 568, hasAudio: false });
    expect(state.removed).toEqual([]);
  });

  it("rejects a file that's too big, before downloading it", async () => {
    const { id, result, review } = await run("vertical.mp4", 6 * 1024 * 1024);
    expect(result).toBe("rejected");
    expect(review.stage).toBe("failed");
    expect(review.error).toMatch(/larger than 5 MB/);
    expect(fs.existsSync(path.join(process.env.DATA_DIR!, "media", id))).toBe(false);
    expect(state.removed).toEqual([`${OWNER}/${id}`]);
  });

  it("rejects a video over 3 minutes", async () => {
    const { result, review } = await run("long.mp4");
    expect(result).toBe("rejected");
    expect(review.error).toMatch(/limit is 3 minutes/);
    expect(state.removed).toHaveLength(1);
  });

  it("rejects a text file renamed to .mp4, an audio-only file and a horizontal video", async () => {
    const fake = await run("fake.mp4");
    expect(fake.review.error).toMatch(/isn't an MP4, MOV or WebM/);
    const audio = await run("audio.m4a");
    expect(audio.review.error).toMatch(/doesn't contain a video track/);
    const wide = await run("horizontal.mp4");
    expect(wide.review.error).toMatch(/vertical/);
    for (const r of [fake, audio, wide]) {
      expect(r.result).toBe("rejected");
      expect(r.review.stage).toBe("failed");
      expect(fs.existsSync(path.join(process.env.DATA_DIR!, "media", r.id))).toBe(false);
    }
  });

  it("gives back the day's review it counted, and says so when the video never arrived", async () => {
    const id = await newReview();
    await db.q("INSERT INTO app.usage (at, client_key, network_key, kind, review_id) VALUES ($1, 'c', 'n', 'review', $2)", [Date.now(), id]);
    expect(await db.one("SELECT 1 FROM app.usage WHERE review_id = $1", [id])).not.toBeNull();
    await reviews.updateReview(id, { stage: "queued" });
    expect(await intake.intakeUpload(id)).toBe("rejected");
    expect((await reviews.getReview(id))!.error).toMatch(/never arrived/);
    expect(await db.one("SELECT 1 FROM app.usage WHERE review_id = $1 AND kind = 'review'", [id])).toBeNull();
  });

  it("won't retry a rejected video, and says why", async () => {
    const { id, review } = await run("horizontal.mp4");
    expect(review.stage).toBe("failed");
    const retry = await import("@/app/api/reviews/[id]/retry/route");
    const res = await retry.POST(req(id, "retry"), ctx(id));
    expect(res.status).toBe(409);
    const { error } = await res.json();
    expect(error).toMatch(/^This video couldn't be used: .*vertical.*Start a new review with another file\.$/);
    expect(error).not.toMatch(/never arrived/);
    expect((await reviews.getReview(id))!.stage).toBe("failed");
    expect(await db.one("SELECT 1 FROM app.jobs WHERE review_id = $1 AND kind = 'process'", [id])).toBeNull();
  });

  it("leaves a review that already has its video or analysis alone", async () => {
    const { id } = await run("vertical.mp4");
    expect(await intake.intakeUpload(id)).toBe("not-needed");
  });
});
