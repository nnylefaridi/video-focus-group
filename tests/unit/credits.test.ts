/**
 * Hosted mode: prepaid credits. Top-ups through Stripe Checkout, Stripe's webhooks
 * (signature, replays, refunds, disputes), and the ledger: what a review or follow-up
 * sets aside, what it's charged, and that nothing can overspend or go negative. Real
 * route handlers against an in-process Postgres; Stripe's API calls, Anthropic and the
 * Supabase session are replaced by stand-ins, so nothing here touches the network.
 * Webhook signatures are made and checked with Stripe's own code.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { nextQuestion, upsertAnswer, type Answer } from "@/core/questionnaire/engine";

const WEBHOOK_SECRET = "whsec_test_secret_for_panel";
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "panel-credits-"));
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
process.env.DAILY_LIMIT_USD = "1000";
process.env.MONTHLY_LIMIT_USD = "1000";

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
let core: typeof import("@/core/credits");
let stripe: typeof import("@/server/stripe");
let billing: typeof import("@/server/billing");
let budget: typeof import("@/server/budget");
let reviews: typeof import("@/server/reviews");
let processMod: typeof import("@/server/process");
let ai: typeof import("@/ai/client");
let db: typeof import("@/server/db");
let checkoutRoute: typeof import("@/app/api/credits/checkout/route");
let creditsRoute: typeof import("@/app/api/credits/route");
let webhookRoute: typeof import("@/app/api/stripe/webhook/route");
let reviewsRoute: typeof import("@/app/api/reviews/route");
let retryRoute: typeof import("@/app/api/reviews/[id]/retry/route");
let chatRoute: typeof import("@/app/api/reviews/[id]/chat/route");
let keys: typeof import("@/server/apikeys");
let RealStripe: typeof import("stripe").default;
let board: string[];

beforeAll(async () => {
  credits = await import("@/server/credits");
  core = await import("@/core/credits");
  stripe = await import("@/server/stripe");
  billing = await import("@/server/billing");
  budget = await import("@/server/budget");
  reviews = await import("@/server/reviews");
  processMod = await import("@/server/process");
  ai = await import("@/ai/client");
  db = await import("@/server/db");
  checkoutRoute = await import("@/app/api/credits/checkout/route");
  creditsRoute = await import("@/app/api/credits/route");
  webhookRoute = await import("@/app/api/stripe/webhook/route");
  reviewsRoute = await import("@/app/api/reviews/route");
  retryRoute = await import("@/app/api/reviews/[id]/retry/route");
  chatRoute = await import("@/app/api/reviews/[id]/chat/route");
  keys = await import("@/server/apikeys");
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
const ctx = (id: string) => ({ params: Promise.resolve({ id }) }) as never;

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

describe("the margin and the units", () => {
  it("charges cost x 1.2 in whole micro-dollars, always rounded up", () => {
    expect(credits.MARGIN).toBe(1.2);
    expect(credits.withMargin(0)).toBe(0);
    expect(credits.withMargin(1)).toBe(2); // 1.2 rounds up
    expect(credits.withMargin(5)).toBe(6);
    expect(credits.withMargin(80_000)).toBe(96_000);
    expect(credits.withMargin(4_166_667)).toBe(5_000_001);
    expect(credits.usdToMicros(0.08)).toBe(80_000);
    expect(credits.usdToMicros(0.1 + 0.2)).toBe(300_000);
    expect(credits.usdToMicros(0.0000001)).toBe(1);
  });

  it("sets aside the review cap and the follow-up cap with the margin", () => {
    expect(credits.reviewReserve()).toBe($(3.6));
    expect(credits.followupReserve()).toBe($(1.8));
  });

  it("shows amounts rounded down to the cent", () => {
    expect(core.formatMicros($(3.6))).toBe("$3.60");
    expect(core.formatMicros(5_009_999)).toBe("$5.00");
    expect(core.formatMicros(0)).toBe("$0.00");
  });

  it("covers Stripe's fee on the smallest ($10) top-up spent in full, even on an international card", () => {
    const smallest = Math.min(...core.CREDIT_PACKS.map((p) => p.cents));
    expect(smallest).toBe(1000);
    expect(core.CREDIT_PACKS.map((p) => p.cents)).toEqual([1000, 2500, 5000]);
    const anthropic = smallest / credits.MARGIN;
    const margin = smallest - anthropic;
    expect(0.029 * smallest + 30).toBeCloseTo(59, 5);
    expect(margin).toBeCloseTo(166.67, 1);
    expect(margin - (0.029 * smallest + 30)).toBeCloseTo(107.67, 1);
    expect(margin - (0.054 * smallest + 30)).toBeCloseTo(82.67, 1);
  });
});

describe("buying credits", () => {
  it("needs sign-in, and only takes one of the three packs", async () => {
    let res = await checkoutRoute.POST(req("/api/credits/checkout", "POST", { pack: "usd10" }));
    expect(res.status).toBe(401);
    signIn();
    // Nothing under $10, and no made-up amounts.
    for (const pack of ["usd5", "usd1", "usd100", 10, "10", null]) {
      res = await checkoutRoute.POST(req("/api/credits/checkout", "POST", { pack }));
      expect(res.status).toBe(400);
    }
    expect(stripeApi.sessions).toHaveLength(0);
  });

  it("prices the pack on the server and ignores any amount the browser sends", async () => {
    const user = signIn();
    const res = await checkoutRoute.POST(req("/api/credits/checkout", "POST", { pack: "usd25", amount: 1, unit_amount: 1, from: "flow" }));
    expect(res.status).toBe(200);
    expect((await res.json()).url).toBe("https://checkout.stripe.com/c/pay/cs_test_1");
    expect(stripeApi.sessions).toHaveLength(1);
    const s = stripeApi.sessions[0] as {
      mode: string;
      line_items: { quantity: number; price_data: { currency: string; unit_amount: number } }[];
      client_reference_id: string;
      metadata: Record<string, string>;
      success_url: string;
      cancel_url: string;
    };
    expect(s.mode).toBe("payment");
    expect(s.line_items).toHaveLength(1);
    expect(s.line_items[0].quantity).toBe(1);
    expect(s.line_items[0].price_data).toMatchObject({
      currency: "usd",
      unit_amount: 2500,
      product_data: { name: "Video Focus Group credits, $25.00", description: "Prepaid credit for Video Focus Group reviews. Unused credit isn't refunded in cash." },
    });
    expect(s.client_reference_id).toBe(user);
    expect(s.metadata).toEqual({ user_id: user, pack: "usd25" });
    expect(s.success_url).toBe("https://panel.example.com/?topup=done&session_id={CHECKOUT_SESSION_ID}");
    expect(s.cancel_url).toBe("https://panel.example.com/?topup=cancelled");

    await checkoutRoute.POST(req("/api/credits/checkout", "POST", { pack: "usd50" }));
    const second = stripeApi.sessions[1] as { success_url: string; line_items: { price_data: { unit_amount: number } }[] };
    expect(second.success_url).toBe("https://panel.example.com/account/topup/done?session_id={CHECKOUT_SESSION_ID}");
    expect((stripeApi.sessions[1] as { cancel_url: string }).cancel_url).toBe("https://panel.example.com/account/topup/cancelled");
    expect(second.line_items[0].price_data.unit_amount).toBe(5000);
    // Nothing is credited just for starting a checkout.
    expect((await summary(user)).balance).toBe(0);
  });

  it("fails clearly when Stripe isn't set up or can't be reached", async () => {
    signIn();
    const key = process.env.STRIPE_SECRET_KEY;
    delete process.env.STRIPE_SECRET_KEY;
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const res = await checkoutRoute.POST(req("/api/credits/checkout", "POST", { pack: "usd10" }));
      expect(res.status).toBe(503);
      expect((await res.json()).error).toBe("Payments aren't set up on this site yet, so credits can't be added right now.");
      expect(() => stripe.stripeClient()).toThrow(/STRIPE_SECRET_KEY isn't set/);
    } finally {
      process.env.STRIPE_SECRET_KEY = key;
    }
    stripeApi.fail = new Error("connection refused");
    const res = await checkoutRoute.POST(req("/api/credits/checkout", "POST", { pack: "usd10" }));
    expect(res.status).toBe(502);
    expect((await res.json()).error).toBe("Couldn't reach Stripe to start the payment. Please try again.");
    errors.mockRestore();
  });

  it("is only for the hosted site", async () => {
    signIn();
    process.env.PANEL_MODE = "local";
    try {
      expect((await checkoutRoute.POST(req("/api/credits/checkout", "POST", { pack: "usd10" }))).status).toBe(404);
      expect((await deliver(signed("checkout.session.completed", paidSession(state.user!.sub, 1000)))).status).toBe(404);
    } finally {
      process.env.PANEL_MODE = "hosted";
    }
  });
});

describe("Stripe's webhook", () => {
  it("refuses a bad or missing signature, and credits nothing", async () => {
    const user = signIn();
    const s = paidSession(user, 1000);
    const forged = signed("checkout.session.completed", s, { secret: "whsec_someone_else" });
    expect((await deliver(forged)).status).toBe(400);
    expect((await deliver({ payload: forged.payload, header: null })).status).toBe(400);
    // Signed properly, then changed on the way.
    const good = signed("checkout.session.completed", s);
    expect((await deliver({ payload: good.payload.replace('"amount_total": 1000', '"amount_total": 100000'), header: good.header })).status).toBe(400);
    expect((await summary(user)).balance).toBe(0);
    expect(await db.q("SELECT 1 FROM app.stripe_events WHERE id = $1", [JSON.parse(forged.payload).id])).toHaveLength(0);
  });

  it("refuses everything when the signing secret isn't set", async () => {
    const user = signIn();
    const secret = process.env.STRIPE_WEBHOOK_SECRET;
    delete process.env.STRIPE_WEBHOOK_SECRET;
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect((await deliver(signed("checkout.session.completed", paidSession(user, 1000)))).status).toBe(503);
    } finally {
      process.env.STRIPE_WEBHOOK_SECRET = secret;
      errors.mockRestore();
    }
    expect((await summary(user)).balance).toBe(0);
  });

  it("credits the amount actually paid, once, however often the event is replayed", async () => {
    const user = signIn();
    // A $10 pack paid with a discount: what was paid is what's credited.
    const s = paidSession(user, 450);
    const event = signed("checkout.session.completed", s);
    for (let i = 0; i < 3; i++) expect((await deliver(event)).status).toBe(200);
    // The same session's other event, and the same event re-signed later, don't add more.
    expect((await deliver(signed("checkout.session.async_payment_succeeded", s))).status).toBe(200);
    expect((await deliver(signed("checkout.session.completed", s, { id: JSON.parse(event.payload).id }))).status).toBe(200);
    expect(await summary(user)).toMatchObject({ balance: $(4.5), reserved: 0, available: $(4.5) });
    expect((await ledger(user)).map((e) => [e.kind, Number(e.amount)])).toEqual([["topup", $(4.5)]]);
    expect(await credits.topupCredited(user, s.id)).toBe(true);
  });

  it("waits for a delayed payment to arrive before crediting it", async () => {
    const user = signIn();
    const s = paidSession(user, 1000, { payment_status: "unpaid" });
    await deliver(signed("checkout.session.completed", s));
    expect((await summary(user)).balance).toBe(0);
    await deliver(signed("checkout.session.async_payment_succeeded", { ...s, payment_status: "paid" }));
    expect((await summary(user)).balance).toBe($(10));
  });

  it("ignores sessions that aren't a Panel account's, or weren't in dollars", async () => {
    const user = signIn();
    await deliver(signed("checkout.session.completed", paidSession(user, 1000, { client_reference_id: null })));
    await deliver(signed("checkout.session.completed", paidSession(user, 1000, { client_reference_id: "not-a-uuid" })));
    await deliver(signed("checkout.session.completed", paidSession(user, 1000, { metadata: { user_id: "3c9e5a1b-2d4f-4a6b-8c7d-999999999999" } })));
    await deliver(signed("checkout.session.completed", paidSession(user, 1000, { currency: "eur" })));
    expect((await summary(user)).balance).toBe(0);
  });

  it("tells the browser once a top-up has arrived", async () => {
    const user = signIn();
    const s = paidSession(user, 1000);
    let res = await creditsRoute.GET(req(`/api/credits?session_id=${s.id}`, "GET"));
    expect(await res.json()).toMatchObject({ credited: false, payment: { credits: { balance: 0 } } });
    await deliver(signed("checkout.session.completed", s));
    res = await creditsRoute.GET(req(`/api/credits?session_id=${s.id}`, "GET"));
    expect(await res.json()).toMatchObject({ credited: true, payment: { credits: { balance: $(10) } } });
    // Someone else's session says nothing about it.
    signIn();
    res = await creditsRoute.GET(req(`/api/credits?session_id=${s.id}`, "GET"));
    expect((await res.json()).credited).toBe(false);
  });
});

describe("the ledger", () => {
  it("reserves, charges cost x 1.2 and releases the rest", async () => {
    const user = signIn();
    await topUp(user, 1000);
    const id = await credits.reserve(user, "review-math-1", "review");
    expect(await summary(user)).toMatchObject({ balance: $(10), reserved: $(3.6), available: $(6.4) });
    const hold = await credits.holdForCall(id, "review-math-1", { inputMicros: 1000, outputMicrosPerToken: 20, maxTokens: 8000, minTokens: 1000 });
    await credits.releaseHold(hold, $(1));
    expect(await credits.settleReservation(id)).toBe($(1.2));
    expect(await summary(user)).toMatchObject({ balance: $(8.8), reserved: 0, available: $(8.8) });
    expect((await ledger(user)).map((e) => [e.kind, Number(e.amount), Number(e.balance_after), Number(e.reserved_after)])).toEqual([
      ["topup", $(10), $(10), 0],
      ["reserve", $(3.6), $(10), $(3.6)],
      ["charge", -$(1.2), $(8.8), $(2.4)],
      ["release", $(2.4), $(8.8), 0],
    ]);
    // Settling again changes nothing.
    expect(await credits.settleReservation(id)).toBe(0);
    expect((await ledger(user)).length).toBe(4);
  });

  it("lets parallel reservations take only what's there", async () => {
    const user = signIn();
    await topUp(user, 1000);
    const results = await Promise.all(
      Array.from({ length: 6 }, (_, i) =>
        credits.reserve(user, `parallel-${i}`, "review").then(
          () => "reserved",
          (e) => (e instanceof credits.NotEnoughCredits ? "refused" : Promise.reject(e)),
        ),
      ),
    );
    expect(results.filter((r) => r === "reserved")).toHaveLength(2);
    expect(await summary(user)).toMatchObject({ balance: $(10), reserved: $(7.2), available: $(2.8) });
  });

  it("can't go negative or be rewritten, even by hand", async () => {
    const user = signIn();
    await topUp(user, 1000);
    await expect(db.q("UPDATE app.credit_accounts SET balance = -1 WHERE user_id = $1", [user])).rejects.toThrow();
    await expect(db.q("UPDATE app.credit_accounts SET reserved = balance + 1 WHERE user_id = $1", [user])).rejects.toThrow();
    await expect(db.q("UPDATE app.credit_ledger SET amount = 999999999 WHERE user_id = $1", [user])).rejects.toThrow(/append-only/);
    await expect(db.q("DELETE FROM app.credit_ledger WHERE user_id = $1", [user])).rejects.toThrow(/append-only/);
    const rls = await db.q<{ relname: string; on: boolean }>(
      "SELECT relname, relrowsecurity AS on FROM pg_class WHERE oid IN ('app.credit_accounts'::regclass, 'app.credit_ledger'::regclass, 'app.credit_reservations'::regclass, 'app.stripe_events'::regclass)",
    );
    expect(rls.every((r) => r.on)).toBe(true);
  });

  it("never lets calls claim more than the reservation, even in parallel", async () => {
    const user = signIn();
    await topUp(user, 1000);
    const id = await credits.reserve(user, "review-holds", "review");
    // $3.60 set aside leaves room for $3.00 of Anthropic cost. Output at 20 micro-dollars a token.
    const price = { inputMicros: 0, outputMicrosPerToken: 20, maxTokens: 64_000, minTokens: 16_000 };
    const a = await credits.holdForCall(id, "review-holds", price);
    const b = await credits.holdForCall(id, "review-holds", price);
    expect([a.maxTokens, b.maxTokens]).toEqual([64_000, 64_000]);
    // Only $0.44 is left: the next call gets less output, then nothing fits.
    const c = await credits.holdForCall(id, "review-holds", price);
    expect(c.maxTokens).toBe(22_000);
    await expect(credits.holdForCall(id, "review-holds", price, { waitMs: 5, maxWaitMs: 50 })).rejects.toBeInstanceOf(credits.ReservationUsed);
    // A call for another review can't use this reservation.
    await expect(credits.holdForCall(id, "some-other-review", price)).rejects.toBeInstanceOf(credits.NotEnoughCredits);
    // Once running calls finish, a waiting one goes ahead with what's left.
    const waiting = credits.holdForCall(id, "review-holds", price, { waitMs: 5 });
    await credits.releaseHold(a, $(0.2));
    await credits.releaseHold(b, $(0.3));
    await credits.releaseHold(c, $(0.1));
    expect((await waiting).maxTokens).toBe(64_000);
    const [row] = await db.q<{ cost: string; amount: string }>("SELECT cost, amount FROM app.credit_reservations WHERE id = $1", [id]);
    expect(credits.withMargin(Number(row.cost) + (await waiting).ceiling)).toBeLessThanOrEqual(Number(row.amount));
  });

  it("gives everything back when an upload never becomes a review", async () => {
    const user = signIn();
    await topUp(user, 1000);
    await billing.setPaymentMethod(user, "credits");
    const res = await makeReview();
    expect(res.status).toBe(200);
    const { id } = await res.json();
    expect((await summary(user)).reserved).toBe($(3.6));
    await reviews.deleteReview(id, { refund: true });
    expect(await summary(user)).toMatchObject({ balance: $(10), reserved: 0 });
  });
});

describe("reviews on credits", () => {
  it("are refused with a plain message when the balance is short, and nothing is created", async () => {
    const user = signIn();
    await billing.setPaymentMethod(user, "credits");
    let res = await makeReview();
    expect(res.status).toBe(402);
    expect(await res.json()).toEqual({ error: "Add credits first. Your balance is empty.", payment: "credits" });
    // $10 bought, with two other reviews running: $2.80 free, less than a review's $3.60.
    await topUp(user, 1000);
    await credits.reserve(user, "running-a", "review");
    await credits.reserve(user, "running-b", "review");
    res = await makeReview();
    expect(res.status).toBe(402);
    expect((await res.json()).error).toBe("Add credits first. A review sets aside up to $3.60 while it runs, and you have $2.80 free.");
    expect(Number((await db.q<{ n: number }>("SELECT COUNT(*)::int AS n FROM app.reviews WHERE user_id = $1", [user]))[0].n)).toBe(0);
    expect((await billing.getPaymentContext(user)).ready).toBe(false);
  });

  it("set aside their worst case when they're created", async () => {
    const user = signIn();
    await billing.setPaymentMethod(user, "credits");
    await topUp(user, 1000);
    expect((await billing.getPaymentContext(user)).ready).toBe(true);
    expect((await makeReview()).status).toBe(200);
    expect((await makeReview()).status).toBe(200);
    // $10 covers two reviews' worst case at once; the third waits for credit.
    const third = await makeReview();
    expect(third.status).toBe(402);
    expect((await third.json()).error).toBe("Add credits first. A review sets aside up to $3.60 while it runs, and you have $2.80 free.");
    expect(await summary(user)).toMatchObject({ balance: $(10), reserved: $(7.2) });
  });

  it("are charged actual cost x 1.2 when they finish, and only that if they fail", async () => {
    const user = signIn();
    await billing.setPaymentMethod(user, "credits");
    await topUp(user, 1000);
    const created = await makeReview();
    const { id } = await created.json();
    const call = (reviewId: string) =>
      ai.callStructured({ label: "test", reviewId, model: ai.MODELS.deep, system: "s", messages: [{ role: "user", content: "hi" }], schema: z.object({ ok: z.boolean() }), maxTokens: 4000 });

    // 10,000 input and 2,000 output tokens on the deep model: $0.08, so $0.096 with the margin.
    await expect(
      processMod.runReview(id, async (rid) => {
        await call(rid);
        throw new Error("ffmpeg crashed");
      }),
    ).rejects.toThrow("ffmpeg crashed");
    expect(await summary(user)).toMatchObject({ balance: $(10) - 96_000, reserved: 0 });

    // A retry sets credit aside again, and a finished run is charged the same way.
    await reviews.updateReview(id, { stage: "failed" });
    const retried = await retryRoute.POST(req(`/api/reviews/${id}/retry`, "POST", {}), ctx(id));
    expect(retried.status).toBe(200);
    expect((await summary(user)).reserved).toBe($(3.6));
    await processMod.runReview(id, async (rid) => {
      await call(rid);
      await call(rid);
    });
    expect(await summary(user)).toMatchObject({ balance: $(10) - 96_000 * 3, reserved: 0 });
    expect((await ledger(user)).filter((e) => e.kind === "charge").map((e) => Number(e.amount))).toEqual([-96_000, -192_000]);
  });

  it("stop instead of spending past what was set aside", async () => {
    const user = signIn();
    await billing.setPaymentMethod(user, "credits");
    await topUp(user, 1000);
    const { id } = await (await makeReview()).json();
    // Each call costs $0.40 (20,000 output tokens on the deep model). $3.60 set aside covers
    // $3.00 of cost: seven calls ($2.80) fit, and the eighth's worst case doesn't.
    sdk.usage = { input_tokens: 0, output_tokens: 20_000, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
    const call = (rid: string) =>
      ai.callStructured({ label: "big", reviewId: rid, model: ai.MODELS.deep, system: "s", messages: [{ role: "user", content: "hi" }], schema: z.object({ ok: z.boolean() }), maxTokens: 20_000 });
    await expect(
      processMod.runReview(id, async (rid) => {
        for (let i = 0; i < 20; i++) await call(rid);
      }),
    ).rejects.toThrow(core.RESERVATION_USED);
    expect(sdk.requests.map((r) => r.max_tokens)).toEqual(Array(7).fill(20_000));
    expect(await summary(user)).toMatchObject({ balance: $(10) - credits.withMargin($(2.8)), reserved: 0 });
  });

  it("give a call less output when only part of its worst case fits", async () => {
    const user = signIn();
    await billing.setPaymentMethod(user, "credits");
    await topUp(user, 1000);
    const { id } = await (await makeReview()).json();
    sdk.usage = { input_tokens: 0, output_tokens: 1_000, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
    await processMod.runReview(id, async (rid) => {
      // A 64,000-token answer's worst case is $1.28 of output: two fit in $3.00, the third gets what's left.
      const big = () => ai.callStructured({ label: "pass", reviewId: rid, model: ai.MODELS.deep, system: "s", messages: [{ role: "user", content: "hi" }], schema: z.object({ ok: z.boolean() }), maxTokens: 64_000 });
      const holds: Promise<unknown>[] = [];
      for (let i = 0; i < 3; i++) holds.push(big());
      await Promise.all(holds);
    });
    const asked = sdk.requests.map((r) => r.max_tokens).sort((a, b) => b - a);
    expect(asked.slice(0, 2)).toEqual([64_000, 64_000]);
    expect(asked[2]).toBeGreaterThanOrEqual(16_000);
    expect(asked[2]).toBeLessThan(64_000);
  });

  it("can't make a paid call without credit set aside for it", async () => {
    const user = signIn();
    await billing.setPaymentMethod(user, "credits");
    await topUp(user, 1000);
    const { id } = await (await makeReview()).json();
    await expect(
      ai.callStructured({ label: "stray", reviewId: id, model: ai.MODELS.fast, system: "s", messages: [{ role: "user", content: "hi" }], schema: z.object({ ok: z.boolean() }) }),
    ).rejects.toBeInstanceOf(ai.AiUnavailable);
    expect(sdk.requests).toHaveLength(0);
  });

  it("refuse a retry the balance can't cover", async () => {
    const user = signIn();
    await billing.setPaymentMethod(user, "credits");
    await topUp(user, 1000);
    const { id } = await (await makeReview()).json();
    await processMod.runReview(id, async () => {});
    // Two other reviews running leave $2.80 free, less than a retry's $3.60.
    await credits.reserve(user, "elsewhere-a", "review");
    await credits.reserve(user, "elsewhere-b", "review");
    await reviews.updateReview(id, { stage: "failed" });
    const res = await retryRoute.POST(req(`/api/reviews/${id}/retry`, "POST", {}), ctx(id));
    expect(res.status).toBe(402);
    expect((await res.json()).payment).toBe("credits");
    expect((await reviews.getReview(id))?.stage).toBe("failed");
  });
});

describe("follow-up questions on credits", () => {
  it("set a small amount aside per answer, charge what it cost and release the rest", async () => {
    const user = signIn();
    await billing.setPaymentMethod(user, "credits");
    await topUp(user, 1000);
    const { id } = await (await makeReview()).json();
    await processMod.runReview(id, async () => {});
    const who = { person: `u:${user}`, network: `n:${user}`, signedIn: true };
    const reservation = await budget.spendFollowup(who, id);
    expect(reservation).not.toBeNull();
    expect((await summary(user)).reserved).toBe($(1.8));
    await credits.onReservation(reservation!, async () => {
      for await (const ev of ai.streamText({ label: "followup", reviewId: id, model: ai.MODELS.deep, system: "s", messages: [{ role: "user", content: "why?" }] })) void ev;
    });
    expect(await credits.settleReservation(reservation!)).toBe(96_000);
    expect(await summary(user)).toMatchObject({ balance: $(10) - 96_000, reserved: 0 });
  });

  it("are refused when the balance can't cover one, without using up a question", async () => {
    const user = signIn();
    await billing.setPaymentMethod(user, "credits");
    await topUp(user, 1000);
    const { id } = await (await makeReview()).json();
    // This review's $3.60, another review's $3.60 and another answer's $1.80 are set aside: $1.00 is free.
    await credits.reserve(user, "other-review", "review");
    await credits.reserve(user, "other-review", "followup");
    const who = { person: `u:${user}`, network: `n:${user}`, signedIn: true };
    await expect(budget.spendFollowup(who, id)).rejects.toThrow("Add credits to ask a follow-up. Each answer sets aside up to $1.80 while it's written, and you have $1.00 free.");
    expect(await budget.followupsUsed(id)).toBe(0);
  });
});

describe("reviews on the account's own Anthropic key", () => {
  it("never need, set aside or charge credits: starting, running, retrying or follow-up chat", async () => {
    const user = signIn();
    const key = "sk-ant-api03-own-key-for-credits-test-000000000000abcd";
    await billing.setPaymentMethod(user, "own_key");
    await keys.saveKey(user, key);
    expect(await billing.getPaymentContext(user)).toMatchObject({ method: "own_key", ready: true, credits: { balance: 0, available: 0 } });

    // Start it with a zero balance.
    const created = await makeReview();
    expect(created.status).toBe(200);
    const { id } = await created.json();
    const call = (rid: string) =>
      ai.callStructured({ label: "t", reviewId: rid, model: ai.MODELS.deep, system: "s", messages: [{ role: "user", content: "hi" }], schema: z.object({ ok: z.boolean() }), maxTokens: 4000 });

    // Run paid calls the way the worker does, on the account's key; a run that fails, then a retry.
    await expect(
      processMod.runReview(id, async (rid) => {
        await call(rid);
        throw new Error("ffmpeg crashed");
      }),
    ).rejects.toThrow("ffmpeg crashed");
    await reviews.updateReview(id, { stage: "failed" });
    expect((await retryRoute.POST(req(`/api/reviews/${id}/retry`, "POST", {}), ctx(id))).status).toBe(200);
    await processMod.runReview(id, async (rid) => {
      await call(rid);
    });

    // Follow-up chat through the real route.
    const ledgerOf = {
      shots: [],
      frames: [],
      transcript: [],
      audio: [],
      speechRate: [],
      loudness: [],
      perception: [],
      coverage: { durationSec: 10, width: 1080, height: 1920, framesAnalyzed: 0, sampling: "test", transcript: "no_speech_detected" as const, notes: [] },
    };
    await reviews.updateReview(id, { ledger: ledgerOf, stage: "done" });
    const chat = await chatRoute.POST(req(`/api/reviews/${id}/chat`, "POST", { reviewerId: board[0], message: "Why that opening?" }), ctx(id));
    expect(chat.status).toBe(200);
    const lines = (await chat.text()).trim().split("\n").map((l) => JSON.parse(l));
    expect(lines.at(-1)).toMatchObject({ type: "done" });

    // Every call ran on the account's own key, and was recorded as own_key.
    expect(sdk.keys).toHaveLength(3);
    expect(sdk.keys.every((k) => k === key)).toBe(true);
    const spend = await db.q<{ p: string }>("SELECT paid_with::text AS p FROM app.spend WHERE review_id = $1", [id]);
    expect(spend.map((r) => r.p)).toEqual(["own_key", "own_key", "own_key"]);
    // And credits were never touched.
    for (const table of ["credit_ledger", "credit_reservations", "credit_accounts"])
      expect(await db.q(`SELECT 1 FROM app.${table} WHERE user_id = $1`, [user])).toHaveLength(0);
    expect(await db.q("SELECT 1 FROM app.credit_reservations WHERE review_id = $1", [id])).toHaveLength(0);
  });
});

describe("refunds and disputes", () => {
  it("take a refund back from the balance, once", async () => {
    const user = signIn();
    const pi = await topUp(user, 1000);
    const refund = signed("charge.refunded", { id: "ch_1", object: "charge", payment_intent: pi, amount_refunded: 1000, currency: "usd" });
    await deliver(refund);
    await deliver(refund);
    expect(await summary(user)).toMatchObject({ balance: 0, onHold: false });
    expect((await ledger(user)).map((e) => [e.kind, Number(e.amount)])).toEqual([
      ["topup", $(10)],
      ["adjustment", -$(10)],
    ]);
  });

  it("follow partial refunds as a running total", async () => {
    const user = signIn();
    const pi = await topUp(user, 2500);
    await deliver(signed("charge.refunded", { id: "ch_2", object: "charge", payment_intent: pi, amount_refunded: 500 }));
    await deliver(signed("charge.refunded", { id: "ch_2", object: "charge", payment_intent: pi, amount_refunded: 1500 }));
    expect((await summary(user)).balance).toBe($(10));
    // A later dispute for the same payment only takes what's left of it.
    await deliver(signed("charge.dispute.created", { id: "dp_1", object: "dispute", payment_intent: pi, amount: 2500 }));
    expect((await summary(user)).balance).toBe(0);
  });

  it("put the account on hold, never below zero, when the credit was already spent", async () => {
    const user = signIn();
    await billing.setPaymentMethod(user, "credits");
    const pi = await topUp(user, 1000);
    const { id } = await (await makeReview()).json();
    await processMod.runReview(id, async (rid) => {
      await ai.callStructured({ label: "t", reviewId: rid, model: ai.MODELS.deep, system: "s", messages: [{ role: "user", content: "hi" }], schema: z.object({ ok: z.boolean() }), maxTokens: 4000 });
    });
    // $0.096 was spent, leaving $9.904. Another review is running now, with $3.60 set aside.
    await credits.reserve(user, "running-now", "review");
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    await deliver(signed("charge.dispute.created", { id: "dp_2", object: "dispute", payment_intent: pi, amount: 1000 }));
    errors.mockRestore();
    const s = await summary(user);
    // Everything free was taken; what's set aside for the running review was left alone.
    expect(s).toMatchObject({ balance: $(3.6), reserved: $(3.6), available: 0, onHold: true });
    const [acct] = await db.q<{ owed: string; on_hold_reason: string }>("SELECT owed, on_hold_reason FROM app.credit_accounts WHERE user_id = $1", [user]);
    expect(Number(acct.owed)).toBe($(10) - ($(10) - 96_000 - $(3.6)));
    expect(acct.on_hold_reason).toMatch(/^dispute on pi_test_\d+: \$\d+\.\d\d of it had already been spent or set aside$/);
    const adj = (await ledger(user)).filter((e) => e.kind === "adjustment");
    expect(adj).toHaveLength(1);
    expect(Number(adj[0].amount) + Number(adj[0].uncollected) * -1).toBe(-$(10));

    // On hold: no new reviews, follow-ups or top-ups, and the reason is shown.
    const ctx = await billing.getPaymentContext(user);
    expect(ctx).toMatchObject({ ready: false, problem: core.ON_HOLD });
    expect((await makeReview()).status).toBe(402);
    const buy = await checkoutRoute.POST(req("/api/credits/checkout", "POST", { pack: "usd10" }));
    expect(buy.status).toBe(402);
    expect((await buy.json()).error).toBe(core.ON_HOLD);
    expect(stripeApi.sessions).toHaveLength(0);
    // The same dispute again doesn't take more or count the shortfall twice.
    await deliver(signed("charge.refunded", { id: "ch_3", object: "charge", payment_intent: pi, amount_refunded: 1000 }));
    expect((await summary(user)).balance).toBe($(3.6));
    expect(Number((await db.q<{ owed: string }>("SELECT owed FROM app.credit_accounts WHERE user_id = $1", [user]))[0].owed)).toBe(Number(acct.owed));
  });

  it("ignore refunds of payments that weren't credit top-ups", async () => {
    const user = signIn();
    await topUp(user, 1000);
    await deliver(signed("charge.refunded", { id: "ch_x", object: "charge", payment_intent: "pi_unrelated", amount_refunded: 1000 }));
    expect((await summary(user)).balance).toBe($(10));
  });
});
