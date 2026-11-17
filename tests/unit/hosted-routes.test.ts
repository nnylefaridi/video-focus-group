/**
 * Hosted mode refuses anything paid for someone who isn't signed in: making a review,
 * uploading its video, running it again, or asking a reviewer. Signed in, a review is
 * made for the account. Runs the real route handlers against an in-process Postgres,
 * with the Supabase session replaced by a stand-in (no network).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { nextQuestion, upsertAnswer, type Answer } from "@/core/questionnaire/engine";

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "panel-hosted-routes-"));
process.env.PANEL_MODE = "hosted";
process.env.MEDIA_SECRET = Buffer.alloc(32, 9).toString("base64");
process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_test";
process.env.HOSTED_PUBLIC_URL = "https://panel.example.com";
// Only checked for presence; nothing here calls Anthropic.
process.env.ANTHROPIC_API_KEY = "sk-ant-test-not-used";
process.env.CLIENT_IP_HEADER = "x-panel-peer-test";
// Waking the runner needs a request to run after; runner.test.ts covers the runner itself.
vi.mock("@/server/kick", () => ({ kickAfterResponse: () => {}, kickNow: () => {}, kickIfUnattended: () => {} }));

const state = vi.hoisted(() => ({ cookies: new Map<string, string>(), user: null as null | { sub: string; email: string } }));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (state.cookies.has(name) ? { name, value: state.cookies.get(name)! } : undefined),
    getAll: () => [...state.cookies].map(([name, value]) => ({ name, value })),
    set: (name: string, value: string) => void state.cookies.set(name, value),
  }),
}));
vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({ auth: { getClaims: async () => ({ data: state.user ? { claims: state.user } : null }) } }),
}));
// Signed in, the account can pay (here with its own key, so no credit balance is needed);
// choosing how is covered in payment.test.ts, credits in credits.test.ts.
vi.mock("@/server/billing", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/billing")>()),
  getPaymentContext: async () => ({ method: "own_key", ready: true, problem: null, key: { last4: "abcd", savedAt: 1, rejected: false } }),
}));

let reviewsRoute: typeof import("@/app/api/reviews/route");
let filesRoute: typeof import("@/app/api/reviews/[id]/files/[...file]/route");
let retryRoute: typeof import("@/app/api/reviews/[id]/retry/route");
let chatRoute: typeof import("@/app/api/reviews/[id]/chat/route");
let reviews: typeof import("@/server/reviews");
let auth: typeof import("@/server/auth");
let db: typeof import("@/server/db");
let board: string[];

beforeAll(async () => {
  reviewsRoute = await import("@/app/api/reviews/route");
  filesRoute = await import("@/app/api/reviews/[id]/files/[...file]/route");
  retryRoute = await import("@/app/api/reviews/[id]/retry/route");
  chatRoute = await import("@/app/api/reviews/[id]/chat/route");
  reviews = await import("@/server/reviews");
  auth = await import("@/server/auth");
  db = await import("@/server/db");
  const { liveProfiles } = await import("@/experts/load");
  board = [liveProfiles().find((p) => p.categories.includes("creator"))!.id];
});

const ANON = "a".repeat(32);
beforeEach(() => {
  state.cookies.clear();
  state.user = null;
});

/** A finished set of answers, as the flow would send it. */
function answers(): Answer[] {
  let list: Answer[] = [{ questionId: "what", display: "A comedy skit", fields: { summary: "30s comedy skit about my cat", category: "creator", isComedy: true, format: "skit" } }];
  for (let q = nextQuestion(list); q; q = nextQuestion(list)) {
    const a: Answer =
      q.answer.kind === "choice"
        ? { questionId: q.id, display: q.answer.options[0].label, fields: q.answer.options[0].set }
        : { questionId: q.id, display: "text", fields: Object.fromEntries(q.fills.map((k) => [k, "text"])) };
    list = upsertAnswer(list, a);
  }
  return list;
}

