import { connection } from "next/server";
import { getViewer, signInResponse } from "@/server/auth";
import { isHosted } from "@/server/config";
import { getPaymentContext } from "@/server/billing";
import { topupCredited } from "@/server/credits";

/**
 * Hosted mode only: the account's credits and payment state. With ?session_id=, also
 * whether that Checkout has been credited yet (Stripe's webhook can land a few seconds
 * after the browser comes back).
 */
export async function GET(req: Request) {
  await connection();
  if (!isHosted()) return Response.json({ error: "Credits are only for the hosted site." }, { status: 404 });
  const viewer = await getViewer();
  if (!viewer.userId) return signInResponse("Log in to see your credits.");
  const session = new URL(req.url).searchParams.get("session_id");
  const credited = session && /^cs_[A-Za-z0-9_]{1,250}$/.test(session) ? await topupCredited(viewer.userId, session) : null;
  return Response.json({ payment: await getPaymentContext(viewer.userId), credited });
}
