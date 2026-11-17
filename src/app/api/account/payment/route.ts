import { z } from "zod";
import { connection } from "next/server";
import { getViewer, signInResponse } from "@/server/auth";
import { getPaymentContext, PAYMENT_METHODS, setPaymentMethod } from "@/server/billing";
import { isHosted } from "@/server/config";

const Body = z.object({ method: z.enum(PAYMENT_METHODS) });

/** Hosted mode only: local mode always uses the server's own key, so there's nothing to choose. */
const localOnly = () => Response.json({ error: "Choosing how to pay is only for the hosted site. This copy of Panel uses its own API key." }, { status: 404 });

/** How this account pays for reviews, and whether that way can pay right now. */
export async function GET() {
  await connection();
  if (!isHosted()) return localOnly();
  const viewer = await getViewer();
  if (!viewer.userId) return signInResponse("Log in to choose how to pay.");
  return Response.json(await getPaymentContext(viewer.userId));
}

/** Remembers the account's choice. The server still checks it can pay before any review runs. */
export async function POST(req: Request) {
  if (!isHosted()) return localOnly();
  const viewer = await getViewer();
  if (!viewer.userId) return signInResponse("Log in to choose how to pay.");
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Pick prepaid credits or your own Anthropic API key." }, { status: 400 });
  await setPaymentMethod(viewer.userId, parsed.data.method);
  return Response.json(await getPaymentContext(viewer.userId));
}
