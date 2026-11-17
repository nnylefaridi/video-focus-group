/**
 * Hosted mode's account pages: signed-out visitors are sent to sign-in, local mode has
 * no account pages, and a signed-in account only ever sees its own billing, history and
 * reviews. Real server code against an in-process Postgres; the Supabase session is a
 * stand-in (no network).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "panel-account-"));
process.env.PANEL_MODE = "hosted";
process.env.MEDIA_SECRET = Buffer.alloc(32, 9).toString("base64");
process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_test";
process.env.HOSTED_PUBLIC_URL = "https://panel.example.com";
process.env.ANTHROPIC_API_KEY = "sk-ant-test-not-used";
process.env.KEY_ENCRYPTION_SECRET = Buffer.alloc(32, 7).toString("base64");

const state = vi.hoisted(() => ({ user: null as null | { sub: string; email: string } }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined, getAll: () => [], set: () => {} }),
}));
vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  useRouter: () => ({ refresh() {}, push() {}, replace() {}, back() {} }),
}));
vi.mock("next/server", async (importOriginal) => ({ ...(await importOriginal<typeof import("next/server")>()), connection: async () => {} }));
vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({ auth: { getClaims: async () => ({ data: state.user ? { claims: state.user } : null }) } }),
}));

const ALICE = { sub: "11111111-1111-4111-8111-111111111111", email: "alice@example.com" };
const BOB = { sub: "22222222-2222-4222-8222-222222222222", email: "bob@example.com" };

let account: typeof import("@/server/account");
let credits: typeof import("@/server/credits");
let reviews: typeof import("@/server/reviews");
let db: typeof import("@/server/db");
let accountPage: typeof import("@/app/account/page");
let donePage: typeof import("@/app/account/topup/done/page");
let cancelledPage: typeof import("@/app/account/topup/cancelled/page");
let board: string[];
let aliceReview: string;

/** What a Next.js redirect() throws: its digest carries the destination. */
async function redirectOf(run: () => Promise<unknown>): Promise<string | null> {
  try {
    await run();
    return null;
  } catch (e) {
    const digest = (e as { digest?: string }).digest;
    if (typeof digest === "string" && digest.startsWith("NEXT_REDIRECT")) return digest.split(";")[2];
    throw e;
  }
}

async function topup(userId: string, session: string, cents: number) {
  await db.tx((t) => credits.creditTopup(t, { userId, sessionId: session, paymentIntent: `pi_${session}`, amountCents: cents, eventId: `evt_${session}`, pack: "usd10" }));
}

beforeAll(async () => {
  account = await import("@/server/account");
  credits = await import("@/server/credits");
  reviews = await import("@/server/reviews");
  db = await import("@/server/db");
  accountPage = await import("@/app/account/page");
  donePage = await import("@/app/account/topup/done/page");
  cancelledPage = await import("@/app/account/topup/cancelled/page");
  const { liveProfiles } = await import("@/experts/load");
  board = [liveProfiles()[0].id];

  // Alice has a review with a charge, a top-up and one review still running; Bob has only a small top-up.
  aliceReview = reviews.newReviewId();
  await reviews.createReview({ id: aliceReview, answers: [], intent: { category: "creator" }, board, title: "Alice's secret cat skit", userId: ALICE.sub });
  await topup(ALICE.sub, "cs_alice_1", 2500);
  const done = await credits.reserve(ALICE.sub, aliceReview, "review");
  await db.q("UPDATE app.credit_reservations SET cost = 500000 WHERE id = $1", [done]);
  await credits.settleReservation(done);
  const running = reviews.newReviewId();
  await reviews.createReview({ id: running, answers: [], intent: { category: "creator" }, board, title: "Alice's still running", userId: ALICE.sub });
  await credits.reserve(ALICE.sub, running, "review");
  await topup(BOB.sub, "cs_bob_1", 1000);
});

beforeEach(() => {
  state.user = null;
  process.env.PANEL_MODE = "hosted";
});

describe("who gets an account page", () => {
  it("sends a signed-out visitor to sign-in, and returns to the account page afterwards", async () => {
    expect(await account.accountFor({ userId: null })).toEqual({ redirect: "/login?next=/account" });
    expect(await redirectOf(() => accountPage.default())).toBe("/login?next=/account");
    expect(await redirectOf(() => donePage.default({ searchParams: Promise.resolve({ session_id: "cs_alice_1" }) }))).toBe("/login?next=/account");
    expect(await redirectOf(() => cancelledPage.default())).toBe("/login?next=/account");
  });

  it("has no account pages in local mode (no accounts), even for a signed-in session", async () => {
    process.env.PANEL_MODE = "local";
    state.user = ALICE;
    expect(await account.accountFor({ userId: ALICE.sub })).toEqual({ redirect: "/reviews" });
    expect(await redirectOf(() => accountPage.default())).toBe("/reviews");
    expect(await redirectOf(() => donePage.default({ searchParams: Promise.resolve({}) }))).toBe("/reviews");
    expect(await redirectOf(() => cancelledPage.default())).toBe("/reviews");
  });
});

