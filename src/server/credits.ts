import { AsyncLocalStorage } from "node:async_hooks";
import { q, tx, type Query } from "./db";
import { ANSWER_STALE_MS } from "./followups";
import { COST_CAP_USD, FOLLOWUP_COST_CAP_USD } from "./config";
import {
  formatMicros,
  followupNeedsCreditsMessage,
  MICROS_PER_CENT,
  MICROS_PER_USD,
  needsCreditsMessage,
  ON_HOLD,
  RESERVATION_USED,
  describeEntry,
  type CreditSummary,
  type HistoryEntry,
  type OpenReservation,
} from "@/core/credits";

/**
 * Hosted mode: prepaid credits. Every amount is a whole number of micro-dollars. The
 * account row is locked (SELECT ... FOR UPDATE) for every change to it, and every
 * change is written to the append-only app.credit_ledger.
 *
 * MARGIN: credits pay Anthropic's cost plus 20%. Anthropic's cost of every paid call
 * is already recorded per call (app.spend and the review's cost), and that same cost
 * is what's charged here, times MARGIN, rounded up to the micro-dollar.
 *
 * Why 20% is enough, even on the smallest ($10) top-up spent in full:
 *   Stripe's fee on $10:          0.029 x $10 + $0.30           = $0.59
 *   Anthropic's cost of $10 used:  $10 / 1.2                     = $8.3333
 *   margin kept:                   $10 - $8.3333                 = $1.6667
 *   left after Stripe's fee:       $1.6667 - $0.59               = +$1.0767
 *   international card (+1.5%) and currency conversion (+1%): fee = 0.054 x $10 + $0.30
 *                                                                = $0.84, leaving +$0.8267
 * Bigger packs do better, since the fixed $0.30 is spread wider ($50: +$6.52 domestic).
 * docs/billing.md has the full working.
 */
export const MARGIN = 1.2;
/** MARGIN as a fraction, so charges are worked out in whole numbers. */
const MARGIN_NUM = 6;
const MARGIN_DEN = 5;
if (MARGIN_NUM / MARGIN_DEN !== MARGIN) throw new Error("MARGIN_NUM / MARGIN_DEN must equal MARGIN");

/** Cost (micro-dollars) x MARGIN, rounded up. */
export function withMargin(costMicros: number): number {
  return Math.floor((costMicros * MARGIN_NUM + MARGIN_DEN - 1) / MARGIN_DEN);
}

/** Dollars as micro-dollars, rounded up (in Panel's favour, by at most one millionth of a dollar). */
export function usdToMicros(usd: number): number {
  return Math.ceil(Number((usd * MICROS_PER_USD).toFixed(3)));
}

/** What a review sets aside while it runs: its cost cap (REVIEW_COST_CAP_USD) with the margin. */
export function reviewReserve(): number {
  return withMargin(usdToMicros(COST_CAP_USD));
}

/** What one follow-up answer sets aside while it's written (FOLLOWUP_COST_CAP_USD with the margin). */
export function followupReserve(): number {
  return withMargin(usdToMicros(FOLLOWUP_COST_CAP_USD));
}

/** The account can't pay for this right now. The message says why and what to do. */
export class NotEnoughCredits extends Error {}

/** What a route sends back when credits can't pay. The flow shows the credits panel for it. */
export function creditsResponse(e: NotEnoughCredits) {
  return Response.json({ error: e.message, payment: "credits" }, { status: 402 });
}

type AccountRow = { balance: string; reserved: string; owed: string; on_hold_at: string | null };
type Account = { balance: number; reserved: number; owed: number; onHold: boolean };

const toAccount = (r: AccountRow | undefined): Account => ({
  balance: Number(r?.balance ?? 0),
  reserved: Number(r?.reserved ?? 0),
  owed: Number(r?.owed ?? 0),
  onHold: r?.on_hold_at != null,
});

