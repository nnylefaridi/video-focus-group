import { getPaymentContext, type PaymentContext } from "./billing";
import { creditHistory, openReservations } from "./credits";
import { isHosted } from "./config";
import { authReady, type Viewer } from "./auth";
import type { HistoryEntry, OpenReservation } from "@/core/credits";

/** Where each account page sends someone who shouldn't see it. */
export const SIGN_IN_FOR_ACCOUNT = "/login?next=/account";
export const LOCAL_HOME = "/reviews";

export type AccountView = { payment: PaymentContext; history: HistoryEntry[]; reservations: OpenReservation[] };

/**
 * Decides what an account page does for this viewer. Local mode has no accounts, so it
 * goes to the reviews list; signed out goes to sign-in. Only a signed-in account gets
 * anything, and only its own: every query below is keyed by the viewer's user id, which
 * comes from the verified session and never from the URL.
 */
export function accountGate(viewer: Pick<Viewer, "userId">): { redirect: string } | { userId: string } {
  if (!isHosted()) return { redirect: LOCAL_HOME };
  if (!authReady || !viewer.userId) return { redirect: SIGN_IN_FOR_ACCOUNT };
  return { userId: viewer.userId };
}

export async function accountFor(viewer: Pick<Viewer, "userId">): Promise<{ redirect: string } | { view: AccountView }> {
  const gate = accountGate(viewer);
  if ("redirect" in gate) return gate;
  const userId = gate.userId;
  const [payment, history, reservations] = await Promise.all([getPaymentContext(userId), creditHistory(userId), openReservations(userId)]);
  return { view: { payment, history, reservations } };
}