const post = (url: string, body: unknown) =>
  new Request(`https://panel.example.com${url}`, { method: "POST", body: JSON.stringify(body), headers: { "x-panel-peer-test": "198.51.100.30" } });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) }) as never;
const count = async (sql: string) => Number((await db.q<{ n: number }>(sql))[0].n);

describe("hosted mode, signed out", () => {
  it("refuses to make a review, and nothing is created or counted", async () => {
    const res = await reviewsRoute.POST(post("/api/reviews", { answers: answers(), board }));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Log in to send your video to the board.", login: true });
    expect(await count("SELECT COUNT(*)::int AS n FROM app.reviews")).toBe(0);
    expect(await count("SELECT COUNT(*)::int AS n FROM app.usage")).toBe(0);
    expect(state.cookies.has("panel_anon")).toBe(false);
  });

  it("refuses an upload, a retry and a follow-up, even on this browser's own review from before", async () => {
    state.cookies.set("panel_anon", ANON);
    const id = reviews.newReviewId();
    await reviews.createReview({ id, answers: [], intent: { category: "creator" }, board, title: "old", anonId: ANON });

    const up = await filesRoute.PUT(new Request(`https://panel.example.com/api/reviews/${id}/files/video.mp4`, { method: "PUT", body: "not a video" }), { params: Promise.resolve({ id, file: ["video.mp4"] }) });
    expect(up.status).toBe(401);
    expect((await up.json()).login).toBe(true);
    expect((await reviews.getReview(id))?.stage).toBe("uploading");

    await reviews.updateReview(id, { stage: "failed" });
    const retry = await retryRoute.POST(post(`/api/reviews/${id}/retry`, {}), ctx(id));
    expect(retry.status).toBe(401);
    expect((await reviews.getReview(id))?.stage).toBe("failed");

    const chat = await chatRoute.POST(post(`/api/reviews/${id}/chat`, { reviewerId: board[0], message: "Why?" }), ctx(id));
    expect(chat.status).toBe(401);
    expect(await count("SELECT COUNT(*)::int AS n FROM app.usage WHERE kind = 'followup'")).toBe(0);
  });
});

describe("hosted mode, signed in", () => {
  it("refuses the through-the-server upload, pointing to the direct one", async () => {
    state.user = { sub: "4f1c1f2e-8e0e-4b9a-9d55-0d6c1b2a3c4d", email: "maker@example.com" };
    const id = reviews.newReviewId();
    await reviews.createReview({ id, answers: [], intent: { category: "creator" }, board, title: "t", userId: state.user.sub });
    const res = await filesRoute.PUT(new Request(`https://panel.example.com/api/reviews/${id}/files/video.mp4`, { method: "PUT", body: "x" }), { params: Promise.resolve({ id, file: ["video.mp4"] }) });
    expect(res.status).toBe(410);
    expect((await res.json()).error).toMatch(/straight to storage/);
    expect((await reviews.getReview(id))?.stage).toBe("uploading");
  });

  it("makes the review for the account", async () => {
    state.user = { sub: "4f1c1f2e-8e0e-4b9a-9d55-0d6c1b2a3c4d", email: "maker@example.com" };
    const res = await reviewsRoute.POST(post("/api/reviews", { answers: answers(), board }));
    expect(res.status).toBe(200);
    const { id } = await res.json();
    const r = await reviews.getReview(id);
    expect(r?.userId).toBe(state.user.sub);
    expect(r?.anonId).toBeNull();
  });
});

describe("who must sign in first", () => {
  it("is signed-out visitors in hosted mode only; local mode never asks", () => {
    expect(auth.mustSignIn({ userId: null })).toBe(true);
    expect(auth.mustSignIn({ userId: "u1" })).toBe(false);
    process.env.PANEL_MODE = "local";
    try {
      expect(auth.mustSignIn({ userId: null })).toBe(false);
    } finally {
      process.env.PANEL_MODE = "hosted";
    }
  });
});
