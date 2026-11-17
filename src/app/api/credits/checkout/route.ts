import { z } from "zod";
import { getViewer, signInResponse } from "@/server/auth";
import { isHosted } from "@/server/config";
import { creditsResponse, NotEnoughCredits } from "@/server/credits";
import { createTopupCheckout, StripeNotConfigured } from "@/server/stripe";
import { CREDIT_PACKS } from "@/core/credits";

const Body = z.object({
  pack: z.enum(CREDIT_PACKS.map((p) => p.id) as [string, ...string[]]),
  from: z.enum(["flow", "account"]).default("account"),
});

/**
 * Hosted mode only: starts a Stripe Checkout for one of the fixed credit packs and
 * returns its address. The browser names a pack; the price is the server's.
 */
export async function POST(req: Request) {
  if (!isHosted()) return Response.json({ error: "Credits are only for the hosted site. This copy of Video Focus Group uses its own API key." }, { status: 404 });
  const viewer = await getViewer();
  if (!viewer.userId) return signInResponse("Log in to add credits.");
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Pick $10, $25 or $50 of credit." }, { status: 400 });
  try {
    const url = await createTopupCheckout(viewer.userId, parsed.data.pack as (typeof CREDIT_PACKS)[number]["id"], parsed.data.from);
    return Response.json({ url });
  } catch (e) {
    if (e instanceof NotEnoughCredits) return creditsResponse(e);
    if (e instanceof StripeNotConfigured) {
      console.error("[credits]", e.message);
      return Response.json({ error: "Payments aren't set up on this site yet, so credits can't be added right now." }, { status: 503 });
    }
    console.error("[credits] starting a checkout failed:", e instanceof Error ? e.message : e);
    return Response.json({ error: "Couldn't reach Stripe to start the payment. Please try again." }, { status: 502 });
  }
}
