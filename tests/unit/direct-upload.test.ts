/**
 * Hosted uploads: the browser prepares the video on the person's device and sends the files
 * straight to private storage, then the manifest. Runs the real routes and the runner's check
 * (verifyUpload) against an in-process Postgres and the committed fixtures, with Supabase
 * Storage replaced by an in-memory stand-in (no network): only the owner gets upload URLs, only
 * for names a browser may send; a bad manifest ends the review at once; and files that don't
 * match what was declared, or aren't what they claim, are removed before anything paid runs.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { makePrepared } from "./helpers/prepared";

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "panel-direct-"));
process.env.PANEL_MODE = "hosted";
process.env.MEDIA_SECRET = Buffer.alloc(32, 9).toString("base64");
process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_test";
process.env.HOSTED_PUBLIC_URL = "https://panel.example.com";
process.env.MAX_UPLOAD_MB = "5";

const state = vi.hoisted(() => ({
  user: null as null | { sub: string; email: string },
  /** Stored objects by "<user>/<review>/<file>". */
  objects: new Map<string, Buffer>(),
  issued: [] as string[],
  headReads: 0,
}));
const kick = vi.hoisted(() => vi.fn());
vi.mock("@/server/kick", () => ({ kickAfterResponse: kick, kickNow: kick, kickIfUnattended: kick }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, getAll: () => [], set: () => {} }) }));
vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({ auth: { getClaims: async () => ({ data: state.user ? { claims: state.user } : null }) } }),
}));
vi.mock("@/server/storage", async () => {
  const fsm = await import("node:fs");
  const pathm = await import("node:path");
  const { reviewDir } = await import("@/server/reviews");
  const key = (u: string, r: string, f: string) => `${u}/${r}/${f}`;
  const listOf = (u: string, r: string) => {
    const out = new Map<string, number>();
    for (const [k, v] of state.objects) if (k.startsWith(`${u}/${r}/`)) out.set(k.slice(`${u}/${r}/`.length), v.length);
    return out;
  };
  return {
    MAX_FILE_BYTES: 5 * 1024 * 1024,
    signedUploadUrls: async (u: string, r: string, files: string[]) => {
      state.issued.push(...files.map((f) => key(u, r, f)));
      return Object.fromEntries(files.map((f) => [f, `https://example.supabase.co/storage/v1/object/upload/sign/review-media/${key(u, r, f)}?token=t`]));
    },
    listReviewObjects: async (u: string, r: string) => listOf(u, r),
    fetchHead: async (u: string, r: string, f: string, bytes: number) => {
      state.headReads++;
      return new Uint8Array(state.objects.get(key(u, r, f))!.subarray(0, bytes));
    },
    restoreFile: async (u: string, r: string, f: string) => {
      const dest = pathm.join(reviewDir(r), f);
      fsm.mkdirSync(pathm.dirname(dest), { recursive: true });
      fsm.writeFileSync(dest, state.objects.get(key(u, r, f))!);
    },
    putSmallFile: async (u: string, r: string, f: string, body: Buffer) => void state.objects.set(key(u, r, f), body),
    removeAllStoredMedia: async (u: string, r: string) => {
      for (const f of listOf(u, r).keys()) state.objects.delete(key(u, r, f));
    },
    removeStoredMedia: async (u: string, r: string, files: string[]) => {
      for (const f of files) state.objects.delete(key(u, r, f));
    },
    storedMediaUrls: async () => new Map(),
    storeReviewMedia: async () => {},
  };
});

const OWNER = "4f1c1f2e-8e0e-4b9a-9d55-0d6c1b2a3c4d";
const OTHER = "9a8b7c6d-1111-4222-8333-444455556666";

let urlsRoute: typeof import("@/app/api/reviews/[id]/upload-urls/route");
let completeRoute: typeof import("@/app/api/reviews/[id]/upload-complete/route");
let reviews: typeof import("@/server/reviews");
let intake: typeof import("@/server/intake");

beforeAll(async () => {
  urlsRoute = await import("@/app/api/reviews/[id]/upload-urls/route");
  completeRoute = await import("@/app/api/reviews/[id]/upload-complete/route");
  reviews = await import("@/server/reviews");
  intake = await import("@/server/intake");
});

beforeEach(() => {
  state.user = { sub: OWNER, email: "maker@example.com" };
  state.objects.clear();
  state.issued.length = 0;
  state.headReads = 0;
  kick.mockClear();
});

const ctx = (id: string) => ({ params: Promise.resolve({ id }) }) as never;
const req = (id: string, route: string, body: unknown = {}) =>
  new Request(`https://panel.example.com/api/reviews/${id}/${route}`, { method: "POST", body: JSON.stringify(body) });

async function newReview(userId = OWNER) {
  const id = reviews.newReviewId();
  await reviews.createReview({ id, answers: [], intent: { category: "creator" }, board: ["mrbeast"], title: "test", userId });
  return id;
}
/** What the browser's PUTs to the signed URLs leave in storage. */
const store = (id: string, files: Map<string, Buffer>, userId = OWNER) => {
  for (const [f, b] of files) state.objects.set(`${userId}/${id}/${f}`, b);
};
const stored = (id: string) => [...state.objects.keys()].filter((k) => k.includes(`/${id}/`));

