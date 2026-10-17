/**
 * Local mode: no Supabase settings, one person on their own computer. No sign-in,
 * every review on this computer is theirs, and limit messages don't mention logging in.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "panel-local-"));
process.env.MAX_REVIEWS_PER_DAY = "1";
delete process.env.NEXT_PUBLIC_SUPABASE_URL;
delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, getAll: () => [], set: () => {} }) }));

let auth: typeof import("@/server/auth");
let reviews: typeof import("@/server/reviews");
let budget: typeof import("@/server/budget");

beforeAll(async () => {
  auth = await import("@/server/auth");
  reviews = await import("@/server/reviews");
  budget = await import("@/server/budget");
});

describe("local mode", () => {
  it("has accounts off", () => {
    expect(auth.authReady).toBe(false);
  });

  it("opens and lists every review on this computer, whoever's browser made it", async () => {
    const id = reviews.newReviewId();
    await reviews.createReview({ id, answers: [], intent: { category: "creator" }, board: ["mrbeast"], title: "mine", anonId: "x".repeat(32) });
    expect((await auth.accessibleReview(id))?.review.id).toBe(id);
    expect((await reviews.listReviewsFor(null)).map((r) => r.id)).toContain(id);
  });

  it("explains a limit without offering a login that doesn't exist", async () => {
    const who = { person: "net", network: "net", signedIn: false };
    const start = () => budget.startReview(who, { id: reviews.newReviewId(), answers: [], intent: {}, board: [], title: "t", userId: null, anonId: null });
    await start();
    const e = await start().catch((x) => x);
    expect(e.message).toMatch(/daily limit/);
    expect(e.loginHelps).toBe(false);
  });
});
