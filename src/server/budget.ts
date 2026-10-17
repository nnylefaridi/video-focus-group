import { db } from "./db";
import { SPEND_LIMITS } from "./config";

/**
 * One log of every paid API call (reviews, answer checks, follow-ups), so spending
 * can be capped per day and per month across the whole app, not just per review.
 */
let ready = false;
function ensureTable() {
  if (ready) return;
  // Immediate transaction: the web app and worker may both start at once; only one backfills.
  db()
    .transaction(() => {
      const existed = db()
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name='spend'",
        )
        .get();
      db().exec(`
    CREATE TABLE IF NOT EXISTS spend (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      at INTEGER NOT NULL,
      label TEXT NOT NULL,
      model TEXT NOT NULL,
      usd REAL NOT NULL,
      review_id TEXT
    );
    CREATE INDEX IF NOT EXISTS spend_at ON spend(at);
  `);
      // First run: count reviews made before this log existed, so they still count toward the caps.
      if (!existed) {
        db()
          .prepare(
            "INSERT INTO spend (at, label, model, usd, review_id) SELECT updated_at, 'earlier review', 'mixed', json_extract(cost, '$.usd'), id FROM reviews WHERE json_extract(cost, '$.usd') > 0",
          )
          .run();
      }
    })
    .immediate();
  ready = true;
}

export class LimitReached extends Error {}

export function recordSpend(entry: {
  label: string;
  model: string;
  usd: number;
  reviewId?: string;
}) {
  ensureTable();
  db()
    .prepare(
      "INSERT INTO spend (at, label, model, usd, review_id) VALUES (?, ?, ?, ?, ?)",
    )
    .run(
      Date.now(),
      entry.label,
      entry.model,
      entry.usd,
      entry.reviewId ?? null,
    );
}

function startOfToday(): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function startOfMonth(): number {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).getTime();
}

function spentSince(t: number): number {
  ensureTable();
  const row = db()
    .prepare("SELECT COALESCE(SUM(usd), 0) AS usd FROM spend WHERE at >= ?")
    .get(t) as { usd: number };
  return row.usd;
}

export function spendSummary() {
  return {
    today: spentSince(startOfToday()),
    month: spentSince(startOfMonth()),
    dailyLimit: SPEND_LIMITS.dailyUsd,
    monthlyLimit: SPEND_LIMITS.monthlyUsd,
  };
}

const money = (n: number) => `$${n.toFixed(2)}`;

/** Throws before any paid call once today's or this month's cap is used up. */
export function assertWithinSpendLimits() {
  const s = spendSummary();
  if (s.month >= s.monthlyLimit)
    throw new LimitReached(
      `This month's API budget (${money(s.monthlyLimit)}) is used up. It resets on the 1st, or raise MONTHLY_LIMIT_USD in .env.local.`,
    );
  if (s.today >= s.dailyLimit)
    throw new LimitReached(
      `Today's API budget (${money(s.dailyLimit)}) is used up. It resets at midnight, or raise DAILY_LIMIT_USD in .env.local.`,
    );
}

/** A new review needs room for a typical review's cost in today's and this month's budget. */
export function assertCanStartReview() {
  assertWithinSpendLimits();
  const s = spendSummary();
  const room = Math.min(s.dailyLimit - s.today, s.monthlyLimit - s.month);
  if (room < SPEND_LIMITS.typicalReviewUsd)
    throw new LimitReached(
      `Only ${money(Math.max(0, room))} of today's or this month's API budget is left, and a review usually costs about ${money(SPEND_LIMITS.typicalReviewUsd)}. Try again after the budget resets.`,
    );
  const started = db()
    .prepare(
      "SELECT COUNT(*) AS n FROM reviews WHERE created_at >= ? AND stage != 'uploading'",
    )
    .get(startOfToday()) as { n: number };
  if (started.n >= SPEND_LIMITS.maxReviewsPerDay)
    throw new LimitReached(
      `You've started ${started.n} reviews today, which is the daily limit (MAX_REVIEWS_PER_DAY). It resets at midnight.`,
    );
}

/** Answer checks in the questionnaire are cheap but unlimited typing shouldn't run up a bill. */
export function assertCanInterpret() {
  assertWithinSpendLimits();
  ensureTable();
  const hourAgo = Date.now() - 3600_000;
  const row = db()
    .prepare(
      "SELECT COUNT(*) AS n FROM spend WHERE at >= ? AND label LIKE 'interpret:%'",
    )
    .get(hourAgo) as { n: number };
  if (row.n >= SPEND_LIMITS.maxAnswerChecksPerHour)
    throw new LimitReached(
      "Too many answers in the last hour. Take a short break and try again.",
    );
}

/** Follow-up questions per review are capped so one review can't keep spending forever. */
export function assertCanAskFollowup(reviewId: string) {
  assertWithinSpendLimits();
  const row = db()
    .prepare(
      "SELECT COUNT(*) AS n FROM followups WHERE review_id = ? AND role = 'user'",
    )
    .get(reviewId) as { n: number };
  if (row.n >= SPEND_LIMITS.maxFollowupsPerReview)
    throw new LimitReached(
      `This review has reached its limit of ${SPEND_LIMITS.maxFollowupsPerReview} follow-up questions.`,
    );
}
