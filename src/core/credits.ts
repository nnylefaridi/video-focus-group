/**
 * Hosted mode: prepaid credits. What the browser may know about them (the packs, how
 * amounts are shown, and what's said when credit runs short), so this holds no server
 * code. Amounts are whole micro-dollars: 1 = $0.000001, $10 = 10_000_000.
 */
export const MICROS_PER_USD = 1_000_000;
export const MICROS_PER_CENT = 10_000;

/**
 * The only top-ups there are. The server reads the price from here by pack id; it
 * never takes an amount from the browser. $10 is the smallest (see docs/billing.md for
 * how that covers Stripe's fee with room to spare).
 */
export const CREDIT_PACKS = [
  { id: "usd10", cents: 1000 },
  { id: "usd25", cents: 2500 },
  { id: "usd50", cents: 5000 },
] as const;
export type CreditPackId = (typeof CREDIT_PACKS)[number]["id"];

export function packById(id: unknown) {
  return CREDIT_PACKS.find((p) => p.id === id) ?? null;
}

/** $3.60, $0.05, $12.34: rounded down to the cent, so a balance is never shown as more than it is. */
export function formatMicros(micros: number): string {
  const cents = Math.floor(Math.max(0, micros) / MICROS_PER_CENT);
  return `$${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;
}

/** What the account holds, what's set aside for things running now, and what a review or follow-up sets aside. */
export type CreditSummary = {
  balance: number;
  reserved: number;
  available: number;
  onHold: boolean;
  reviewReserve: number;
  followupReserve: number;
};

export const NO_CASH_REFUND = "Credits pay for reviews and follow-up questions on Video Focus Group. Unused credit isn't refunded in cash.";
export const ON_HOLD =
  "Your credits are on hold because a payment was refunded or disputed after its credit had been spent. Paid reviews and top-ups are paused on this account.";

export function needsCreditsMessage(s: Pick<CreditSummary, "available" | "reviewReserve">): string {
  return s.available <= 0
    ? "Add credits first. Your balance is empty."
    : `Add credits first. A review sets aside up to ${formatMicros(s.reviewReserve)} while it runs, and you have ${formatMicros(s.available)} free.`;
}

export function followupNeedsCreditsMessage(s: Pick<CreditSummary, "available" | "followupReserve">): string {
  return `Add credits to ask a follow-up. Each answer sets aside up to ${formatMicros(s.followupReserve)} while it's written, and you have ${formatMicros(s.available)} free.`;
}

/** The review or answer used up what was set aside for it, so it stopped instead of spending more. */
export const RESERVATION_USED =
  "This used up the credit set aside for it, so it stopped before spending more. You're only charged for what it used.";

/** The credits section on the account page. */
export const CREDITS_ANCHOR = "credits";
export const CREDITS_HREF = `/account#${CREDITS_ANCHOR}`;

/** One line of an account's credit history, as the account page shows it. */
export type HistoryEntry = {
  id: number;
  kind: "topup" | "charge" | "release" | "adjustment";
  /** Signed micro-dollars: + for credit added or given back, - for credit used or taken back. */
  amount: number;
  at: number;
  reviewId: string | null;
  reviewTitle: string | null;
  detail: string;
};

/** Credit set aside for something still running. */
export type OpenReservation = { id: number; reviewId: string; reviewTitle: string | null; purpose: "review" | "followup"; amount: number; at: number };

/** Plain words for a ledger line. The ledger's own note only says why (a pack, a refund, a review or a follow-up). */
export function describeEntry(kind: string, note: string | null): string {
  const followup = note === "followup";
  switch (kind) {
    case "topup":
      return "Credits added";
    case "charge":
      return followup ? "Follow-up answers" : "Review";
    case "release":
      return followup ? "Unused credit from a follow-up, given back" : "Unused credit from a review, given back";
    case "adjustment":
      return note === "dispute" ? "Credit taken back after a payment dispute" : "Credit taken back after a refund";
    default:
      return "Adjustment";
  }
}

/** Where Stripe sends people after Checkout. */
export const TOPUP_DONE_PATH = "/account/topup/done";
export const TOPUP_CANCELLED_PATH = "/account/topup/cancelled";

/** Whether this error is fixed by adding credits. */
export function isCreditsProblem(message: string | null | undefined): boolean {
  return Boolean(message && (message.startsWith("Add credits") || message === ON_HOLD));
}