describe("what a signed-in account sees", () => {
  it("is its own balance, running reservations and history, with charges linked to their reviews", async () => {
    const result = await account.accountFor({ userId: ALICE.sub });
    if (!("view" in result)) throw new Error("expected a view");
    const { payment, history, reservations } = result.view;
    expect(payment.credits.balance).toBe(25_000_000 - credits.withMargin(500_000));
    expect(reservations).toHaveLength(1);
    expect(reservations[0]).toMatchObject({ reviewTitle: "Alice's still running", purpose: "review" });
    const kinds = history.map((h) => h.kind);
    expect(kinds).toContain("topup");
    expect(kinds).toContain("charge");
    expect(kinds).toContain("release");
    // Setting credit aside isn't a history line; it's shown as an open reservation.
    expect(kinds).not.toContain("reserve" as never);
    const charge = history.find((h) => h.kind === "charge")!;
    expect(charge).toMatchObject({ amount: -credits.withMargin(500_000), reviewId: aliceReview, reviewTitle: "Alice's secret cat skit", detail: "Review" });
    expect(history.find((h) => h.kind === "topup")).toMatchObject({ amount: 25_000_000, detail: "Credits added", reviewId: null });
    // Newest first.
    expect(history.map((h) => h.id)).toEqual([...history.map((h) => h.id)].sort((a, b) => b - a));
  });

  it("never includes another account's credits, history, reservations or review titles", async () => {
    const result = await account.accountFor({ userId: BOB.sub });
    if (!("view" in result)) throw new Error("expected a view");
    expect(result.view.payment.credits.balance).toBe(10_000_000);
    expect(result.view.reservations).toEqual([]);
    expect(result.view.history).toHaveLength(1);
    expect(JSON.stringify(result.view)).not.toContain("Alice");

    state.user = BOB;
    const html = renderToStaticMarkup(await accountPage.default());
    expect(html).toContain("bob@example.com");
    expect(html).not.toContain("alice@example.com");
    expect(html).not.toContain("Alice");
    expect(html).not.toContain(aliceReview);
  });

  it("doesn't show another account's review title even if a ledger line names its id", async () => {
    // A line on Bob's ledger that points at Alice's review id: the title is looked up for the owner only.
    const id = await credits.reserve(BOB.sub, aliceReview, "review");
    await credits.settleReservation(id);
    const history = await credits.creditHistory(BOB.sub);
    expect(history.some((h) => h.reviewId === aliceReview)).toBe(true);
    expect(history.every((h) => h.reviewTitle === null)).toBe(true);
    expect((await credits.openReservations(BOB.sub)).every((r) => r.reviewTitle === null)).toBe(true);
  });

  it("renders the sections: billing, payment method, API key, past reviews, with the no-cash-refund note and legal links", async () => {
    state.user = ALICE;
    const html = renderToStaticMarkup(await accountPage.default());
    for (const text of ["Billing and usage", "How you pay", "Your Anthropic API key", "Past reviews", "History", "Alice&#x27;s secret cat skit"]) expect(html).toContain(text);
    for (const pack of ["Add $10", "Add $25", "Add $50"]) expect(html).toContain(pack);
    expect(html).toContain("Unused credit isn&#x27;t refunded in cash");
    expect(html).toContain('href="/privacy"');
    expect(html).toContain('href="/terms"');
    expect(html).toContain('href="/reviews"');
    expect(html).toContain("Log out");
    expect(html).not.toMatch(/\bPanel\b/);
  });

  it("shows the checkout return pages to a signed-in account", async () => {
    state.user = ALICE;
    const done = renderToStaticMarkup(await donePage.default({ searchParams: Promise.resolve({ session_id: "cs_alice_1" }) }));
    expect(done).toContain("Thanks for your payment");
    // Until the server confirms it, the page says it's checking; it never claims credit on its own.
    expect(done).toContain("Adding your credits");
    expect(done).not.toContain("Your credits are in");
    const cancelled = renderToStaticMarkup(await cancelledPage.default());
    expect(cancelled).toContain("Nothing was charged");
  });
});

describe("privacy and terms", () => {
  it("are plain pages that name the product and say the things they must", async () => {
    const privacy = renderToStaticMarkup(createElement((await import("@/app/privacy/page")).default));
    const terms = renderToStaticMarkup(createElement((await import("@/app/terms/page")).default));
    for (const html of [privacy, terms]) {
      expect(html).toContain("Video Focus Group");
      expect(html).not.toMatch(/\bPanel\b/);
      expect(html).not.toMatch(/DRAFT/);
      expect(html).toContain("isn&#x27;t affiliated with or endorsed by");
    }
    expect(privacy).toContain("never sees or stores card numbers");
    expect(privacy).toContain("Anthropic");
    expect(privacy).toContain("encrypted");
    expect(terms).toContain("isn&#x27;t refunded in cash");
    expect(terms).toMatch(/predict views, virality, sales/);
  });

  it("carry the draft marker in their source, and docs/legal-review.md says so", () => {
    for (const f of ["src/app/privacy/page.tsx", "src/app/terms/page.tsx"]) {
      expect(fs.readFileSync(path.join(process.cwd(), f), "utf8").split("\n")[0]).toBe("// DRAFT — needs Nyle's review before launch. See docs/legal-review.md.");
    }
    expect(fs.readFileSync(path.join(process.cwd(), "docs/legal-review.md"), "utf8")).toContain("DRAFT — needs Nyle's review before launch");
  });
});

describe("the first screen", () => {
  it("doesn't link the account, privacy or terms pages", () => {
    const flow = fs.readFileSync(path.join(process.cwd(), "src/components/flow/QuestionStep.tsx"), "utf8");
    const page = fs.readFileSync(path.join(process.cwd(), "src/app/page.tsx"), "utf8");
    for (const src of [flow, page]) expect(src).not.toMatch(/\/account|\/privacy|\/terms|LegalLinks/);
  });
});
