import { updateReview } from "@/server/reviews";
import { enqueue } from "@/server/jobs";
import { accessibleReview, mustSignIn, signInResponse } from "@/server/auth";
import { getPaymentContext, paymentResponse } from "@/server/billing";
import { isHosted } from "@/server/config";

/** Resume a failed review. Completed stages (ledger, finished reviewers) are kept. */
export async function POST(_req: Request, ctx: RouteContext<"/api/reviews/[id]/retry">) {
  const { id } = await ctx.params;
  const found = await accessibleReview(id);
  if (!found) return Response.json({ error: "Not found" }, { status: 404 });
  if (mustSignIn(found.viewer)) return signInResponse("Log in to run this review again.");
  if (found.review.stage !== "failed") return Response.json({ error: "This review isn't in a failed state." }, { status: 409 });
  const payment = isHosted() ? await getPaymentContext(found.viewer.userId!) : null;
  if (payment && !payment.ready) return paymentResponse(payment);
  await updateReview(id, { stage: "queued", error: null, stageDetail: null });
  await enqueue(id, "process");
  return Response.json({ ok: true });
}
