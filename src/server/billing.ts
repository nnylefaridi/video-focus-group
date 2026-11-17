import { one, q } from "./db";
import { getKeyInfo, KEY_REJECTED, type KeyInfo } from "./apikeys";
import { NEEDS_KEY } from "@/core/ownkey";
import { needsCreditsMessage, type CreditSummary } from "@/core/credits";
import { creditsProblem, creditSummary } from "./credits";

/**
 * Hosted mode: how an account pays for its reviews. Local mode never asks; reviews
 * there run on the server's own ANTHROPIC_API_KEY as always.
 */
export const PAYMENT_METHODS = ["credits", "own_key"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export function isPaymentMethod(v: unknown): v is PaymentMethod {
  return typeof v === "string" && (PAYMENT_METHODS as readonly string[]).includes(v);
}

/** The account's remembered choice, or null if it hasn't picked one yet. */
export async function getPaymentMethod(userId: string): Promise<PaymentMethod | null> {
  const row = await one<{ payment_method: string }>("SELECT payment_method::text AS payment_method FROM app.account_billing WHERE user_id = $1", [userId]);
  return row && isPaymentMethod(row.payment_method) ? row.payment_method : null;
}

export async function setPaymentMethod(userId: string, method: PaymentMethod): Promise<void> {
  await q(
    `INSERT INTO app.account_billing (user_id, payment_method, updated_at) VALUES ($1, $2::app.payment_method, $3)
     ON CONFLICT (user_id) DO UPDATE SET payment_method = excluded.payment_method, updated_at = excluded.updated_at`,
    [userId, method, Date.now()],
  );
}

/**
 * What pays for this account's next review, decided here on the server (never by the
 * browser). `ready` is false with a plain `problem` when the chosen way can't pay yet.
 */
export type PaymentContext = { method: PaymentMethod | null; ready: boolean; problem: string | null; key: KeyInfo | null; credits: CreditSummary };

export const CHOOSE_FIRST = "Choose how to pay for reviews first.";
export const NEEDS_CREDITS = needsCreditsMessage({ available: 0, reviewReserve: 0 });
export { NEEDS_KEY };

export async function getPaymentContext(userId: string): Promise<PaymentContext> {
  const [method, key, credits] = await Promise.all([getPaymentMethod(userId), getKeyInfo(userId), creditSummary(userId)]);
  const base = { method, key, credits };
  if (!method) return { ...base, ready: false, problem: CHOOSE_FIRST };
  if (method === "credits") {
    const problem = creditsProblem(credits);
    return { ...base, ready: !problem, problem };
  }
  if (!key) return { ...base, ready: false, problem: NEEDS_KEY };
  if (key.rejected) return { ...base, ready: false, problem: KEY_REJECTED };
  return { ...base, ready: true, problem: null };
}

/** What a route sends back when the account can't pay for a review. The flow shows the payment step for it. */
export function paymentResponse(ctx: PaymentContext) {
  return Response.json({ error: ctx.problem ?? CHOOSE_FIRST, payment: ctx.method ?? "choose" }, { status: 402 });
}
