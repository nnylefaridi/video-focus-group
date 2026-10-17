import { q, tx, type Query } from "./db";
import { SPEND_LIMITS } from "./config";
import { INSERT_REVIEW, insertReviewParams } from "./reviews";

/**
 * Two layers of protection for the API key:
 * - App-wide daily and monthly caps on what every paid call (reviews, answer
 *   checks, follow-ups) costs, from one log of those calls.
 * - Per-person limits keyed by IP address (see client.ts). Each use is reserved
 *   before the paid work starts, inside a lock on that person's key, so tabs
 *   racing each other can't get past a limit.
 */
export class LimitReached extends Error {}

export async function recordSpend(entry: { label: string; model: string; usd: number; reviewId?: string }) {
  await q("INSERT INTO app.spend (at, label, model, usd, review_id) VALUES ($1, $2, $3, $4, $5)", [
    Date.now(),
    entry.label,
    entry.model,
    entry.usd,
    entry.reviewId ?? null,
  ]);
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

async function spentSince(t: number, query: Query = q): Promise<number> {
  const [row] = await query<{ usd: number }>("SELECT COALESCE(SUM(usd), 0)::float8 AS usd FROM app.spend WHERE at >= $1", [t]);
  return Number(row.usd);
}

export async function spendSummary(query: Query = q) {
  return {
    today: await spentSince(startOfToday(), query),
    month: await spentSince(startOfMonth(), query),
    dailyLimit: SPEND_LIMITS.dailyUsd,
    monthlyLimit: SPEND_LIMITS.monthlyUsd,
  };
}

/** Throws before any paid call once the app's budget for today or this month is used up. */
export async function assertWithinSpendLimits(query: Query = q) {
  const s = await spendSummary(query);
  if (s.month >= s.monthlyLimit) throw new LimitReached("This month's AI budget for the app is used up. It resets on the 1st.");
  if (s.today >= s.dailyLimit) throw new LimitReached("Today's AI budget for the app is used up. It resets at midnight.");
  return s;
}

async function used(query: Query, key: string, kind: string, since: number): Promise<number> {
  const [row] = await query<{ n: number }>("SELECT COUNT(*)::int AS n FROM app.usage WHERE client_key = $1 AND kind = $2 AND at >= $3", [key, kind, since]);
  return Number(row.n);
}

async function reserve(query: Query, key: string, kind: string, reviewId: string | null) {
  await query("INSERT INTO app.usage (at, client_key, kind, review_id) VALUES ($1, $2, $3, $4)", [Date.now(), key, kind, reviewId]);
}

/**
 * Checks this person's daily review limit and creates the review in the same
 * transaction, so it counts the moment it exists. A review whose upload is
 * rejected or abandoned is refunded (see deleteReview).
 */
export async function startReview(key: string, review: Parameters<typeof insertReviewParams>[0]) {
  await tx(async (t, lock) => {
    await lock(`usage:${key}`);
    const s = await assertWithinSpendLimits(t);
    const room = Math.min(s.dailyLimit - s.today, s.monthlyLimit - s.month);
    if (room < SPEND_LIMITS.typicalReviewUsd)
      throw new LimitReached("The app's AI budget left for today is less than one review usually costs. Try again after midnight.");
    const n = await used(t, key, "review", startOfToday());
    if (n >= SPEND_LIMITS.maxReviewsPerDay)
      throw new LimitReached(`You've started ${n} reviews today, which is the daily limit. It resets at midnight.`);
    await t(INSERT_REVIEW, insertReviewParams(review));
    await reserve(t, key, "review", review.id);
  });
}

/** Answer checks in the questionnaire are cheap, but unlimited typing shouldn't run up a bill. */
export async function spendAnswerCheck(key: string) {
  await tx(async (t, lock) => {
    await lock(`usage:${key}`);
    await assertWithinSpendLimits(t);
    if ((await used(t, key, "answer_check", Date.now() - 3600_000)) >= SPEND_LIMITS.maxAnswerChecksPerHour)
      throw new LimitReached("Too many answers in the last hour. Take a short break and try again.");
    await reserve(t, key, "answer_check", null);
  });
}

/** Follow-up questions per review are capped so one review can't keep spending forever. */
export async function spendFollowup(key: string, reviewId: string) {
  await tx(async (t, lock) => {
    await lock(`followup:${reviewId}`);
    await assertWithinSpendLimits(t);
    const [row] = await t<{ n: number }>("SELECT COUNT(*)::int AS n FROM app.usage WHERE review_id = $1 AND kind = 'followup'", [reviewId]);
    if (Number(row.n) >= SPEND_LIMITS.maxFollowupsPerReview)
      throw new LimitReached(`This review has reached its limit of ${SPEND_LIMITS.maxFollowupsPerReview} follow-up questions.`);
    await reserve(t, key, "followup", reviewId);
  });
}

export async function followupsUsed(reviewId: string): Promise<number> {
  const [row] = await q<{ n: number }>("SELECT COUNT(*)::int AS n FROM app.usage WHERE review_id = $1 AND kind = 'followup'", [reviewId]);
  return Number(row.n);
}

/** What this person has used of their limits, for the signed-in reviews page. */
export async function usageFor(key: string) {
  return {
    reviewsToday: await used(q, key, "review", startOfToday()),
    maxReviewsPerDay: SPEND_LIMITS.maxReviewsPerDay,
    answerChecksLastHour: await used(q, key, "answer_check", Date.now() - 3600_000),
    maxAnswerChecksPerHour: SPEND_LIMITS.maxAnswerChecksPerHour,
    maxFollowupsPerReview: SPEND_LIMITS.maxFollowupsPerReview,
  };
}
