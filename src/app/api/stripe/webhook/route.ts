import { isHosted } from "@/server/config";
import { BadSignature, handleStripeEvent, StripeNotConfigured, verifyWebhook } from "@/server/stripe";

/**
 * Stripe's webhook (hosted mode). The signature is checked over the body exactly as it
 * arrived; anything that fails is refused before it's read. Each event is applied at
 * most once (see handleStripeEvent), so Stripe's retries and replays are safe. Point
 * the endpoint in the Stripe Dashboard at <HOSTED_PUBLIC_URL>/api/stripe/webhook.
 */
export async function POST(req: Request) {
  if (!isHosted()) return Response.json({ error: "Not found" }, { status: 404 });
  const body = Buffer.from(await req.arrayBuffer());
  let event;
  try {
    event = verifyWebhook(body, req.headers.get("stripe-signature"));
  } catch (e) {
    if (e instanceof BadSignature) return Response.json({ error: "Invalid signature" }, { status: 400 });
    if (e instanceof StripeNotConfigured) {
      console.error("[stripe]", e.message);
      // Stripe keeps retrying for days, so nothing is lost once the setting is fixed.
      return Response.json({ error: "Webhooks aren't set up on this site." }, { status: 503 });
    }
    throw e;
  }
  try {
    const outcome = await handleStripeEvent(event);
    console.log(`[stripe] ${event.type} ${event.id}: ${outcome}`);
    return Response.json({ received: true });
  } catch (e) {
    console.error(`[stripe] handling ${event.type} ${event.id} failed:`, e);
    // Not recorded as handled, so Stripe's retry applies it.
    return Response.json({ error: "Couldn't apply this event. Stripe will retry." }, { status: 500 });
  }
}
