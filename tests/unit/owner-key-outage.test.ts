/**
 * Hosted mode: when Anthropic refuses the app's own key (out of credit, or 401), customers on
 * credits are told plainly that nothing was charged, the failed review costs them nothing, the
 * owner gets an [ALERT] log line, and credits pause (no top-ups, no new credit-paid work) for
 * ten minutes or until the key works again. People on their own key keep the message about
 * their own Anthropic account. Also: prepaid credit spend isn't held to the app's daily and
 * monthly caps, which still apply to anything nobody prepaid. Same stand-ins as credits.test.ts:
 * in-process Postgres, fake Stripe API and fake Anthropic, so nothing touches the network.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { nextQuestion, upsertAnswer, type Answer } from "@/core/questionnaire/engine";

const WEBHOOK_SECRET = "whsec_test_secret_for_panel";
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "panel-owner-key-"));
process.env.PANEL_MODE = "hosted";
process.env.MEDIA_SECRET = Buffer.alloc(32, 9).toString("base64");
process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_test";
process.env.HOSTED_PUBLIC_URL = "https://panel.example.com";
process.env.ANTHROPIC_API_KEY = "sk-ant-server-key-for-tests-0000";
process.env.STRIPE_SECRET_KEY = "sk_test_not_a_real_key";
process.env.STRIPE_WEBHOOK_SECRET = WEBHOOK_SECRET;
process.env.KEY_ENCRYPTION_SECRET = Buffer.alloc(32, 5).toString("base64");
process.env.CLIENT_IP_HEADER = "x-panel-peer-test";
// Waking the runner needs a request to run after; runner.test.ts covers the runner itself.
vi.mock("@/server/kick", () => ({ kickAfterResponse: () => {}, kickNow: () => {}, kickIfUnattended: () => {} }));
process.env.MAX_REVIEWS_PER_DAY = "50";
process.env.MAX_REVIEWS_PER_NETWORK_PER_DAY = "500";
process.env.DAILY_LIMIT_USD = "1";
process.env.MONTHLY_LIMIT_USD = "1";
delete process.env.PANEL_DEV_SKIP_ANSWER_CHECK;

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

/** Stands in for Stripe's API: records each Checkout Session asked for. Webhook signing stays Stripe's real code. */
const stripeApi = vi.hoisted(() => ({
  sessions: [] as Record<string, unknown>[],
  fail: null as null | Error,
}));
vi.mock("stripe", async (importOriginal) => {
  const real = await importOriginal<typeof import("stripe")>();
  class FakeStripe extends real.default {
    constructor(...args: ConstructorParameters<typeof real.default>) {
      super(...args);
      Object.assign(this, {
        checkout: {
          sessions: {
            create: async (params: Record<string, unknown>) => {
              if (stripeApi.fail) throw stripeApi.fail;
              stripeApi.sessions.push(params);
              const id = `cs_test_${stripeApi.sessions.length}`;
              return { id, url: `https://checkout.stripe.com/c/pay/${id}` };
            },
          },
        },
      });
    }
  }
  return { ...real, default: FakeStripe };
});

