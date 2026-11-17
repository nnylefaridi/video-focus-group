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
delete process.env.PANEL_MODE;
// Only checked for presence; nothing here calls Anthropic.
process.env.ANTHROPIC_API_KEY = "sk-ant-test-not-used";
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, getAll: () => [], set: () => {} }) }));

let auth: typeof import("@/server/auth");
let reviews: typeof import("@/server/reviews");
let budget: typeof import("@/server/budget");
let db: typeof import("@/server/db");

beforeAll(async () => {
  auth = await import("@/server/auth");
  reviews = await import("@/server/reviews");
  budget = await import("@/server/budget");
  db = await import("@/server/db");
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

  it("starts a review on the server's own key, with no payment choice asked or stored", async () => {
    const { POST } = await import("@/app/api/reviews/route");
    const { nextQuestion, upsertAnswer } = await import("@/core/questionnaire/engine");
    const { liveProfiles } = await import("@/experts/load");
    let answers: import("@/core/questionnaire/engine").Answer[] = [
      { questionId: "what", display: "A comedy skit", fields: { summary: "30s comedy skit about my cat", category: "creator", isComedy: true, format: "skit" } },
    ];
    for (let q = nextQuestion(answers); q; q = nextQuestion(answers)) {
      const o = q.answer.kind === "choice" ? q.answer.options[0] : null;
      answers = upsertAnswer(answers, o ? { questionId: q.id, display: o.label, fields: o.set } : { questionId: q.id, display: "text", fields: Object.fromEntries(q.fills.map((k) => [k, "text"])) });
    }
    const board = [liveProfiles().find((p) => p.categories.includes("creator"))!.id];
    const res = await POST(new Request("http://127.0.0.1:3000/api/reviews", { method: "POST", body: JSON.stringify({ answers, board }) }));
    expect(res.status).toBe(200);
    const made = await reviews.getReview((await res.json()).id);
    expect(made).toBeTruthy();
    expect(made!.paidWith).toBeNull();
    expect((await db.q("SELECT 1 FROM app.account_billing")).length).toBe(0);
  });

  it("has no own API key to save, and runs every review on the server's key", async () => {
    const key = await import("@/app/api/account/key/route");
    const put = new Request("http://127.0.0.1:3000/api/account/key", { method: "PUT", body: '{"key":"sk-ant-api03-abcdefghijklmnopqrstuvwxyz"}' });
    expect((await key.PUT(put)).status).toBe(404);
    expect((await key.DELETE()).status).toBe(404);
    expect((await db.q("SELECT 1 FROM app.api_keys")).length).toBe(0);
    const { reviewKey } = await import("@/server/apikeys");
    const id = reviews.newReviewId();
    await reviews.createReview({ id, answers: [], intent: {}, board: [], title: "t", paidWith: "own_key", userId: "4f1c1f2e-8e0e-4b9a-9d55-000000000001" });
    expect(await reviewKey(id)).toEqual({ kind: "server", paidWith: null });
  });

  it("has no payment choice to make", async () => {
    const payment = await import("@/app/api/account/payment/route");
    expect((await payment.POST(new Request("http://127.0.0.1:3000/api/account/payment", { method: "POST", body: '{"method":"credits"}' }))).status).toBe(404);
    expect((await db.q("SELECT 1 FROM app.account_billing")).length).toBe(0);
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
