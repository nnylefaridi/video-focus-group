/**
 * Hosted mode: accounts that pay with their own Anthropic API key. The key is checked
 * with Anthropic before it's saved, stored encrypted (AES-256-GCM), never sent back
 * beyond its last 4 characters, and used for every paid call of that account's reviews.
 * Real route handlers against an in-process Postgres; the Anthropic SDK and the
 * Supabase session are replaced by stand-ins, so nothing here touches the network.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { inspect } from "node:util";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import Anthropic from "@anthropic-ai/sdk";
import { nextQuestion, upsertAnswer, type Answer } from "@/core/questionnaire/engine";

const SECRET = Buffer.alloc(32, 9).toString("base64");
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "panel-keys-"));
process.env.PANEL_MODE = "hosted";
process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_test";
process.env.HOSTED_PUBLIC_URL = "https://panel.example.com";
process.env.KEY_ENCRYPTION_SECRET = SECRET;
process.env.ANTHROPIC_API_KEY = "sk-ant-server-key-for-tests-0000";
process.env.PANEL_PEER_HEADER = "x-panel-peer-test";
process.env.MAX_KEY_CHECKS_PER_HOUR = "3";
process.env.MAX_REVIEWS_PER_DAY = "2";

const state = vi.hoisted(() => ({
  cookies: new Map<string, string>(),
  user: null as null | { sub: string; email: string },
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

/** Stands in for Anthropic: records every client made, and answers models.list and messages.stream as each test says. */
const sdk = vi.hoisted(() => ({
  clients: [] as { apiKey: unknown; authToken: unknown; timeout: unknown; maxRetries: unknown }[],
  listCalls: 0,
  list: (async () => ({ data: [] })) as () => Promise<unknown>,
  finalMessage: null as null | (() => Promise<unknown>),
}));
vi.mock("@anthropic-ai/sdk", async (importOriginal) => {
  const real = await importOriginal<typeof import("@anthropic-ai/sdk")>();
  class FakeAnthropic extends real.default {
    constructor(opts?: ConstructorParameters<typeof real.default>[0]) {
      super(opts);
      sdk.clients.push({ apiKey: opts?.apiKey, authToken: opts?.authToken, timeout: opts?.timeout, maxRetries: opts?.maxRetries });
      Object.assign(this, {
        models: { list: () => (sdk.listCalls++, sdk.list()) },
        beta: {
          messages: {
            stream: () => ({
              finalMessage: () => (sdk.finalMessage ?? okMessage)(),
              async *[Symbol.asyncIterator]() {
                yield { type: "content_block_delta", delta: { type: "text_delta", text: "Sure." } };
              },
            }),
          },
        },
      });
    }
  }
  const okMessage = async () => ({
    content: [],
    usage: { input_tokens: 1000, output_tokens: 100, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
    stop_reason: "end_turn",
    parsed_output: { ok: true },
  });
  return { ...real, default: FakeAnthropic };
});

let vault: typeof import("@/server/keyvault");
let keys: typeof import("@/server/apikeys");
let billing: typeof import("@/server/billing");
let ai: typeof import("@/ai/client");
let keyRoute: typeof import("@/app/api/account/key/route");
let paymentRoute: typeof import("@/app/api/account/payment/route");
let reviewsRoute: typeof import("@/app/api/reviews/route");
let retryRoute: typeof import("@/app/api/reviews/[id]/retry/route");
let reviews: typeof import("@/server/reviews");
let db: typeof import("@/server/db");
let budget: typeof import("@/server/budget");
let credits: typeof import("@/server/credits");
let board: string[];

beforeAll(async () => {
  credits = await import("@/server/credits");
  vault = await import("@/server/keyvault");
  keys = await import("@/server/apikeys");
  billing = await import("@/server/billing");
  ai = await import("@/ai/client");
  keyRoute = await import("@/app/api/account/key/route");
  paymentRoute = await import("@/app/api/account/payment/route");
  reviewsRoute = await import("@/app/api/reviews/route");
  retryRoute = await import("@/app/api/reviews/[id]/retry/route");
  reviews = await import("@/server/reviews");
  db = await import("@/server/db");
  budget = await import("@/server/budget");
  const { liveProfiles } = await import("@/experts/load");
  board = [liveProfiles().find((p) => p.categories.includes("creator"))!.id];
});

beforeEach(() => {
  state.cookies.clear();
  state.user = null;
  sdk.clients.length = 0;
  sdk.listCalls = 0;
  sdk.list = async () => ({ data: [] });
  sdk.finalMessage = null;
});

let n = 0;
/** A fresh account, signed in, on its own network. */
function signIn() {
  n++;
  state.user = { sub: `7a2d9c4e-1b3f-4c5d-8e6f-${String(n).padStart(12, "0")}`, email: `maker${n}@example.com` };
  return state.user.sub;
}
const keyFor = (tag: string) => `sk-ant-api03-${tag.padEnd(40, "x")}${tag.slice(-4).padStart(4, "0")}`;

const req = (url: string, method: string, body?: unknown) =>
  new Request(`https://panel.example.com${url}`, {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: { "x-panel-peer-test": `203.0.113.${n % 250}` },
  });
const putKey = (key: string) => keyRoute.PUT(req("/api/account/key", "PUT", { key }));
const ctx = (id: string) => ({ params: Promise.resolve({ id }) }) as never;
const apiError = (Cls: unknown, status: number, message: string) =>
  new (Cls as new (s: number, e: object, m: string, h: Headers) => Error)(status, { type: "error", error: { message } }, message, new Headers());

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

/** An account paying with its own saved key, and a review of theirs started on it. */
async function ownKeyReview(tag: string) {
  const userId = signIn();
  const key = keyFor(tag);
  await billing.setPaymentMethod(userId, "own_key");
  await keys.saveKey(userId, key);
  const id = reviews.newReviewId();
  await reviews.createReview({ id, answers: [], intent: { category: "creator" }, board, title: "t", userId, paidWith: "own_key" });
  return { userId, key, id };
}
/** A credits account needs credit before a credits review can start (credits.test.ts covers how it's bought). */
async function giveCredit(userId: string) {
  await db.tx((t) => credits.creditTopup(t, { userId, sessionId: `cs_test_${userId}`, paymentIntent: null, amountCents: 2500, eventId: `evt_${userId}`, pack: "usd25" }));
  return userId;
}
const call = (reviewId: string | null = null) => ai.callStructured({ label: "test", reviewId, model: ai.MODELS.fast, system: "s", messages: [{ role: "user", content: "hi" }], schema: z.object({ ok: z.boolean() }) });

describe("encrypting keys at rest", () => {
  it("opens what it sealed, with a fresh 12-byte IV, a 16-byte tag and the key version each time", () => {
    const a = vault.seal("sk-ant-api03-secret", "user-1");
    const b = vault.seal("sk-ant-api03-secret", "user-1");
    expect(vault.unseal(a, "user-1")).toBe("sk-ant-api03-secret");
    expect(vault.unseal(b, "user-1")).toBe("sk-ant-api03-secret");
    expect(a.version).toBe(1);
    expect(Buffer.from(a.iv, "base64")).toHaveLength(12);
    expect(Buffer.from(a.tag, "base64")).toHaveLength(16);
    expect(a.iv).not.toBe(b.iv);
    expect(a.ciphertext).not.toBe(b.ciphertext);
    expect(JSON.stringify(a)).not.toContain("secret");
  });

  it("refuses anything that was changed, moved to another account, or sealed with another secret", () => {
    const s = vault.seal("sk-ant-api03-secret", "user-1");
    const flip = (b64: string) => {
      const buf = Buffer.from(b64, "base64");
      buf[0] ^= 1;
      return buf.toString("base64");
    };
    expect(() => vault.unseal({ ...s, ciphertext: flip(s.ciphertext) }, "user-1")).toThrow();
    expect(() => vault.unseal({ ...s, tag: flip(s.tag) }, "user-1")).toThrow();
    expect(() => vault.unseal({ ...s, iv: flip(s.iv) }, "user-1")).toThrow();
    expect(() => vault.unseal(s, "user-2")).toThrow();
    expect(() => vault.unseal({ ...s, version: 2 }, "user-1")).toThrow(vault.KeyVaultUnavailable);
    process.env.KEY_ENCRYPTION_SECRET = Buffer.alloc(32, 1).toString("base64");
    try {
      expect(() => vault.unseal(s, "user-1")).toThrow();
    } finally {
      process.env.KEY_ENCRYPTION_SECRET = SECRET;
    }
  });

  it("fails clearly without a usable KEY_ENCRYPTION_SECRET", () => {
    for (const v of [undefined, "too-short"]) {
      if (v === undefined) delete process.env.KEY_ENCRYPTION_SECRET;
      else process.env.KEY_ENCRYPTION_SECRET = v;
      try {
        expect(() => vault.seal("k", "u")).toThrow(/KEY_ENCRYPTION_SECRET isn't set.*openssl rand -base64 32/);
      } finally {
        process.env.KEY_ENCRYPTION_SECRET = SECRET;
      }
    }
  });

  it("never keeps the key in the clear, and the table is server-only", async () => {
    const user = signIn();
    const key = keyFor("cleartext");
    expect((await putKey(key)).status).toBe(200);
    const rows = await db.q("SELECT * FROM app.api_keys WHERE user_id = $1", [user]);
    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows)).not.toContain(key);
    expect(JSON.stringify(rows)).not.toContain(key.slice(0, -4));
    expect(rows[0].last4).toBe(key.slice(-4));
    expect(Number(rows[0].key_version)).toBe(1);
    const rls = await db.q<{ on: boolean }>("SELECT relrowsecurity AS on FROM pg_class WHERE oid = 'app.api_keys'::regclass");
    expect(rls[0].on).toBe(true);
  });

  it("shows a decrypted key only through reveal(), never when printed or serialized", () => {
    const k = new keys.SecretKey("sk-ant-api03-very-secret-abcd");
    expect(k.reveal()).toBe("sk-ant-api03-very-secret-abcd");
    for (const shown of [JSON.stringify({ k }), String(k), `${k}`, inspect(k), inspect({ nested: { k } })]) {
      expect(shown).not.toContain("very-secret");
      expect(shown).toContain("abcd");
    }
  });
});

