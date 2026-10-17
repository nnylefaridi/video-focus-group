import { q, tx, type Query } from "./db";
import { SPEND_LIMITS } from "./config";
import { INSERT_REVIEW, insertReviewParams } from "./reviews";
import type { Who } from "./client";
import { authReady } from "@/lib/supabase";

/**
 * Two layers of protection for the API key:
 * - App-wide daily and monthly caps on what every paid call (reviews, answer
 *   checks, follow-ups) costs, from one log of those calls.
 * - Per-person limits: each account's own when signed in, the network's (hashed
 *   IP) when signed out, plus an overall ceiling per network (see client.ts). Each
 *   use is reserved before the paid work starts, inside locks on those keys, so
 *   tabs racing each other can't get past a limit.
 */
export class LimitReached extends Error {
  /** Logging in would give this person their own allowance. */
  readonly loginHelps: boolean;
  constructor(message: string, opts: { loginHelps?: boolean } = {}) {
    super(message);
    this.loginHelps = opts.loginHelps ?? false;
  }
}

/** The JSON a route sends back when a limit is reached. */
export function limitResponse(e: LimitReached) {
  return Response.json({ error: e.message, ...(e.loginHelps ? { login: true } : {}) }, { status: 429 });
}

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

async function used(query: Query, column: "client_key" | "network_key", key: string, kind: string, since: number): Promise<number> {
  const [row] = await query<{ n: number }>(`SELECT COUNT(*)::int AS n FROM app.usage WHERE ${column} = $1 AND kind = $2 AND at >= $3`, [key, kind, since]);
  return Number(row.n);
}

async function reserve(query: Query, who: Who, kind: string, reviewId: string | null) {
  await query("INSERT INTO app.usage (at, client_key, network_key, kind, review_id) VALUES ($1, $2, $3, $4, $5)", [
    Date.now(),
    who.person,
    who.network,
    kind,
    reviewId,
  ]);
}

/** Locks this person's and this network's allowances, always in the same order so two requests can't deadlock. */
async function lockAllowances(lock: (key: string) => Promise<void>, who: Who) {
  await lock(`usage:${who.network}`);
  if (who.person !== who.network) await lock(`usage:${who.person}`);
}

/**
 * A personal limit was reached. Signed-out people share their network's allowance,
 * so for them logging in (which gives them their own) is the way forward.
 */
function personalLimit(who: Who, signedInMessage: string, signedOutMessage: string): LimitReached {
  // In local mode there are no accounts, so the plain message is the right one.
  return who.signedIn || !authReady ? new LimitReached(signedInMessage) : new LimitReached(signedOutMessage, { loginHelps: true });
}

/**
 * Checks the daily review limits and creates the review in the same transaction,
 * so it counts the moment it exists. A review whose upload is rejected or
 * abandoned is refunded (see deleteReview).
 */
export async function startReview(who: Who, review: Parameters<typeof insertReviewParams>[0]) {
  await tx(async (t, lock) => {
    await lockAllowances(lock, who);
    const s = await assertWithinSpendLimits(t);
    const room = Math.min(s.dailyLimit - s.today, s.monthlyLimit - s.month);
    if (room < SPEND_LIMITS.typicalReviewUsd)
      throw new LimitReached("The app's AI budget left for today is less than one review usually costs. Try again after midnight.");
    const today = startOfToday();
    const n = await used(t, "client_key", who.person, "review", today);
    if (n >= SPEND_LIMITS.maxReviewsPerDay)
      throw personalLimit(
        who,
        `You've started ${n} reviews today, which is the daily limit. It resets at midnight.`,
        "You've used today's reviews without an account. Log in to get your own daily reviews, or come back after midnight.",
      );
    if ((await used(t, "network_key", who.network, "review", today)) >= SPEND_LIMITS.maxReviewsPerNetworkPerDay)
      throw new LimitReached("So many reviews were started from your network today that it has reached its daily limit. It resets at midnight.");
    await t(INSERT_REVIEW, insertReviewParams(review));
    await reserve(t, who, "review", review.id);
  });
}

/** Answer checks in the questionnaire are cheap, but unlimited typing shouldn't run up a bill. */
export async function spendAnswerCheck(who: Who) {
  await tx(async (t, lock) => {
    await lockAllowances(lock, who);
    await assertWithinSpendLimits(t);
    const hourAgo = Date.now() - 3600_000;
    if ((await used(t, "client_key", who.person, "answer_check", hourAgo)) >= SPEND_LIMITS.maxAnswerChecksPerHour)
      throw personalLimit(
        who,
        "Too many answers in the last hour. Take a short break and try again.",
        "Too many answers in the last hour without an account. Log in to keep going, or take a short break.",
      );
    if ((await used(t, "network_key", who.network, "answer_check", hourAgo)) >= SPEND_LIMITS.maxAnswerChecksPerNetworkPerHour)
      throw new LimitReached("Your network has sent too many answers in the last hour. Take a short break and try again.");
    await reserve(t, who, "answer_check", null);
  });
}

/** Follow-up questions per review are capped so one review can't keep spending forever. */
export async function spendFollowup(who: Who, reviewId: string) {
  await tx(async (t, lock) => {
    await lock(`followup:${reviewId}`);
    await assertWithinSpendLimits(t);
    const [row] = await t<{ n: number }>("SELECT COUNT(*)::int AS n FROM app.usage WHERE review_id = $1 AND kind = 'followup'", [reviewId]);
    if (Number(row.n) >= SPEND_LIMITS.maxFollowupsPerReview)
      throw new LimitReached(`This review has reached its limit of ${SPEND_LIMITS.maxFollowupsPerReview} follow-up questions.`);
    await reserve(t, who, "followup", reviewId);
  });
}

export async function followupsUsed(reviewId: string): Promise<number> {
  const [row] = await q<{ n: number }>("SELECT COUNT(*)::int AS n FROM app.usage WHERE review_id = $1 AND kind = 'followup'", [reviewId]);
  return Number(row.n);
}

/** What this person has used of their own limits, for the signed-in reviews page. */
export async function usageFor(who: Who) {
  return {
    reviewsToday: await used(q, "client_key", who.person, "review", startOfToday()),
    maxReviewsPerDay: SPEND_LIMITS.maxReviewsPerDay,
    answerChecksLastHour: await used(q, "client_key", who.person, "answer_check", Date.now() - 3600_000),
    maxAnswerChecksPerHour: SPEND_LIMITS.maxAnswerChecksPerHour,
    maxFollowupsPerReview: SPEND_LIMITS.maxFollowupsPerReview,
  };
}
