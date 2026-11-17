/**
 * Hosted mode: whether the app's own Anthropic key (ANTHROPIC_API_KEY, the key prepaid
 * credits run on) is working. When Anthropic refuses it (401, or 400 "credit balance too
 * low"), credits are paused for PAUSE_MS: no new top-ups, no new reviews or follow-ups on
 * credits. The next call on that key that works ends the pause early. Kept in memory: the
 * hosted site runs as one process, and a restart simply tries the key again.
 */

/** What a customer on credits is told when a call on the app's key fails that way. */
export const OWNER_KEY_DOWN = "The AI service is unavailable right now. Nothing was charged for the failed step and your unused credit is back. Please try again later.";
/** What anyone trying to buy credits, or spend them, is told while credits are paused. */
export const CREDITS_PAUSED = "Credits are paused for a few minutes because the AI service is unavailable. Your credit is safe. Please try again later.";
export const PAUSE_MS = 10 * 60 * 1000;

type Outage = { since: number; last: number; until: number; reason: string };

declare global {
  var __panelOwnerKeyOutage: Outage | null | undefined;
}

/** Anthropic refused the app's key. Pauses credits and logs an alert for the owner. */
export function ownerKeyFailed(reason: string, now = Date.now()): void {
  const prev = globalThis.__panelOwnerKeyOutage;
  const ongoing = prev != null && prev.until > now;
  globalThis.__panelOwnerKeyOutage = { since: ongoing ? prev.since : now, last: now, until: now + PAUSE_MS, reason };
  console.error(
    `[ALERT] The app's Anthropic key stopped working: ${reason}. Credit top-ups and credit-paid reviews are paused for ${PAUSE_MS / 60_000} minutes. ` +
      "Add funds in the Anthropic Console (Settings > Billing) or fix ANTHROPIC_API_KEY on Render.",
  );
}

/** A call on the app's key worked: credits aren't paused any more. */
export function ownerKeyWorked(): void {
  if (globalThis.__panelOwnerKeyOutage) {
    console.log("[ai] The app's Anthropic key works again; credits are no longer paused.");
    globalThis.__panelOwnerKeyOutage = null;
  }
}

/** Whether credits are paused right now. */
export function creditsPaused(now = Date.now()): boolean {
  const o = globalThis.__panelOwnerKeyOutage;
  return o != null && o.until > now;
}

/** Whether Anthropic refused the app's key at or after this time. */
export function ownerKeyFailedSince(t: number): boolean {
  const o = globalThis.__panelOwnerKeyOutage;
  return o != null && o.last >= t;
}