/** Creates the account's row if it has none, then locks it until the transaction ends. */
async function lockAccount(t: Query, userId: string): Promise<Account> {
  await t("INSERT INTO app.credit_accounts (user_id, updated_at) VALUES ($1, $2) ON CONFLICT (user_id) DO NOTHING", [userId, Date.now()]);
  const [row] = await t<AccountRow>("SELECT balance, reserved, owed, on_hold_at FROM app.credit_accounts WHERE user_id = $1 FOR UPDATE", [userId]);
  return toAccount(row);
}

type Entry = {
  kind: "topup" | "reserve" | "charge" | "release" | "adjustment";
  amount: number;
  reservationId?: number | null;
  reviewId?: string | null;
  stripeEventId?: string | null;
  stripeSessionId?: string | null;
  stripePaymentIntent?: string | null;
  uncollected?: number;
  note?: string | null;
};

/** Applies a change to the (locked) account and writes it to the ledger. The table's checks refuse anything that would go negative. */
async function post(t: Query, userId: string, acct: Account, change: { balance?: number; reserved?: number }, e: Entry): Promise<Account> {
  const next = { ...acct, balance: acct.balance + (change.balance ?? 0), reserved: acct.reserved + (change.reserved ?? 0) };
  await t("UPDATE app.credit_accounts SET balance = $2, reserved = $3, updated_at = $4 WHERE user_id = $1", [userId, next.balance, next.reserved, Date.now()]);
  await t(
    `INSERT INTO app.credit_ledger (user_id, kind, amount, balance_after, reserved_after, uncollected, reservation_id, review_id,
       stripe_event_id, stripe_session_id, stripe_payment_intent, note, at)
     VALUES ($1, $2::text::app.credit_entry, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
    [
      userId,
      e.kind,
      e.amount,
      next.balance,
      next.reserved,
      e.uncollected ?? 0,
      e.reservationId ?? null,
      e.reviewId ?? null,
      e.stripeEventId ?? null,
      e.stripeSessionId ?? null,
      e.stripePaymentIntent ?? null,
      e.note ?? null,
      Date.now(),
    ],
  );
  return next;
}

export async function creditSummary(userId: string, query: Query = q): Promise<CreditSummary> {
  const [row] = await query<AccountRow>("SELECT balance, reserved, owed, on_hold_at FROM app.credit_accounts WHERE user_id = $1", [userId]);
  const a = toAccount(row);
  return {
    balance: a.balance,
    reserved: a.reserved,
    available: a.balance - a.reserved,
    onHold: a.onHold,
    reviewReserve: reviewReserve(),
    followupReserve: followupReserve(),
  };
}

/** Whether the account can start a review on credits now, and if not, what to tell it. */
export function creditsProblem(s: CreditSummary): string | null {
  if (s.onHold) return ON_HOLD;
  if (s.available < s.reviewReserve) return needsCreditsMessage(s);
  return null;
}

export type Purpose = "review" | "followup";

/**
 * Sets credit aside for a review run or a follow-up answer, inside the caller's
 * transaction (so it's decided under the same locks as the spending caps). Throws
 * NotEnoughCredits if the account is on hold or hasn't enough free. Returns the
 * reservation's id.
 */
export async function reserveCredits(t: Query, userId: string, reviewId: string, purpose: Purpose): Promise<number> {
  const amount = purpose === "review" ? reviewReserve() : followupReserve();
  const acct = await lockAccount(t, userId);
  if (acct.onHold) throw new NotEnoughCredits(ON_HOLD);
  const available = acct.balance - acct.reserved;
  if (available < amount) {
    const s = { available, reviewReserve: reviewReserve(), followupReserve: followupReserve() };
    throw new NotEnoughCredits(purpose === "review" ? needsCreditsMessage(s) : followupNeedsCreditsMessage(s));
  }
  const [row] = await t<{ id: string }>(
    "INSERT INTO app.credit_reservations (user_id, review_id, purpose, amount, created_at) VALUES ($1, $2, $3, $4, $5) RETURNING id",
    [userId, reviewId, purpose, amount, Date.now()],
  );
  const id = Number(row.id);
  await post(t, userId, acct, { reserved: amount }, { kind: "reserve", amount, reservationId: id, reviewId });
  return id;
}

export const ANSWER_CHECK_SHORT = "Your credit balance is too low to check this answer. Top up to continue.";

/**
 * Calls that belong to no review (answer checks) paid with credits: they're small, so
 * instead of a reservation the account must have their worst case free before the call
 * (this), and is charged what the call cost x MARGIN after it (chargeCall).
 */
export async function assertCreditsFor(userId: string, worstCaseMicros: number, query: Query = q): Promise<void> {
  const s = await creditSummary(userId, query);
  if (s.onHold) throw new NotEnoughCredits(ON_HOLD);
  if (s.available < withMargin(worstCaseMicros)) throw new NotEnoughCredits(ANSWER_CHECK_SHORT);
}

/** Charges a call that belongs to no review: its cost x MARGIN, never more than the account has free. Returns what was charged. */
export async function chargeCall(userId: string, costMicros: number, note: string): Promise<number> {
  return tx(async (t) => {
    const acct = await lockAccount(t, userId);
    const owed = withMargin(costMicros);
    const charge = Math.min(owed, Math.max(0, acct.balance - acct.reserved));
    if (owed > charge) console.error(`[credits] ${note} for ${userId} cost ${formatMicros(owed)} with margin, more than the ${formatMicros(charge)} free`);
    if (charge > 0) await post(t, userId, acct, { balance: -charge }, { kind: "charge", amount: -charge, note, uncollected: owed - charge });
    return charge;
  });
}

/** reserveCredits in a transaction of its own. */
export async function reserve(userId: string, reviewId: string, purpose: Purpose): Promise<number> {
  return tx((t) => reserveCredits(t, userId, reviewId, purpose));
}

type ReservationRow = { id: string; user_id: string; review_id: string; purpose: Purpose; amount: string; cost: string; in_flight: string; status: string };

/**
 * Ends a reservation: charges what its calls cost x MARGIN (rounded up) and releases
 * the rest. Used when a review finishes or fails, and when a follow-up answer ends.
 * Settling twice does nothing the second time. Returns what was charged.
 */
export async function settleReservation(id: number): Promise<number> {
  return tx(async (t) => {
    const [peek] = await t<{ user_id: string }>("SELECT user_id FROM app.credit_reservations WHERE id = $1", [id]);
    if (!peek) return 0;
    // Always the account first, then the reservation, so this can't deadlock with a reserve.
    let acct = await lockAccount(t, peek.user_id);
    const [r] = await t<ReservationRow>("SELECT * FROM app.credit_reservations WHERE id = $1 FOR UPDATE", [id]);
    if (r.status !== "open") return 0;
    const amount = Number(r.amount);
    const owed = withMargin(Number(r.cost));
    // Never more than was set aside. holdForCall makes sure it never comes to this; if it
    // somehow did, the difference is logged rather than taken from credit that isn't there.
    const charge = Math.min(owed, amount);
    if (owed > amount) console.error(`[credits] reservation ${id} cost ${formatMicros(owed)} with margin, more than the ${formatMicros(amount)} set aside`);
    await t("UPDATE app.credit_reservations SET status = 'settled', charged = $2, in_flight = 0, settled_at = $3 WHERE id = $1", [id, charge, Date.now()]);
    const base = { reservationId: id, reviewId: r.review_id };
    if (charge > 0) acct = await post(t, r.user_id, acct, { balance: -charge, reserved: -charge }, { ...base, kind: "charge", amount: -charge, note: r.purpose });
    if (amount - charge > 0) await post(t, r.user_id, acct, { reserved: -(amount - charge) }, { ...base, kind: "release", amount: amount - charge, note: r.purpose });
    return charge;
  });
}

/** Settles every open reservation of this review (of one purpose, or all). */
export async function settleOpenReservations(reviewId: string, purpose?: Purpose): Promise<void> {
  const rows = await q<{ id: string }>(
    `SELECT id FROM app.credit_reservations WHERE review_id = $1 AND status = 'open'${purpose ? " AND purpose = $2" : ""}`,
    purpose ? [reviewId, purpose] : [reviewId],
  );
  for (const r of rows) await settleReservation(Number(r.id));
}

/**
 * The worker is about to run a review on credits: the reservation it runs on. That's
 * the one made when the review was created (or retried); one left open by a worker that
 * stopped mid-run is reused, with its record of calls in progress cleared (none are
 * running now). With none open, credit is set aside now, or NotEnoughCredits.
 */
export async function reservationForRun(userId: string, reviewId: string): Promise<number> {
  const { id, extra } = await tx(async (t) => {
    await lockAccount(t, userId);
    const open = await t<{ id: string }>(
      "SELECT id FROM app.credit_reservations WHERE review_id = $1 AND purpose = 'review' AND status = 'open' ORDER BY id DESC FOR UPDATE",
      [reviewId],
    );
    if (!open.length) return { id: await reserveCredits(t, userId, reviewId, "review"), extra: [] };
    await t("UPDATE app.credit_reservations SET in_flight = 0 WHERE id = $1", [open[0].id]);
    return { id: Number(open[0].id), extra: open.slice(1).map((r) => Number(r.id)) };
  });
  // Two retries at once can each set credit aside; only one run happens, so the other is given back.
  for (const other of extra) await settleReservation(other);
  return id;
}

/** Follow-up answers whose request died before settling (a crash, a restart) are settled after this long. */
export async function settleStaleFollowups(olderThanMs = ANSWER_STALE_MS): Promise<number> {
  const rows = await q<{ id: string }>("SELECT id FROM app.credit_reservations WHERE purpose = 'followup' AND status = 'open' AND created_at < $1", [Date.now() - olderThanMs]);
  for (const r of rows) await settleReservation(Number(r.id));
  return rows.length;
}

/* ---------- Paying for each call ---------- */

const scope = new AsyncLocalStorage<{ reservationId: number }>();

/** Runs fn with every paid call inside it paid from this reservation. */
export function onReservation<T>(reservationId: number, fn: () => T): T {
  return scope.run({ reservationId }, fn);
}

export function currentReservation(): number | null {
  return scope.getStore()?.reservationId ?? null;
}

/** The reservation can't fit this call, even with nothing else running. */
export class ReservationUsed extends Error {
  constructor() {
    super(RESERVATION_USED);
  }
}

export type CallPrice = {
  /** Upper bound on the call's input cost, in micro-dollars (every input token priced as a cache write). */
  inputMicros: number;
  /** Price of one output token, in micro-dollars. */
  outputMicrosPerToken: number;
  /** The output the call asks for, and the least it can usefully run with. */
  maxTokens: number;
  minTokens: number;
};

export type Hold = { reservationId: number; ceiling: number; maxTokens: number };

const WAIT_MS = 500;
const MAX_WAIT_MS = 20 * 60 * 1000;

/**
 * Before a paid call on credits: claims the call's worst case from the reservation, so
 * the reservation can never be overspent, even with calls running in parallel. When the
 * full output asked for doesn't fit, the call gets as much output as does fit (at least
 * minTokens); when not even that fits, it waits for running calls to finish, and with
 * none running it stops with ReservationUsed.
 */
export async function holdForCall(reservationId: number, reviewId: string, price: CallPrice, opts: { waitMs?: number; maxWaitMs?: number } = {}): Promise<Hold> {
  const started = Date.now();
  for (;;) {
    const got = await tx(async (t) => {
      const [r] = await t<ReservationRow>("SELECT * FROM app.credit_reservations WHERE id = $1 FOR UPDATE", [reservationId]);
      if (!r || r.review_id !== reviewId || r.status !== "open") throw new NotEnoughCredits(RESERVATION_USED);
      const amount = Number(r.amount);
      const committed = Number(r.cost) + Number(r.in_flight);
      // The most the call may cost so that (everything so far + this call) x MARGIN still fits.
      const room = Math.floor((amount * MARGIN_DEN) / MARGIN_NUM) - committed;
      const tokens = Math.min(price.maxTokens, Math.floor((room - price.inputMicros) / price.outputMicrosPerToken));
      if (tokens < Math.min(price.minTokens, price.maxTokens)) return { wait: Number(r.in_flight) > 0 };
      const ceiling = Math.ceil(price.inputMicros + tokens * price.outputMicrosPerToken);
      await t("UPDATE app.credit_reservations SET in_flight = in_flight + $2 WHERE id = $1", [reservationId, ceiling]);
      return { hold: { reservationId, ceiling, maxTokens: tokens } };
    });
    if ("hold" in got && got.hold) return got.hold;
    if (!got.wait || Date.now() - started > (opts.maxWaitMs ?? MAX_WAIT_MS)) throw new ReservationUsed();
    await new Promise((r) => setTimeout(r, opts.waitMs ?? WAIT_MS));
  }
}

/** After the call: its worst case is no longer held, and what it actually cost is added. */
export async function releaseHold(hold: Hold, actualMicros: number): Promise<void> {
  if (actualMicros > hold.ceiling) console.error(`[credits] a call cost ${actualMicros} micro-dollars, more than its bound of ${hold.ceiling}`);
  await q("UPDATE app.credit_reservations SET in_flight = GREATEST(in_flight - $2, 0), cost = cost + $3 WHERE id = $1", [hold.reservationId, hold.ceiling, actualMicros]);
}

/* ---------- Money in and out through Stripe ---------- */

/**
 * Credits a paid Checkout Session to its account: the amount actually paid, once per
 * session however many of its events arrive. Returns what happened, for the event log.
 */
export async function creditTopup(
  t: Query,
  p: { userId: string; sessionId: string; paymentIntent: string | null; amountCents: number; eventId: string; pack: string | null },
): Promise<string> {
  const acct = await lockAccount(t, p.userId);
  const [done] = await t("SELECT 1 FROM app.credit_ledger WHERE kind = 'topup' AND stripe_session_id = $1", [p.sessionId]);
  if (done) return "already credited";
  const amount = p.amountCents * MICROS_PER_CENT;
  await post(t, p.userId, acct, { balance: amount }, {
    kind: "topup",
    amount,
    stripeEventId: p.eventId,
    stripeSessionId: p.sessionId,
    stripePaymentIntent: p.paymentIntent,
    note: p.pack ? `pack ${p.pack}` : null,
  });
  return `credited ${formatMicros(amount)}`;
}

/**
 * A top-up's payment was refunded or disputed: takes that much back from the account,
 * up to what the top-up added, counting what earlier events already took back (Stripe
 * reports refunds as a running total). Credit set aside for running reviews isn't
 * touched. Whatever can't be taken back is recorded as owed and the account is put on
 * hold, so it can't run new paid reviews or buy more credits until the owner clears it.
 */
export async function clawBack(t: Query, p: { paymentIntent: string; totalCents: number; reason: "refund" | "dispute"; eventId: string }): Promise<string> {
  const [topup] = await t<{ user_id: string; amount: string }>(
    "SELECT user_id, amount FROM app.credit_ledger WHERE kind = 'topup' AND stripe_payment_intent = $1 LIMIT 1",
    [p.paymentIntent],
  );
  if (!topup) return "no top-up for this payment";
  let acct = await lockAccount(t, topup.user_id);
  const [prev] = await t<{ taken: string }>(
    "SELECT COALESCE(SUM(uncollected - amount), 0)::bigint AS taken FROM app.credit_ledger WHERE kind = 'adjustment' AND stripe_payment_intent = $1",
    [p.paymentIntent],
  );
  const target = Math.min(p.totalCents * MICROS_PER_CENT, Number(topup.amount));
  const debit = target - Number(prev.taken);
  if (debit <= 0) return "already taken back";
  const take = Math.min(debit, acct.balance - acct.reserved);
  const short = debit - take;
  acct = await post(t, topup.user_id, acct, { balance: -take }, {
    kind: "adjustment",
    amount: -take,
    uncollected: short,
    stripeEventId: p.eventId,
    stripePaymentIntent: p.paymentIntent,
    note: p.reason,
  });
  if (short > 0) {
    const reason = `${p.reason} on ${p.paymentIntent}: ${formatMicros(short)} of it had already been spent or set aside`;
    await t("UPDATE app.credit_accounts SET owed = owed + $2, on_hold_at = COALESCE(on_hold_at, $3), on_hold_reason = $4, updated_at = $3 WHERE user_id = $1", [
      topup.user_id,
      short,
      Date.now(),
      reason,
    ]);
    console.error(`[credits] account ${topup.user_id} put on hold: ${reason}`);
    return `took back ${formatMicros(take)}, ${formatMicros(short)} short: account on hold`;
  }
  return `took back ${formatMicros(take)}`;
}

/** Top-ups are refused while the account is on hold: credit it couldn't use isn't sold to it. */
export async function assertCanTopUp(userId: string): Promise<void> {
  const s = await creditSummary(userId);
  if (s.onHold) throw new NotEnoughCredits(ON_HOLD);
}

/**
 * The account's own credit history, newest first: top-ups, what each review or follow-up
 * was charged, credit given back, and adjustments (a refund or dispute taking credit
 * back). Setting credit aside isn't listed; it shows as an open reservation instead.
 * Always scoped to the one account.
 */
export async function creditHistory(userId: string, limit = 50): Promise<HistoryEntry[]> {
  const rows = await q<{ id: string; kind: HistoryEntry["kind"]; amount: string; at: string; review_id: string | null; note: string | null; title: string | null }>(
    `SELECT l.id, l.kind::text AS kind, l.amount, l.at, l.review_id, l.note, r.title
       FROM app.credit_ledger l LEFT JOIN app.reviews r ON r.id = l.review_id AND r.user_id = l.user_id
      WHERE l.user_id = $1 AND l.kind <> 'reserve'
      ORDER BY l.id DESC LIMIT $2`,
    [userId, limit],
  );
  return rows.map((r) => ({
    id: Number(r.id),
    kind: r.kind,
    amount: Number(r.amount),
    at: Number(r.at),
    reviewId: r.review_id,
    reviewTitle: r.title,
    detail: describeEntry(r.kind, r.note),
  }));
}

/** Credit set aside right now for reviews and follow-up answers still running. */
export async function openReservations(userId: string): Promise<OpenReservation[]> {
  const rows = await q<{ id: string; review_id: string; purpose: Purpose; amount: string; created_at: string; title: string | null }>(
    `SELECT c.id, c.review_id, c.purpose, c.amount, c.created_at, r.title
       FROM app.credit_reservations c LEFT JOIN app.reviews r ON r.id = c.review_id AND r.user_id = c.user_id
      WHERE c.user_id = $1 AND c.status = 'open' ORDER BY c.id DESC`,
    [userId],
  );
  return rows.map((r) => ({ id: Number(r.id), reviewId: r.review_id, reviewTitle: r.title, purpose: r.purpose, amount: Number(r.amount), at: Number(r.created_at) }));
}

/** Whether this Checkout Session has been credited to this account yet. */
export async function topupCredited(userId: string, sessionId: string): Promise<boolean> {
  const rows = await q("SELECT 1 FROM app.credit_ledger WHERE kind = 'topup' AND user_id = $1 AND stripe_session_id = $2", [userId, sessionId]);
  return rows.length > 0;
}
