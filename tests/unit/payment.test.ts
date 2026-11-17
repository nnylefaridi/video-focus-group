/**
 * Hosted mode: each account picks how it pays (prepaid credits or its own Anthropic
 * API key), the choice is remembered in Postgres, and the server, not the browser,
 * refuses a review the account's chosen way can't pay for. Real route handlers against
 * an in-process Postgres, with the Supabase session replaced by a stand-in (no network).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { nextQuestion, upsertAnswer, type Answer } from "@/core/questionnaire/engine";
import type { PaymentContext } from "@/server/billing";

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "panel-payment-"));
process.env.PANEL_MODE = "hosted";
process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_test";
process.env.HOSTED_PUBLIC_URL = "https://panel.example.com";
// Only checked for presence; nothing here calls Anthropic.
process.env.ANTHROPIC_API_KEY = "sk-ant-test-not-used";
process.env.PANEL_PEER_HEADER = "x-panel-peer-test";

const state = vi.hoisted(() => ({
  cookies: new Map<string, string>(),
  user: null as null | { sub: string; email: string },
  /** Stands in for a balance (Task 4) when a test needs a way that can pay. Own keys are tested for real in api-keys.test.ts. */
  canPay: null as null | PaymentContext,
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (state.cookies.has(name) ? { name, value: state.cookies.get(name)! } : undefined),
    getAll: () => [...state.cookies].map(([name, value]) => ({ name, value })),
    set: (name: string, value: string) => void state.cookies.set(name, value),
  }),
}));
vi.mock("next/server", async (importOriginal) => ({ ...(await importOriginal<typeof import("next/server")>()), connection: async () => {} }));
vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({ auth: { getClaims: async () => ({ data: state.user ? { claims: state.user } : null }) } }),
}));
vi.mock("@/server/billing", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/server/billing")>();
  return { ...real, getPaymentContext: async (userId: string) => state.canPay ?? real.getPaymentContext(userId) };
});

let billing: typeof import("@/server/billing");
let paymentRoute: typeof import("@/app/api/account/payment/route");
let reviewsRoute: typeof import("@/app/api/reviews/route");
let retryRoute: typeof import("@/app/api/reviews/[id]/retry/route");
let reviews: typeof import("@/server/reviews");
let db: typeof import("@/server/db");
let board: string[];

beforeAll(async () => {
  billing = await import("@/server/billing");
  paymentRoute = await import("@/app/api/account/payment/route");
  reviewsRoute = await import("@/app/api/reviews/route");
  retryRoute = await import("@/app/api/reviews/[id]/retry/route");
  reviews = await import("@/server/reviews");
  db = await import("@/server/db");
  const { liveProfiles } = await import("@/experts/load");
  board = [liveProfiles().find((p) => p.categories.includes("creator"))!.id];
});

beforeEach(() => {
  state.cookies.clear();
  state.user = null;
  state.canPay = null;
});

let n = 0;
/** A fresh account, signed in, on its own network so per-person limits don't interfere. */
function signIn() {
  n++;
  state.user = { sub: `4f1c1f2e-8e0e-4b9a-9d55-${String(n).padStart(12, "0")}`, email: `maker${n}@example.com` };
  return state.user.sub;
}

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
  new Request(`https://panel.example.com${url}`, { method: "POST", body: JSON.stringify(body), headers: { "x-panel-peer-test": `198.51.100.${100 + n}` } });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) }) as never;
const count = async (sql: string, params: unknown[] = []) => Number((await db.q<{ n: number }>(sql, params))[0].n);
const makeReview = () => reviewsRoute.POST(post("/api/reviews", { answers: answers(), board }));

