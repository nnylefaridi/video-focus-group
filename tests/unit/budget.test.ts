/**
 * Spending protection and per-person limits, against a real (in-process) Postgres.
 * Every limit stops further paid calls once it is reached, and limits are per IP:
 * parallel tabs on one connection can't get past them, other connections aren't affected.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "panel-budget-"));
process.env.DAILY_LIMIT_USD = "2";
process.env.MONTHLY_LIMIT_USD = "3";
process.env.MAX_REVIEWS_PER_DAY = "2";
process.env.MAX_FOLLOWUPS_PER_REVIEW = "2";
process.env.MAX_ANSWER_CHECKS_PER_HOUR = "3";

let b: typeof import("@/server/budget");
let r: typeof import("@/server/reviews");
let d: typeof import("@/server/db");
let c: typeof import("@/server/client");

beforeAll(async () => {
  b = await import("@/server/budget");
  r = await import("@/server/reviews");
  d = await import("@/server/db");
  c = await import("@/server/client");
});

// What server.mjs does: the connection's address under a per-run header name.
process.env.PANEL_PEER_HEADER = "x-panel-peer-test";
const ip = (addr: string) => c.clientKey(new Headers({ "x-panel-peer-test": addr }));

function start(key: string, owner: { userId?: string | null; anonId?: string | null } = {}) {
  const id = r.newReviewId();
  return b
    .startReview(key, { id, answers: [], intent: { category: "creator" }, board: ["mrbeast"], title: "t", userId: owner.userId ?? null, anonId: owner.anonId ?? null })
    .then(() => id);
}

describe("who counts as one person", () => {
  it("uses the address the server saw, never one the browser made up", () => {
    expect(c.clientIp(new Headers({ "x-panel-peer-test": "203.0.113.9", "x-forwarded-for": "6.6.6.6", "x-real-ip": "7.7.7.7" }))).toBe("203.0.113.9");
    // Not started through server.mjs and no host header configured: one shared allowance, not a free pass.
    delete process.env.PANEL_PEER_HEADER;
    expect(c.clientIp(new Headers({ "x-forwarded-for": "6.6.6.6" }))).toBe("unknown");
    process.env.PANEL_PEER_HEADER = "x-panel-peer-test";
  });

  it("can read a platform's own client-IP header instead", () => {
    process.env.CLIENT_IP_HEADER = "cf-connecting-ip";
    expect(c.clientIp(new Headers({ "x-forwarded-for": "10.0.0.1", "cf-connecting-ip": "198.51.100.4" }))).toBe("198.51.100.4");
    delete process.env.CLIENT_IP_HEADER;
  });

  it("treats a whole IPv6 /64 as one connection, and unwraps IPv4-mapped addresses", () => {
    expect(c.normalizeIp("2001:db8:abcd:12:1111:2222:3333:4444")).toBe("2001:db8:abcd:12::/64");
    expect(c.normalizeIp("2001:db8:abcd:12::9")).toBe("2001:db8:abcd:12::/64");
    expect(c.normalizeIp("::ffff:192.0.2.7")).toBe("192.0.2.7");
    expect(c.normalizeIp("[2001:db8::1]:443")).toBe("2001:db8:0:0::/64");
    expect(c.normalizeIp("192.0.2.7:5555")).toBe("192.0.2.7");
  });

  it("never stores the address itself", () => {
    expect(ip("203.0.113.9")).not.toContain("203");
    expect(ip("203.0.113.9")).toBe(ip("203.0.113.9"));
    expect(ip("203.0.113.9")).not.toBe(ip("203.0.113.10"));
  });
});

describe("per-person limits", () => {
  it("caps answer checks per hour for one connection only", async () => {
    const a = ip("198.51.100.1");
    for (let i = 0; i < 3; i++) await b.spendAnswerCheck(a);
    await expect(b.spendAnswerCheck(a)).rejects.toThrow(/Too many answers/);
    await expect(b.spendAnswerCheck(ip("198.51.100.2"))).resolves.toBeUndefined();
  });

  it("lets only the daily number of reviews through when many tabs start at once", async () => {
    const a = ip("198.51.100.3");
    const results = await Promise.allSettled(Array.from({ length: 6 }, () => start(a)));
    expect(results.filter((x) => x.status === "fulfilled")).toHaveLength(2);
    const refused = results.find((x) => x.status === "rejected") as PromiseRejectedResult;
    expect(refused.reason.message).toMatch(/daily limit/);
    expect((await b.usageFor(a)).reviewsToday).toBe(2);
  });

  it("gives the review back when its upload is rejected, but not when a finished review is deleted", async () => {
    const a = ip("198.51.100.4");
    const first = await start(a);
    await start(a);
    await r.deleteReview(first, { refund: true });
    const third = await start(a);
    await r.deleteReview(third);
    await expect(start(a)).rejects.toThrow(/daily limit/);
  });

  it("caps follow-up questions per review, even when sent in parallel", async () => {
    const a = ip("198.51.100.5");
    const id = await start(a);
    const results = await Promise.allSettled(Array.from({ length: 5 }, () => b.spendFollowup(a, id)));
    expect(results.filter((x) => x.status === "fulfilled")).toHaveLength(2);
    await expect(b.spendFollowup(a, id)).rejects.toThrow(/limit of 2 follow-up/);
    expect(await b.followupsUsed(id)).toBe(2);
  });
});

describe("who can see a review", () => {
  it("belongs to the browser that made it until sign-in, then to the account", async () => {
    const id = await start(ip("198.51.100.6"), { anonId: "browser-one" });
    let rec = (await r.getReview(id))!;
    expect(r.canAccess(rec, { userId: null, anonId: "browser-one" })).toBe(true);
    expect(r.canAccess(rec, { userId: null, anonId: "browser-two" })).toBe(false);

    const user = "4f1c1f2e-8e0e-4b9a-9d55-0d6c1b2a3c4d";
    const claimed = await r.claimAnonymous(user, "browser-one");
    expect(claimed.map((x) => x.id)).toContain(id);
    rec = (await r.getReview(id))!;
    expect(r.canAccess(rec, { userId: user, anonId: null })).toBe(true);
    // Signed out again in the same browser: it's the account's now, not the browser's.
    expect(r.canAccess(rec, { userId: null, anonId: "browser-one" })).toBe(false);
    expect((await r.listReviewsFor(user)).map((x) => x.id)).toContain(id);
  });
});

describe("app-wide spending caps", () => {
  it("logs every call", async () => {
    await b.recordSpend({ label: "interpret:what", model: "claude-haiku-5-5", usd: 0.01 });
    expect((await b.spendSummary()).today).toBeCloseTo(0.01);
  });

  it("adds parallel calls to a review's cost without losing any", async () => {
    const id = await start(ip("198.51.100.7"));
    await Promise.all(Array.from({ length: 10 }, (_, i) => r.addCost(id, { label: `x${i}`, model: "m", usd: 0.1, inTok: 1, outTok: 1 })));
    const rec = (await r.getReview(id))!;
    expect(rec.cost.usd).toBeCloseTo(1);
    expect(rec.cost.calls).toHaveLength(10);
  });

  it("refuses a new review that can't fit in what's left of the budget", async () => {
    await b.recordSpend({ label: "review:x", model: "claude-opus-5-5", usd: 0.9 });
    await expect(start(ip("198.51.100.8"))).rejects.toThrow(/less than one review usually costs/);
  });

  it("stops every paid call once today's budget is used up", async () => {
    await b.recordSpend({ label: "review:x", model: "claude-opus-5-5", usd: 1.5 });
    await expect(b.assertWithinSpendLimits()).rejects.toThrow(/Today's AI budget/);
    await expect(b.spendAnswerCheck(ip("198.51.100.9"))).rejects.toThrow(/Today's AI budget/);
  });

  it("stops every paid call once this month's budget is used up", async () => {
    const lastWeek = Date.now() - 2 * 86400_000;
    const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).getTime();
    await d.q("INSERT INTO app.spend (at, label, model, usd) VALUES ($1, 'old', 'x', 5)", [Math.max(lastWeek, monthStart)]);
    await expect(b.assertWithinSpendLimits()).rejects.toThrow(/month's AI budget/);
  });
});
