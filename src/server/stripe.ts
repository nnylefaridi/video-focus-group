import Stripe from "stripe";
import { tx, type Query } from "./db";
import { hostedOrigin } from "./config";
import { assertCanTopUp, clawBack, creditTopup } from "./credits";
import { formatMicros, MICROS_PER_CENT, packById, TOPUP_CANCELLED_PATH, TOPUP_DONE_PATH, type CreditPackId } from "@/core/credits";

/**
 * Hosted mode: buying credits with Stripe Checkout, and Stripe's webhooks telling Panel
 * a payment went through, was refunded or was disputed. Needs STRIPE_SECRET_KEY and
 * STRIPE_WEBHOOK_SECRET (hosted mode won't start without them; see src/server/mode.mjs).
 */
export class StripeNotConfigured extends Error {}

let client: { key: string; stripe: Stripe } | null = null;

export function stripeClient(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY?.trim();
  if (!key) throw new StripeNotConfigured("STRIPE_SECRET_KEY isn't set, so Video Focus Group can't take payments. Set it to the secret key from the Stripe Dashboard and restart Video Focus Group.");
  if (client?.key !== key) client = { key, stripe: new Stripe(key, { maxNetworkRetries: 2, appInfo: { name: "Video Focus Group" } }) };
  return client.stripe;
}

function webhookSecret(): string {
  const secret = process.env.STRIPE_WEBHOOK_SECRET?.trim();
  if (!secret)
    throw new StripeNotConfigured("STRIPE_WEBHOOK_SECRET isn't set, so Video Focus Group can't check that webhooks come from Stripe. Set it to the endpoint's signing secret and restart Video Focus Group.");
  return secret;
}

/** Where Checkout sends people back to: the upload step they came from, or Your reviews. */
export type ReturnTo = "flow" | "account";

/**
 * Starts a Stripe Checkout for one of the fixed packs and returns its URL. The price
 * comes from the pack id, never from the browser. Throws NotEnoughCredits (account on
 * hold), StripeNotConfigured, or Stripe's own error.
 */
export async function createTopupCheckout(userId: string, packId: CreditPackId, returnTo: ReturnTo): Promise<string> {
  const pack = packById(packId);
  if (!pack) throw new Error(`Unknown credit pack ${packId}`);
  await assertCanTopUp(userId);
  const stripe = stripeClient();
  const origin = hostedOrigin();
  const metadata = { user_id: userId, pack: pack.id };
  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: "usd",
          unit_amount: pack.cents,
          product_data: {
            name: `Video Focus Group credits, ${formatMicros(pack.cents * MICROS_PER_CENT)}`,
            description: "Prepaid credit for Video Focus Group reviews. Unused credit isn't refunded in cash.",
          },
        },
      },
    ],
    client_reference_id: userId,
    metadata,
    payment_intent_data: { metadata },
    success_url: returnTo === "flow" ? `${origin}/?topup=done&session_id={CHECKOUT_SESSION_ID}` : `${origin}${TOPUP_DONE_PATH}?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: returnTo === "flow" ? `${origin}/?topup=cancelled` : `${origin}${TOPUP_CANCELLED_PATH}`,
  });
  if (!session.url) throw new Error("Stripe didn't return a checkout page for this payment.");
  return session.url;
}

/** The signature didn't check out, so the request didn't come from Stripe (or was changed). */
export class BadSignature extends Error {}

/** Checks the webhook's signature over the body exactly as received, and returns the event. */
export function verifyWebhook(rawBody: Buffer, signature: string | null): Stripe.Event {
  const secret = webhookSecret();
  const stripe = stripeClient();
  if (!signature) throw new BadSignature("No Stripe-Signature header.");
  try {
    return stripe.webhooks.constructEvent(rawBody, signature, secret);
  } catch (e) {
    throw new BadSignature(e instanceof Error ? e.message : "The signature didn't match.");
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const idOf = (v: string | { id: string } | null | undefined) => (typeof v === "string" ? v : (v?.id ?? null));

async function topupFrom(t: Query, event: Stripe.Event, session: Stripe.Checkout.Session): Promise<string> {
  if (session.payment_status !== "paid") return `not paid yet (${session.payment_status})`;
  if (session.mode !== "payment") return `ignored: ${session.mode} session`;
  const userId = session.client_reference_id;
  if (!userId || !UUID.test(userId) || (session.metadata?.user_id && session.metadata.user_id !== userId)) return "ignored: no Panel account on this session";
  if (session.currency !== "usd") return `ignored: paid in ${session.currency}`;
  const cents = session.amount_total ?? 0;
  if (!Number.isInteger(cents) || cents <= 0) return "ignored: nothing paid";
  return creditTopup(t, { userId, sessionId: session.id, paymentIntent: idOf(session.payment_intent), amountCents: cents, eventId: event.id, pack: session.metadata?.pack ?? null });
}

/**
 * Applies one verified Stripe event, once: the event id is recorded in the same
 * transaction as its effect, so a replay (or a retry after a crash) never applies it
 * twice. Returns what happened.
 */
export async function handleStripeEvent(event: Stripe.Event): Promise<string> {
  return tx(async (t) => {
    const fresh = await t("INSERT INTO app.stripe_events (id, type, outcome, received_at) VALUES ($1, $2, 'handling', $3) ON CONFLICT (id) DO NOTHING RETURNING id", [
      event.id,
      event.type,
      Date.now(),
    ]);
    if (!fresh.length) return "already handled";
    let outcome: string;
    switch (event.type) {
      case "checkout.session.completed":
      case "checkout.session.async_payment_succeeded":
        outcome = await topupFrom(t, event, event.data.object);
        break;
      case "charge.refunded": {
        const charge = event.data.object;
        const pi = idOf(charge.payment_intent);
        outcome = pi ? await clawBack(t, { paymentIntent: pi, totalCents: charge.amount_refunded, reason: "refund", eventId: event.id }) : "ignored: no payment intent";
        break;
      }
      case "charge.dispute.created": {
        const dispute = event.data.object;
        const pi = idOf(dispute.payment_intent);
        outcome = pi ? await clawBack(t, { paymentIntent: pi, totalCents: dispute.amount, reason: "dispute", eventId: event.id }) : "ignored: no payment intent";
        break;
      }
      default:
        outcome = "ignored";
    }
    await t("UPDATE app.stripe_events SET outcome = $2 WHERE id = $1", [event.id, outcome]);
    return outcome;
  });
}