describe("remembering the choice", () => {
  it("has none until the account picks, then keeps the latest pick in one row", async () => {
    const user = signIn();
    expect(await billing.getPaymentMethod(user)).toBeNull();
    await billing.setPaymentMethod(user, "credits");
    expect(await billing.getPaymentMethod(user)).toBe("credits");
    const first = (await db.q<{ updated_at: string }>("SELECT updated_at FROM app.account_billing WHERE user_id = $1", [user]))[0].updated_at;
    await new Promise((r) => setTimeout(r, 5));
    await billing.setPaymentMethod(user, "own_key");
    expect(await billing.getPaymentMethod(user)).toBe("own_key");
    const rows = await db.q<{ updated_at: string }>("SELECT updated_at FROM app.account_billing WHERE user_id = $1", [user]);
    expect(rows).toHaveLength(1);
    expect(Number(rows[0].updated_at)).toBeGreaterThan(Number(first));
  });

  it("is server-only: row level security on, and only the two ways are accepted", async () => {
    const rls = await db.q<{ on: boolean }>("SELECT relrowsecurity AS on FROM pg_class WHERE oid = 'app.account_billing'::regclass");
    expect(rls[0].on).toBe(true);
    await expect(db.q("INSERT INTO app.account_billing (user_id, payment_method, updated_at) VALUES ($1, 'free', 0)", [signIn()])).rejects.toThrow();
  });

  it("is saved through the route for the signed-in account only", async () => {
    const out = await paymentRoute.POST(post("/api/account/payment", { method: "credits" }));
    expect(out.status).toBe(401);
    expect((await out.json()).login).toBe(true);

    const user = signIn();
    expect((await paymentRoute.POST(post("/api/account/payment", { method: "free" }))).status).toBe(400);
    expect(await billing.getPaymentMethod(user)).toBeNull();

    const res = await paymentRoute.POST(post("/api/account/payment", { method: "own_key" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ method: "own_key", ready: false, problem: billing.NEEDS_KEY, key: null });
    expect(await (await paymentRoute.GET()).json()).toEqual({ method: "own_key", ready: false, problem: billing.NEEDS_KEY, key: null });
    expect(await billing.getPaymentMethod(user)).toBe("own_key");
  });
});

describe("making a review", () => {
  it("needs a choice first, and nothing is created or counted without one", async () => {
    signIn();
    const res = await makeReview();
    expect(res.status).toBe(402);
    expect(await res.json()).toEqual({ error: billing.CHOOSE_FIRST, payment: "choose" });
    expect(await count("SELECT COUNT(*)::int AS n FROM app.reviews WHERE user_id = $1", [state.user!.sub])).toBe(0);
    expect(await count("SELECT COUNT(*)::int AS n FROM app.usage")).toBe(0);
  });

  it("says honestly what's missing when the chosen way can't pay yet", async () => {
    const user = signIn();
    await billing.setPaymentMethod(user, "credits");
    let res = await makeReview();
    expect(res.status).toBe(402);
    expect(await res.json()).toEqual({ error: billing.NEEDS_CREDITS, payment: "credits" });

    await billing.setPaymentMethod(user, "own_key");
    res = await makeReview();
    expect(res.status).toBe(402);
    expect(await res.json()).toEqual({ error: billing.NEEDS_KEY, payment: "own_key" });
    expect(await count("SELECT COUNT(*)::int AS n FROM app.reviews WHERE user_id = $1", [user])).toBe(0);
  });

  it("uses the account's choice, not one the browser sends", async () => {
    const user = signIn();
    await billing.setPaymentMethod(user, "credits");
    const res = await reviewsRoute.POST(post("/api/reviews", { answers: answers(), board, payment: "own_key", method: "own_key" }));
    expect(res.status).toBe(402);
    expect((await res.json()).payment).toBe("credits");
  });

  it("goes ahead for the account once its way can pay", async () => {
    const user = signIn();
    state.canPay = { method: "credits", ready: true, problem: null, key: null };
    const res = await makeReview();
    expect(res.status).toBe(200);
    expect((await reviews.getReview((await res.json()).id))?.userId).toBe(user);
  });

  it("doesn't need the server's key when the account pays with its own", async () => {
    signIn();
    state.canPay = { method: "own_key", ready: true, problem: null, key: { last4: "abcd", savedAt: 1, rejected: false } };
    const key = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    try {
      expect((await makeReview()).status).toBe(200);
      state.canPay = { method: "credits", ready: true, problem: null, key: null };
      expect((await makeReview()).status).toBe(503);
    } finally {
      process.env.ANTHROPIC_API_KEY = key;
    }
  });
});

describe("running a failed review again", () => {
  it("is refused while the account's way can't pay", async () => {
    const user = signIn();
    await billing.setPaymentMethod(user, "credits");
    const id = reviews.newReviewId();
    await reviews.createReview({ id, answers: [], intent: { category: "creator" }, board, title: "t", userId: user });
    await reviews.updateReview(id, { stage: "failed" });
    const res = await retryRoute.POST(post(`/api/reviews/${id}/retry`, {}), ctx(id));
    expect(res.status).toBe(402);
    expect((await res.json()).error).toBe(billing.NEEDS_CREDITS);
    expect((await reviews.getReview(id))?.stage).toBe("failed");
  });
});