describe("saving a key", () => {
  it("needs sign-in", async () => {
    const res = await putKey(keyFor("nobody"));
    expect(res.status).toBe(401);
    expect((await res.json()).login).toBe(true);
    expect(sdk.listCalls).toBe(0);
  });

  it("checks the key with a free models list call on that key, with a short timeout, before saving it", async () => {
    const user = signIn();
    const key = keyFor("checked");
    const res = await putKey(key);
    expect(res.status).toBe(200);
    expect(sdk.listCalls).toBe(1);
    expect(sdk.clients.at(-1)).toEqual({ apiKey: key, authToken: null, timeout: 10_000, maxRetries: 0 });
    expect(await billing.getPaymentMethod(user)).toBeNull();
    expect(await keys.getKeyInfo(user)).toMatchObject({ last4: key.slice(-4), rejected: false });
  });

  it("sends back only the last 4 characters and the saved date, everywhere", async () => {
    const user = signIn();
    await billing.setPaymentMethod(user, "own_key");
    const key = keyFor("private");
    const saved = await putKey(key);
    const text = await saved.text();
    const body = JSON.parse(text);
    expect(Object.keys(body.key).sort()).toEqual(["last4", "rejected", "savedAt"]);
    expect(body.key.last4).toBe(key.slice(-4));
    expect(body.key.savedAt).toBeGreaterThan(Date.now() - 60_000);
    expect(body.payment).toMatchObject({ method: "own_key", ready: true, problem: null });
    const shown = [text, await (await keyRoute.GET()).text(), await (await paymentRoute.GET()).text()];
    for (const s of shown) {
      expect(s).not.toContain(key);
      expect(s).not.toContain(key.slice(0, -4));
    }
    expect(JSON.parse(shown[1]).key.last4).toBe(key.slice(-4));
  });

  it("saves nothing when Anthropic turns the key down, and says why in plain words", async () => {
    const cases: [() => Error, RegExp][] = [
      [() => apiError(Anthropic.AuthenticationError, 401, "invalid x-api-key"), /didn't accept that key/],
      [() => apiError(Anthropic.PermissionDeniedError, 403, "forbidden"), /isn't allowed to use Anthropic's models/],
      [() => new Anthropic.APIConnectionError({ message: "Connection error." }), /Couldn't reach Anthropic/],
      [() => new Anthropic.APIConnectionTimeoutError(), /took too long/],
      [() => apiError(Anthropic.InternalServerError, 500, "boom"), /having trouble/],
    ];
    for (const [error, message] of cases) {
      const user = signIn();
      sdk.list = async () => {
        throw error();
      };
      const key = keyFor(`bad${user.slice(-3)}`);
      const res = await putKey(key);
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toMatch(message);
      expect(JSON.stringify(body)).not.toContain(key);
      expect(await keys.getKeyInfo(user)).toBeNull();
    }
  });

  it("keeps the old key when a replacement fails its check", async () => {
    const user = signIn();
    const first = keyFor("first");
    await putKey(first);
    sdk.list = async () => {
      throw apiError(Anthropic.AuthenticationError, 401, "invalid x-api-key");
    };
    expect((await putKey(keyFor("second"))).status).toBe(400);
    expect((await keys.getKeyInfo(user))?.last4).toBe(first.slice(-4));
  });

  it("turns away something that isn't a key without asking Anthropic", async () => {
    signIn();
    for (const bad of ["", "   ", "sk-ant short", "abc"]) {
      const res = await putKey(bad);
      expect(res.status).toBe(400);
    }
    expect((await keyRoute.PUT(req("/api/account/key", "PUT", { nope: 1 }))).status).toBe(400);
    expect(sdk.listCalls).toBe(0);
  });

  it("replaces the key in the one row, and removes it completely", async () => {
    const user = signIn();
    await billing.setPaymentMethod(user, "own_key");
    await putKey(keyFor("old1"));
    const next = keyFor("new2");
    const res = await putKey(next);
    expect((await res.json()).key.last4).toBe(next.slice(-4));
    expect(await db.q("SELECT 1 FROM app.api_keys WHERE user_id = $1", [user])).toHaveLength(1);

    const del = await keyRoute.DELETE();
    expect(del.status).toBe(200);
    expect(await del.json()).toMatchObject({ key: null, payment: { method: "own_key", ready: false, problem: billing.NEEDS_KEY } });
    expect(await db.q("SELECT 1 FROM app.api_keys WHERE user_id = $1", [user])).toHaveLength(0);
    expect((await (await keyRoute.GET()).json()).key).toBeNull();
  });

  it("limits tries per account, counting the ones that failed", async () => {
    signIn();
    sdk.list = async () => {
      throw apiError(Anthropic.AuthenticationError, 401, "invalid x-api-key");
    };
    for (let i = 0; i < 3; i++) expect((await putKey(keyFor(`try${i}`))).status).toBe(400);
    sdk.list = async () => ({ data: [] });
    const res = await putKey(keyFor("try4"));
    expect(res.status).toBe(429);
    expect((await res.json()).error).toMatch(/too many times/);
    expect(sdk.listCalls).toBe(3);
    // Another account has its own tries.
    signIn();
    expect((await putKey(keyFor("other"))).status).toBe(200);
  });
});

describe("running reviews on the owner's key", () => {
  it("makes the account ready to start a review, recorded as paid with its own key", async () => {
    const user = signIn();
    await billing.setPaymentMethod(user, "own_key");
    let res = await reviewsRoute.POST(req("/api/reviews", "POST", { answers: answers(), board }));
    expect(res.status).toBe(402);
    expect((await res.json()).error).toBe(billing.NEEDS_KEY);
    await putKey(keyFor("ready"));
    res = await reviewsRoute.POST(req("/api/reviews", "POST", { answers: answers(), board }));
    expect(res.status).toBe(200);
    expect((await reviews.getReview((await res.json()).id))?.paidWith).toBe("own_key");
  });

  it("uses the review owner's key for its paid calls, and the server's key for everything else", async () => {
    const a = await ownKeyReview("alice");
    const b = await ownKeyReview("bobby");
    sdk.clients.length = 0;
    await ai.checkReviewKey(a.id);
    await call(a.id);
    expect(sdk.clients.at(-1)).toMatchObject({ apiKey: a.key, authToken: null });
    await call(b.id);
    expect(sdk.clients.at(-1)).toMatchObject({ apiKey: b.key, authToken: null });
    expect(sdk.clients.map((c) => c.apiKey)).not.toContain(process.env.ANTHROPIC_API_KEY);

    // An answer check (no review) and a review on the server's key never see an own key.
    const before = sdk.clients.length;
    await call();
    const serverReview = reviews.newReviewId();
    await reviews.createReview({ id: serverReview, answers: [], intent: {}, board, title: "t", userId: a.userId, paidWith: null });
    await call(serverReview);
    expect(sdk.clients.slice(before).every((c) => c.apiKey === undefined)).toBe(true);
  });

  it("still applies and records the spending caps, without charging anything else", async () => {
    const { id } = await ownKeyReview("capped");
    await call(id);
    const spend = await db.q<{ n: number }>("SELECT COUNT(*)::int AS n FROM app.spend WHERE review_id = $1", [id]);
    expect(Number(spend[0].n)).toBe(1);
    expect((await reviews.getReview(id))!.cost.usd).toBeGreaterThan(0);
    await reviews.addCost(id, { label: "big", model: ai.MODELS.deep, usd: 100, inTok: 0, outTok: 0 });
    await expect(call(id)).rejects.toBeInstanceOf(ai.BudgetExceeded);
  });

  it("stops a review whose key was removed, saying so", async () => {
    const { userId, id } = await ownKeyReview("removed");
    await keys.deleteKey(userId);
    sdk.clients.length = 0;
    await expect(ai.checkReviewKey(id)).rejects.toThrow(keys.KEY_REMOVED);
    await expect(call(id)).rejects.toBeInstanceOf(ai.AiUnavailable);
    expect(sdk.clients).toHaveLength(0);
  });

  it("fails a review whose key Anthropic rejects, and lets it run again once the key is replaced", async () => {
    const { userId, key, id } = await ownKeyReview("rejected");
    sdk.finalMessage = async () => {
      throw apiError(Anthropic.AuthenticationError, 401, "invalid x-api-key");
    };
    const e = await call(id).catch((x) => x);
    expect(e).toBeInstanceOf(ai.AiUnavailable);
    expect(e.message).toBe(keys.KEY_REJECTED);
    expect(e.message).not.toContain(key);
    expect(await keys.getKeyInfo(userId)).toMatchObject({ rejected: true });
    await expect(ai.checkReviewKey(id)).rejects.toThrow(keys.KEY_REJECTED);

    await reviews.updateReview(id, { stage: "failed", error: e.message });
    let retry = await retryRoute.POST(req(`/api/reviews/${id}/retry`, "POST", {}), ctx(id));
    expect(retry.status).toBe(402);
    expect((await retry.json()).error).toBe(keys.KEY_REJECTED);

    sdk.finalMessage = null;
    const fixed = keyFor("fixedkey");
    expect((await putKey(fixed)).status).toBe(200);
    retry = await retryRoute.POST(req(`/api/reviews/${id}/retry`, "POST", {}), ctx(id));
    expect(retry.status).toBe(200);
    expect((await reviews.getReview(id))?.stage).toBe("queued");
    await call(id);
    expect(sdk.clients.at(-1)).toMatchObject({ apiKey: fixed });
  });

  it("fails clearly when the saved key can't be decrypted", async () => {
    const { id } = await ownKeyReview("unreadable");
    process.env.KEY_ENCRYPTION_SECRET = Buffer.alloc(32, 3).toString("base64");
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await expect(call(id)).rejects.toThrow(keys.KEY_UNREADABLE);
      expect(log.mock.calls.flat().join(" ")).not.toContain("sk-ant");
    } finally {
      process.env.KEY_ENCRYPTION_SECRET = SECRET;
      log.mockRestore();
    }
  });
});

describe("spending caps for reviews on their own key", () => {
  const who = (userId: string) => ({ person: `user:${userId}`, network: `net:${userId}`, signedIn: true });
  const start = (userId: string, paidWith: "own_key" | "credits" | null) =>
    budget.startReview(who(userId), { id: reviews.newReviewId(), answers: [], intent: {}, board, title: "t", userId, anonId: null, paidWith });

  it("records own-key spend as own_key, without using up the app's budget that protects the server's key", async () => {
    const { userId, id } = await ownKeyReview("bigspender");
    // One own-key call costing more than the app's whole monthly budget ($20 at fast-model prices).
    sdk.finalMessage = async () => ({ content: [], usage: { input_tokens: 200_000_000, output_tokens: 0 }, stop_reason: "end_turn", parsed_output: { ok: true } });
    await call(id);
    sdk.finalMessage = null;
    const rows = await db.q<{ paid_with: string; usd: number }>("SELECT paid_with::text AS paid_with, usd FROM app.spend WHERE review_id = $1", [id]);
    expect(rows).toEqual([{ paid_with: "own_key", usd: expect.any(Number) }]);
    expect(Number(rows[0].usd)).toBeGreaterThanOrEqual(20);
    expect(await budget.ownKeySpendThisMonth()).toBeGreaterThanOrEqual(20);
    expect((await budget.spendSummary()).month).toBeLessThan(20);

    // The server's key still has its budget: answer checks and credits reviews go ahead.
    await expect(budget.assertWithinSpendLimits()).resolves.toBeTruthy();
    await expect(call()).resolves.toEqual({ ok: true });
    await expect(start(await giveCredit(signIn()), "credits")).resolves.toBeUndefined();

    // This review's own cost cap still applies to it.
    await expect(call(id)).rejects.toBeInstanceOf(ai.BudgetExceeded);
    // And so does the account's daily review limit (2 in this file).
    await start(userId, "own_key");
    await start(userId, "own_key");
    await expect(start(userId, "own_key")).rejects.toThrow(/daily limit/);
  });

  it("tags server-key calls with how their review is paid, and keeps the app's caps on them only", async () => {
    const user = await giveCredit(signIn());
    const creditsReview = reviews.newReviewId();
    await reviews.createReview({ id: creditsReview, answers: [], intent: {}, board, title: "t", userId: user, paidWith: "credits" });
    // A credits review's calls run on credit set aside for it, as the worker does.
    const reservation = await credits.reserve(user, creditsReview, "review");
    const callOnCredit = () => credits.onReservation(reservation, () => call(creditsReview));
    await callOnCredit();
    expect((await db.q<{ p: string }>("SELECT paid_with::text AS p FROM app.spend WHERE review_id = $1", [creditsReview]))[0].p).toBe("credits");

    const own = await ownKeyReview("stillgoing");
    await budget.recordSpend({ label: "test-global-cap", model: ai.MODELS.fast, usd: 1000, paidWith: null });
    try {
      // The server's key is out of budget...
      await expect(call()).rejects.toBeInstanceOf(ai.BudgetExceeded);
      await expect(callOnCredit()).rejects.toBeInstanceOf(ai.BudgetExceeded);
      await expect(start(await giveCredit(signIn()), "credits")).rejects.toThrow(/budget/);
      await expect(budget.spendFollowup(who(user), creditsReview)).rejects.toThrow(/budget/);
      // ...but reviews and follow-ups on someone's own key don't use it, and set no credit aside.
      await expect(call(own.id)).resolves.toEqual({ ok: true });
      await expect(start(signIn(), "own_key")).resolves.toBeUndefined();
      await expect(budget.spendFollowup(who(own.userId), own.id)).resolves.toBeNull();
    } finally {
      await db.q("DELETE FROM app.spend WHERE label = 'test-global-cap'");
    }
  });
});

describe("every paid call for a review goes through the review's key", () => {
  it("runs follow-up chat on the owner's key", async () => {
    const { key, id } = await ownKeyReview("chatty");
    sdk.clients.length = 0;
    const out: unknown[] = [];
    for await (const ev of ai.streamText({ label: "followup:x", reviewId: id, model: ai.MODELS.deep, system: "s", messages: [{ role: "user", content: "why?" }] })) out.push(ev);
    expect(out[0]).toEqual({ type: "text", text: "Sure." });
    expect(sdk.clients).toHaveLength(1);
    expect(sdk.clients[0]).toMatchObject({ apiKey: key, authToken: null });
    expect((await db.q<{ p: string }>("SELECT paid_with::text AS p FROM app.spend WHERE review_id = $1", [id]))[0].p).toBe("own_key");
  });

  it("makes Anthropic clients in only two places: the per-review client and the key check", () => {
    const ROOT = path.resolve(import.meta.dirname, "..", "..");
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (/\.(ts|tsx|mts|mjs|js)$/.test(e.name) && !/\.test\.ts$/.test(e.name)) files.push(p);
      }
    };
    for (const dir of ["src", "worker", "scripts"]) walk(path.join(ROOT, dir));
    const read = (p: string) => fs.readFileSync(p, "utf8");
    const found = files.flatMap((p) => {
      const hits = read(p).match(/new\s+Anthropic\s*\(/g);
      return hits ? [`${path.relative(ROOT, p)} x${hits.length}`] : [];
    });
    expect(found.sort()).toEqual(["src/ai/client.ts x2", "src/server/apikeys.ts x1"]);
    // The key check's one client is inside checkAnthropicKey.
    const apikeys = read(path.join(ROOT, "src", "server", "apikeys.ts"));
    expect(apikeys.slice(apikeys.indexOf("export async function checkAnthropicKey"), apikeys.indexOf("function keyCheckMessage"))).toMatch(/new Anthropic\(/);
    // Every call names its review (the type requires it); only answer checks belong to none.
    expect(files.filter((p) => /reviewId:\s*null/.test(read(p))).map((p) => path.relative(ROOT, p))).toEqual(["src/ai/interpret.ts"]);
  });
});
