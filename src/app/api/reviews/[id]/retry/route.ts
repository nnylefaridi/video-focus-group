import { setPaidWith, updateReview } from "@/server/reviews";
import { enqueue } from "@/server/jobs";
import { accessibleReview, mustSignIn, signInResponse } from "@/server/auth";
import { getPaymentContext, paymentResponse } from "@/server/billing";
import { isHosted } from "@/server/config";
import { UPLOAD_REJECTED } from "@/server/intake";
import { creditsResponse, NotEnoughCredits, reserve, settleOpenReservations } from "@/server/credits";

/** Resume a failed review. Completed stages (ledger, finished reviewers) are kept. */
export async function POST(_req: Request, ctx: RouteContext<"/api/reviews/[id]/retry">) {
  const { id } = await ctx.params;
  const found = await accessibleReview(id);
  if (!found) return Response.json({ error: "Not found" }, { status: 404 });
  if (mustSignIn(found.viewer)) return signInResponse("Log in to run this review again.");
  if (found.review.stage !== "failed") return Response.json({ error: "This review isn't in a failed state." }, { status: 409 });
  if (found.review.stageDetail === UPLOAD_REJECTED) {
    const reason = (found.review.error ?? "It didn't pass the checks.").replace(/\.$/, "");
    return Response.json({ error: `This video couldn't be used: ${reason}. Start a new review with another file.` }, { status: 409 });
  }
  const payment = isHosted() ? await getPaymentContext(found.viewer.userId!) : null;
  if (payment && !payment.ready) return paymentResponse(payment);
  if (payment) {
    // Anything still set aside from the run that failed is settled first; a run on credits then sets aside its own.
    await settleOpenReservations(id, "review");
    if (payment.method === "credits") {
      try {
        await reserve(found.viewer.userId!, id, "review");
      } catch (e) {
        if (e instanceof NotEnoughCredits) return creditsResponse(e);
        throw e;
      }
    }
    await setPaidWith(id, payment.method);
  }
  await updateReview(id, { stage: "queued", error: null, stageDetail: null });
  await enqueue(id, "process");
  return Response.json({ ok: true });
}
