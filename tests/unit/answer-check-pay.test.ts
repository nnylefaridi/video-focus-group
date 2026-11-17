/**
 * Hosted mode: the server's Anthropic key is never spent on a visitor who hasn't chosen how
 * to pay. Answer checks (/api/interpret), the one kind of call that belongs to no review,
 * run on the visitor's own saved key or are charged to their credits (cost x 1.2); anyone
 * else is refused before any call. Real route handlers against an in-process Postgres; the
 * Anthropic SDK and the Supabase session are stand-ins, so nothing touches the network.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "panel-answer-pay-"));
process.env.PANEL_MODE = "hosted";
process.env.MEDIA_SECRET = Buffer.alloc(32, 9).toString("base64");
process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_test";
process.env.HOSTED_PUBLIC_URL = "https://panel.example.com";
process.env.KEY_ENCRYPTION_SECRET = Buffer.alloc(32, 5).toString("base64");
process.env.ANTHROPIC_API_KEY = "sk-ant-server-key-for-tests-0000";
process.env.CLIENT_IP_HEADER = "x-panel-peer-test";
delete process.env.PANEL_DEV_SKIP_ANSWER_CHECK;
vi.mock("@/server/kick", () => ({ kickAfterResponse: () => {}, kickNow: () => {}, kickIfUnattended: () => {} }));

const state = vi.hoisted(() => ({
  cookies: new Map<string, string>(),
  user: null as null | { sub: string; email: string },
}));
const sdk = vi.hoisted(() => ({ clients: [] as { apiKey: string | null | undefined }[], calls: 0 }));
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
vi.mock("@anthropic-ai/sdk", async (importOriginal) => {
  const real = await importOriginal<typeof import("@anthropic-ai/sdk")>();
  class FakeAnthropic extends real.default {
    constructor(opts?: ConstructorParameters<typeof real.default>[0]) {
      super(opts);
      sdk.clients.push({ apiKey: typeof opts?.apiKey === "string" ? opts.apiKey : process.env.ANTHROPIC_API_KEY });
      Object.assign(this, {
        beta: {
          messages: {
            stream: () => {
              sdk.calls++;
              return {
                finalMessage: async () => ({
                  content: [],
                  usage: { input_tokens: 1000, output_tokens: 100, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
                  stop_reason: "end_turn",
                  parsed_output: { updates: [] },
                }),
              };
            },
          },
        },
      });
    }
  }
  return { ...real, default: FakeAnthropic };
});

let interpretRoute: typeof import("@/app/api/interpret/route");
let paymentRoute: typeof import("@/app/api/account/payment/route");
let keys: typeof import("@/server/apikeys");
let credits: typeof import("@/server/credits");
let db: typeof import("@/server/db");
let ai: typeof import("@/ai/client");

beforeAll(async () => {
  interpretRoute = await import("@/app/api/interpret/route");
  paymentRoute = await import("@/app/api/account/payment/route");
  keys = await import("@/server/apikeys");
  credits = await import("@/server/credits");
  db = await import("@/server/db");
  ai = await import("@/ai/client");
});

beforeEach(() => {
  state.cookies.clear();
  state.user = null;
  sdk.clients.length = 0;
  sdk.calls = 0;
});

let n = 0;
function signIn() {
  n++;
  state.user = { sub: `9b3e0d5f-2c4a-4d6e-9f70-${String(n).padStart(12, "0")}`, email: `checker${n}@example.com` };
  return state.user.sub;
}
const req = (url: string, method: string, body?: unknown) =>
  new Request(`https://panel.example.com${url}`, {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: { "x-panel-peer-test": `198.51.100.${(n % 250) + 1}` },
  });
const check = () => interpretRoute.POST(req("/api/interpret", "POST", { questionId: "what", raw: "A 30-second skit about my cat judging my cooking", answers: [] }));
const choose = (method: "credits" | "own_key") => paymentRoute.POST(req("/api/account/payment", "POST", { method }));
const serverKeyUsed = () => sdk.clients.some((c) => c.apiKey === process.env.ANTHROPIC_API_KEY);

describe("answer checks in hosted mode", () => {
  it("refuses a signed-out visitor before any call, and says to choose how to pay", async () => {
    n++;
    const res = await check();
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ payment: "choose", login: true });
    expect(sdk.calls).toBe(0);
    expect(sdk.clients).toEqual([]);
  });

  it("refuses a signed-in account that hasn't chosen", async () => {
    signIn();
    const res = await check();
    expect(res.status).toBe(402);
    expect((await res.json()).payment).toBe("choose");
    expect(sdk.calls).toBe(0);
  });

  it("refuses own key with no key saved", async () => {
    signIn();
    await choose("own_key");
    const res = await check();
    expect(res.status).toBe(402);
    expect(sdk.calls).toBe(0);
  });

  it("runs on the account's own saved key, never the server's", async () => {
    const userId = signIn();
    const key = `sk-ant-api03-${"k".repeat(40)}abcd`;
    await keys.saveKey(userId, key);
    await choose("own_key");
    const res = await check();
    expect(res.status).toBe(200);
    expect(sdk.calls).toBe(1);
    expect(sdk.clients.map((c) => c.apiKey)).toEqual([key]);
    expect(serverKeyUsed()).toBe(false);
  });

  it("refuses credits with nothing topped up", async () => {
    signIn();
    await choose("credits");
    const res = await check();
    expect(res.status).toBe(402);
    expect(sdk.calls).toBe(0);
  });

  it("charges credits what the call cost plus 20%", async () => {
    const userId = signIn();
    await db.tx((t) => credits.creditTopup(t, { userId, sessionId: `cs_test_${userId}`, paymentIntent: null, amountCents: 1000, eventId: `evt_${userId}`, pack: "usd10" }));
    await choose("credits");
    const before = await credits.creditSummary(userId);
    const res = await check();
    expect(res.status).toBe(200);
    expect(sdk.calls).toBe(1);
    const after = await credits.creditSummary(userId);
    // claude-haiku-5-5: 1000 input tokens at $0.10/M and 100 output at $0.50/M = $0.00015, x 1.2.
    expect(before.balance - after.balance).toBe(credits.withMargin(credits.usdToMicros(0.00015)));
    const [entry] = await db.q<{ kind: string; note: string }>("SELECT kind::text AS kind, note FROM app.credit_ledger WHERE user_id = $1 ORDER BY id DESC LIMIT 1", [userId]);
    expect(entry).toEqual({ kind: "charge", note: "interpret:what" });
  });
});

describe("calls that belong to no review", () => {
  it("never run on the server's key without an account that pays", async () => {
    await expect(
      ai.callStructured({ label: "interpret:what", reviewId: null, model: ai.MODELS.fast, system: "x", messages: [{ role: "user", content: "x" }], schema: z.object({}) }),
    ).rejects.toThrow(ai.NO_PAYER);
    expect(sdk.clients).toEqual([]);
  });

  it("run on the payer set for them", async () => {
    const userId = signIn();
    const key = `sk-ant-api03-${"p".repeat(40)}wxyz`;
    await keys.saveKey(userId, key);
    await ai.asPayer({ userId, method: "own_key" }, () =>
      ai.callStructured({ label: "interpret:what", reviewId: null, model: ai.MODELS.fast, system: "x", messages: [{ role: "user", content: "x" }], schema: z.object({}) }),
    );
    expect(sdk.clients.map((c) => c.apiKey)).toEqual([key]);
  });
});