describe("getting upload URLs", () => {
  it("gives the review's owner one URL per prepared file, each for its own path", async () => {
    const id = await newReview();
    const res = await urlsRoute.POST(req(id, "upload-urls", { files: ["video.mp4", "poster.jpg", "frames/F001.jpg", "sprites/P000.jpg"] }), ctx(id));
    expect(res.status).toBe(200);
    const { urls } = await res.json();
    expect(urls["video.mp4"]).toContain(`/review-media/${OWNER}/${id}/video.mp4`);
    expect(state.issued).toHaveLength(4);
  });

  it("refuses someone signed out and another account, without making any", async () => {
    const id = await newReview();
    state.user = null;
    expect((await urlsRoute.POST(req(id, "upload-urls", { files: ["video.mp4", "poster.jpg"] }), ctx(id))).status).toBe(404);
    state.user = { sub: OTHER, email: "other@example.com" };
    expect((await urlsRoute.POST(req(id, "upload-urls", { files: ["video.mp4", "poster.jpg"] }), ctx(id))).status).toBe(404);
    expect(state.issued).toEqual([]);
  });

  it("refuses names a browser may not send, and a review that's already queued", async () => {
    const id = await newReview();
    expect((await urlsRoute.POST(req(id, "upload-urls", { files: ["video.mp4", "../other/video.mp4"] }), ctx(id))).status).toBe(400);
    expect((await urlsRoute.POST(req(id, "upload-urls", { files: ["video.mp4", "original.mov"] }), ctx(id))).status).toBe(400);
    await reviews.updateReview(id, { stage: "queued" });
    expect((await urlsRoute.POST(req(id, "upload-urls", { files: ["video.mp4", "poster.jpg"] }), ctx(id))).status).toBe(409);
    expect(state.issued).toEqual([]);
  });
});

describe("saying the upload is complete, and the runner's check", () => {
  it("queues a good set; the check reads only the MP4's head, then keeps every file and adds captions", async () => {
    const id = await newReview();
    const { manifest, files } = await makePrepared();
    store(id, files);
    const res = await completeRoute.POST(req(id, "upload-complete", manifest), ctx(id));
    expect(res.status).toBe(200);
    expect(kick).toHaveBeenCalled();
    expect(await intake.verifyUpload(id)).toBe("ready");
    expect(state.headReads).toBe(1);
    const r = await reviews.getReview(id);
    expect(r?.storedFiles).toEqual(expect.arrayContaining(["video.mp4", "poster.jpg", "captions.vtt", manifest.frames[0].file, manifest.sprites[0].file]));
    expect(state.objects.get(`${OWNER}/${id}/captions.vtt`)?.toString()).toContain("WEBVTT");
  });

  it("ends the review at once when the manifest is bad, removing what was sent", async () => {
    const id = await newReview();
    const { manifest, files } = await makePrepared();
    store(id, files);
    const shifted = { ...manifest, frames: manifest.frames.map((f, i) => (i === 3 ? { ...f, t: 7.9 } : f)) };
    const res = await completeRoute.POST(req(id, "upload-complete", shifted), ctx(id));
    expect(res.status).toBe(400);
    expect(await reviews.getReview(id)).toBeNull();
    expect(stored(id)).toEqual([]);
  });

  it("refuses a video declared over the size limit", async () => {
    const id = await newReview();
    const { manifest, files } = await makePrepared();
    store(id, files);
    const res = await completeRoute.POST(req(id, "upload-complete", { ...manifest, video: { ...manifest.video, bytes: 6 * 1024 * 1024 } }), ctx(id));
    expect(res.status).toBe(400);
    expect(await reviews.getReview(id)).toBeNull();
  });

  it("turns away extra, missing, resized or disguised files, removing everything", async () => {
    for (const spoil of ["extra", "missing", "size", "disguised", "horizontal-claim"] as const) {
      const id = await newReview();
      const { manifest, files } = await makePrepared();
      if (spoil === "missing") files.delete(manifest.sprites[0].file);
      if (spoil === "disguised") files.set("poster.jpg", Buffer.alloc(manifest.poster.bytes, 3));
      store(id, files);
      if (spoil === "extra") state.objects.set(`${OWNER}/${id}/frames/F999.jpg`, Buffer.from("x"));
      if (spoil === "size") state.objects.set(`${OWNER}/${id}/video.mp4`, Buffer.concat([files.get("video.mp4")!, Buffer.from("xx")]));
      const sent = spoil === "horizontal-claim" ? { ...manifest, video: { ...manifest.video, width: 720, height: 1300 } } : manifest;
      expect((await completeRoute.POST(req(id, "upload-complete", sent), ctx(id))).status).toBe(200);
      expect(await intake.verifyUpload(id)).toBe("rejected");
      expect(await reviews.getReview(id)).toMatchObject({ stage: "failed", stageDetail: intake.UPLOAD_REJECTED });
      expect(stored(id)).toEqual([]);
    }
  });

  it("leaves a review that already has its analysis alone", async () => {
    const id = await newReview();
    await reviews.updateReview(id, { stage: "reviewing", ledger: { shots: [], frames: [], transcript: [], audio: [], speechRate: [], loudness: [], perception: [], coverage: { durationSec: 1, width: 1, height: 2, framesAnalyzed: 0, sampling: "", transcript: "no_speech_detected", notes: [] } } });
    expect(await intake.verifyUpload(id)).toBe("not-needed");
  });
});