/** Stands in for Anthropic: every call reports the usage the test sets, and its request is kept. */
const sdk = vi.hoisted(() => ({
  usage: { input_tokens: 10_000, output_tokens: 2_000, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
  requests: [] as { max_tokens: number }[],
  /** The API key of the client each call was made on. */
  keys: [] as unknown[],
  /** Calls that work before every later one fails with `fail` (an error made from the real SDK). */
  okCalls: Infinity,
  fail: null as null | (() => Error),
}));
vi.mock("@anthropic-ai/sdk", async (importOriginal) => {
  const real = await importOriginal<typeof import("@anthropic-ai/sdk")>();
  class FakeAnthropic extends real.default {
    constructor(opts?: ConstructorParameters<typeof real.default>[0]) {
      super(opts);
      const apiKey = opts?.apiKey ?? process.env.ANTHROPIC_API_KEY;
      Object.assign(this, {
        beta: {
          messages: {
            stream: (params: { max_tokens: number }) => {
              sdk.requests.push(params);
              sdk.keys.push(apiKey);
              if (sdk.fail && sdk.requests.length > sdk.okCalls) {
                const err = sdk.fail();
                return {
                  finalMessage: async () => Promise.reject(err),
                  async *[Symbol.asyncIterator]() {
                    yield* [];
                    throw err;
                  },
                };
              }
              // Like Anthropic: never more output than max_tokens, and says so when it's cut off.
              const cut = sdk.usage.output_tokens > params.max_tokens;
              const usage = { ...sdk.usage, output_tokens: Math.min(sdk.usage.output_tokens, params.max_tokens) };
              const msg = { content: [], usage, stop_reason: cut ? "max_tokens" : "end_turn", parsed_output: { ok: true } };
              return {
                finalMessage: async () => msg,
                async *[Symbol.asyncIterator]() {
                  yield { type: "content_block_delta", delta: { type: "text_delta", text: "Sure." } };
                },
              };
            },
          },
        },
      });
    }
  }
  return { ...real, default: FakeAnthropic };
});

let credits: typeof import("@/server/credits");
let billing: typeof import("@/server/billing");
let budget: typeof import("@/server/budget");
let reviews: typeof import("@/server/reviews");
let processMod: typeof import("@/server/process");
let ai: typeof import("@/ai/client");
let db: typeof import("@/server/db");
let checkoutRoute: typeof import("@/app/api/credits/checkout/route");
let webhookRoute: typeof import("@/app/api/stripe/webhook/route");
let reviewsRoute: typeof import("@/app/api/reviews/route");
let keys: typeof import("@/server/apikeys");
let RealStripe: typeof import("stripe").default;
let board: string[];
let ownerkey: typeof import("@/server/ownerkey");
let interpretRoute: typeof import("@/app/api/interpret/route");
let AnthropicSdk: typeof import("@anthropic-ai/sdk").default;

beforeAll(async () => {
  credits = await import("@/server/credits");
  billing = await import("@/server/billing");
  budget = await import("@/server/budget");
  reviews = await import("@/server/reviews");
  processMod = await import("@/server/process");
  ai = await import("@/ai/client");
  db = await import("@/server/db");
  checkoutRoute = await import("@/app/api/credits/checkout/route");
  webhookRoute = await import("@/app/api/stripe/webhook/route");
  reviewsRoute = await import("@/app/api/reviews/route");
  keys = await import("@/server/apikeys");
  ownerkey = await import("@/server/ownerkey");
  interpretRoute = await import("@/app/api/interpret/route");
  AnthropicSdk = (await vi.importActual<typeof import("@anthropic-ai/sdk")>("@anthropic-ai/sdk")).default;
  RealStripe = (await vi.importActual<typeof import("stripe")>("stripe")).default;
  const { liveProfiles } = await import("@/experts/load");
  board = [liveProfiles().find((p) => p.categories.includes("creator"))!.id];
});

beforeEach(() => {
  state.cookies.clear();
  state.user = null;
  stripeApi.sessions.length = 0;
  stripeApi.fail = null;
  sdk.requests.length = 0;
  sdk.keys.length = 0;
  sdk.usage = { input_tokens: 10_000, output_tokens: 2_000, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
  sdk.okCalls = Infinity;
  sdk.fail = null;
  globalThis.__panelOwnerKeyOutage = null;
});

let n = 0;
/** A fresh account, signed in, on its own network. */
function signIn() {
  n++;
  state.user = { sub: `3c9e5a1b-2d4f-4a6b-8c7d-${String(n).padStart(12, "0")}`, email: `maker${n}@example.com` };
  return state.user.sub;
}

const $ = (usd: number) => Math.round(usd * 1_000_000);
const req = (url: string, method: string, body?: unknown, headers: Record<string, string> = {}) =>
  new Request(`https://panel.example.com${url}`, {
    method,
    body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
    headers: { "x-panel-peer-test": `192.0.2.${n % 250}`, ...headers },
  });

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
const makeReview = () => reviewsRoute.POST(req("/api/reviews", "POST", { answers: answers(), board }));

let events = 0;
/** A Stripe event as Stripe would send it, signed with the endpoint's secret (or another). */
function signed(type: string, object: Record<string, unknown>, opts: { id?: string; secret?: string } = {}) {
  const payload = JSON.stringify({ id: opts.id ?? `evt_test_${++events}`, object: "event", type, data: { object } }, null, 2);
  const header = new RealStripe("sk_test_x").webhooks.generateTestHeaderString({ payload, secret: opts.secret ?? WEBHOOK_SECRET });
  return { payload, header };
}
const deliver = ({ payload, header }: { payload: string; header: string | null }) =>
  webhookRoute.POST(req("/api/stripe/webhook", "POST", payload, header ? { "stripe-signature": header } : {}));

let sessions = 0;
function paidSession(userId: string, cents: number, extra: Record<string, unknown> = {}) {
  sessions++;
  return {
    id: `cs_test_paid_${sessions}`,
    object: "checkout.session",
    mode: "payment",
    payment_status: "paid",
    currency: "usd",
    amount_total: cents,
    client_reference_id: userId,
    metadata: { user_id: userId, pack: "usd10" },
    payment_intent: `pi_test_${sessions}`,
    ...extra,
  };
}

/** Buys credit the way Stripe does it: a signed checkout.session.completed. Returns the payment intent. */
async function topUp(userId: string, cents: number): Promise<string> {
  const s = paidSession(userId, cents);
  expect((await deliver(signed("checkout.session.completed", s))).status).toBe(200);
  return s.payment_intent;
}

const summary = (userId: string) => credits.creditSummary(userId);
const ledger = (userId: string) =>
  db.q<{ kind: string; amount: string; balance_after: string; reserved_after: string; uncollected: string }>(
    "SELECT kind::text AS kind, amount, balance_after, reserved_after, uncollected FROM app.credit_ledger WHERE user_id = $1 ORDER BY id",
    [userId],
  );

const OUT_OF_CREDIT = "Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits.";
const anthropicError = (status: number, message: string) => () =>
  AnthropicSdk.APIError.generate(status, { type: "error", error: { type: status === 401 ? "authentication_error" : "invalid_request_error", message } }, undefined, new Headers());
const call = (reviewId: string) =>
  ai.callStructured({ label: "test", reviewId, model: ai.MODELS.deep, system: "s", messages: [{ role: "user", content: "hi" }], schema: z.object({ ok: z.boolean() }), maxTokens: 4000 });
/** An account on credits with $10, signed in. */
async function onCredits() {
  const user = signIn();
  await billing.setPaymentMethod(user, "credits");
  await topUp(user, 1000);
  return user;
}

describe("the owner-key flag", () => {
  it("pauses credits for ten minutes, or until a call on the app's key works", () => {
    const t = 5_000_000;
    const alert = vi.spyOn(console, "error").mockImplementation(() => {});
    ownerkey.ownerKeyFailed("test", t);
    expect(alert.mock.calls.some((c) => String(c[0]).startsWith("[ALERT]"))).toBe(true);
    alert.mockRestore();
    expect(ownerkey.creditsPaused(t + ownerkey.PAUSE_MS - 1)).toBe(true);
    expect(ownerkey.creditsPaused(t + ownerkey.PAUSE_MS)).toBe(false);
    expect(ownerkey.ownerKeyFailedSince(t)).toBe(true);
    expect(ownerkey.ownerKeyFailedSince(t + 1)).toBe(false);
    ownerkey.ownerKeyFailed("test");
    expect(ownerkey.creditsPaused()).toBe(true);
    ownerkey.ownerKeyWorked();
    expect(ownerkey.creditsPaused()).toBe(false);
  });

  it("is cleared by the next call on the app's key that works", async () => {
    const user = signIn();
    const id = reviews.newReviewId();
    // A review on the server's key that nobody prepaid: a call on the app's key outside credits.
    await reviews.createReview({ id, answers: [], intent: {}, board, title: "t", userId: user, paidWith: null });
    vi.spyOn(console, "error").mockImplementationOnce(() => {});
    ownerkey.ownerKeyFailed("test");
    await expect(call(id)).resolves.toEqual({ ok: true });
    expect(ownerkey.creditsPaused()).toBe(false);
  });
});

describe("when Anthropic refuses the app's own key", () => {
  for (const [what, fail] of [
    ["is out of credit (400)", anthropicError(400, OUT_OF_CREDIT)],
    ["rejects the key (401)", anthropicError(401, "invalid x-api-key")],
  ] as const) {
    it(`${what}: the review costs nothing, the customer is told so, the owner is alerted, and credits pause`, async () => {
      const user = await onCredits();
      const { id } = await (await makeReview()).json();
      const alert = vi.spyOn(console, "error").mockImplementation(() => {});
      sdk.okCalls = 1;
      sdk.fail = fail;
      // The first call works and costs $0.096 with the margin; the second is refused.
      const run = processMod.runReview(id, async (rid) => {
        await call(rid);
        await call(rid);
      });
      await expect(run).rejects.toBeInstanceOf(ai.OwnerKeyUnavailable);
      await expect(run).rejects.toThrow(ownerkey.OWNER_KEY_DOWN);
      expect(alert.mock.calls.some((c) => String(c[0]).startsWith("[ALERT]"))).toBe(true);
      alert.mockRestore();
      // Waived: nothing charged, everything set aside is back.
      expect(await summary(user)).toMatchObject({ balance: $(10), reserved: 0 });
      expect((await ledger(user)).filter((e) => e.kind === "charge")).toEqual([]);
      expect(ownerkey.creditsPaused()).toBe(true);

      // While paused: credits aren't ready, nothing can be bought, no new review on credits.
      const ctx = await billing.getPaymentContext(user);
      expect(ctx).toMatchObject({ ready: false, problem: ownerkey.CREDITS_PAUSED });
      const buy = await checkoutRoute.POST(req("/api/credits/checkout", "POST", { pack: "usd10" }));
      expect(buy.status).toBe(402);
      expect((await buy.json()).error).toBe(ownerkey.CREDITS_PAUSED);
      expect(stripeApi.sessions).toEqual([]);
      const next = await makeReview();
      expect(next.status).toBe(402);
      expect((await next.json()).error).toBe(ownerkey.CREDITS_PAUSED);
      await expect(budget.startReview({ person: `p-${user}`, network: `n-${user}`, signedIn: true } as never, { id: reviews.newReviewId(), answers: [], intent: {}, board, title: "t", userId: user, anonId: null, paidWith: "credits" })).rejects.toThrow(ownerkey.CREDITS_PAUSED);
      await expect(budget.spendFollowup({ person: `p-${user}`, network: `n-${user}`, signedIn: true } as never, id)).rejects.toThrow(ownerkey.CREDITS_PAUSED);
      // A run already queued doesn't spend either; it stops with the same plain message.
      await expect(processMod.runReview(id, async (rid) => void (await call(rid)))).rejects.toThrow(ownerkey.OWNER_KEY_DOWN);
      expect(await summary(user)).toMatchObject({ balance: $(10), reserved: 0 });

      // Once the key works again, credits are back.
      ownerkey.ownerKeyWorked();
      expect((await billing.getPaymentContext(user)).ready).toBe(true);
      expect((await checkoutRoute.POST(req("/api/credits/checkout", "POST", { pack: "usd10" }))).status).toBe(200);
    });
  }

  it("answer checks on credits say the same, and charge nothing", async () => {
    const user = await onCredits();
    const before = await summary(user);
    vi.spyOn(console, "error").mockImplementation(() => {});
    sdk.okCalls = 0;
    sdk.fail = anthropicError(400, OUT_OF_CREDIT);
    const res = await interpretRoute.POST(req("/api/interpret", "POST", { questionId: "what", raw: "A 30-second skit about my cat judging my cooking", answers: [] }));
    vi.mocked(console.error).mockRestore();
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe(ownerkey.OWNER_KEY_DOWN);
    expect(await summary(user)).toEqual(before);
    expect(ownerkey.creditsPaused()).toBe(true);
    // And the next one is refused before any call while credits are paused.
    const calls = sdk.requests.length;
    const again = await interpretRoute.POST(req("/api/interpret", "POST", { questionId: "what", raw: "Another answer", answers: [] }));
    expect(again.status).toBe(402);
    expect((await again.json()).error).toBe(ownerkey.CREDITS_PAUSED);
    expect(sdk.requests.length).toBe(calls);
  });

  it("people on their own key keep the message about their own Anthropic account, and credits don't pause", async () => {
    const user = signIn();
    await keys.saveKey(user, `sk-ant-api03-${"o".repeat(40)}wxyz`);
    await billing.setPaymentMethod(user, "own_key");
    const { id } = await (await makeReview()).json();
    sdk.okCalls = 0;
    sdk.fail = anthropicError(400, OUT_OF_CREDIT);
    await expect(call(id)).rejects.toThrow("Your Anthropic account is out of credits. Add some under Settings → Billing in the Anthropic Console, then run the review again.");
    expect(ownerkey.creditsPaused()).toBe(false);
  });

  it("a review that fails for any other reason is still charged what its calls cost", async () => {
    const user = await onCredits();
    const { id } = await (await makeReview()).json();
    await expect(
      processMod.runReview(id, async (rid) => {
        await call(rid);
        throw new Error("ffmpeg crashed");
      }),
    ).rejects.toThrow("ffmpeg crashed");
    expect(await summary(user)).toMatchObject({ balance: $(10) - 96_000, reserved: 0 });
  });
});

describe("the app's daily and monthly caps", () => {
  it("don't hold back prepaid credit, but still stop spend nobody prepaid", async () => {
    const user = await onCredits();
    // Credit-paid spend well over the $1 caps.
    await budget.recordSpend({ label: "big credits", model: ai.MODELS.deep, usd: 5, paidWith: "credits" });
    // Only $0.08 nobody prepaid so far (the test above), under the $1 caps.
    expect((await budget.assertWithinSpendLimits()).today).toBeLessThan(1);
    expect(await budget.creditSpendThisMonth()).toBeGreaterThanOrEqual(5);
    const created = await makeReview();
    expect(created.status).toBe(200);
    const { id } = await created.json();
    await expect(processMod.runReview(id, async (rid) => void (await call(rid)))).resolves.toBeUndefined();

    // Spend nobody prepaid still counts, and stops calls that nobody prepaid.
    await budget.recordSpend({ label: "unpaid", model: ai.MODELS.deep, usd: 5, paidWith: null });
    await expect(budget.assertWithinSpendLimits()).rejects.toThrow(/budget/);
    const unpaid = reviews.newReviewId();
    await reviews.createReview({ id: unpaid, answers: [], intent: {}, board, title: "t", userId: user, paidWith: null });
    await expect(call(unpaid)).rejects.toBeInstanceOf(ai.BudgetExceeded);
    // ...while credits keep working.
    const again = await makeReview();
    expect(again.status).toBe(200);
  });
});
