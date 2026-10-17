/**
 * Spending protection: every limit stops further paid calls once it is reached.
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
let f: typeof import("@/server/followups");
let d: typeof import("@/server/db");

beforeAll(async () => {
  b = await import("@/server/budget");
  r = await import("@/server/reviews");
  f = await import("@/server/followups");
  d = await import("@/server/db");
});

function review() {
  const id = r.newReviewId();
  r.createReview({ id, answers: [], intent: { category: "creator" }, board: ["mrbeast"], title: "t" });
  d.db().prepare("UPDATE reviews SET stage = 'done' WHERE id = ?").run(id);
  return id;
}

describe("spending limits", () => {
  it("allows calls while under budget and logs every call", () => {
    expect(() => b.assertWithinSpendLimits()).not.toThrow();
    b.recordSpend({ label: "interpret:what", model: "claude-haiku-5-5", usd: 0.01 });
    expect(b.spendSummary().today).toBeCloseTo(0.01);
  });

  it("caps answer checks per hour", () => {
    b.recordSpend({ label: "interpret:niche", model: "claude-haiku-5-5", usd: 0.01 });
    expect(() => b.assertCanInterpret()).not.toThrow();
    b.recordSpend({ label: "interpret:audience", model: "claude-haiku-5-5", usd: 0.01 });
    expect(() => b.assertCanInterpret()).toThrow(/Too many answers/);
  });

  it("caps reviews per day", () => {
    expect(() => b.assertCanStartReview()).not.toThrow();
    review();
    review();
    expect(() => b.assertCanStartReview()).toThrow(/daily limit/);
  });

  it("caps follow-up questions per review", () => {
    const id = review();
    f.addMessage(id, "mrbeast", "user", "one");
    expect(() => b.assertCanAskFollowup(id)).not.toThrow();
    f.addMessage(id, "mrbeast", "user", "two");
    expect(() => b.assertCanAskFollowup(id)).toThrow(/limit of 2 follow-up/);
  });

  it("refuses a new review that can't fit in what's left of the budget", () => {
    d.db().prepare("DELETE FROM reviews").run();
    b.recordSpend({ label: "review:x", model: "claude-opus-5-5", usd: 0.9 });
    expect(() => b.assertCanStartReview()).toThrow(/usually costs about/);
  });

  it("stops every paid call once today's budget is used up", () => {
    b.recordSpend({ label: "review:x", model: "claude-opus-5-5", usd: 1.5 });
    expect(() => b.assertWithinSpendLimits()).toThrow(/Today's API budget/);
  });

  it("stops every paid call once this month's budget is used up", () => {
    const lastWeek = Date.now() - 2 * 86400_000;
    const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).getTime();
    d.db().prepare("INSERT INTO spend (at, label, model, usd) VALUES (?, 'old', 'x', 5)").run(Math.max(lastWeek, monthStart));
    expect(() => b.assertWithinSpendLimits()).toThrow(/month's API budget/);
  });
});
