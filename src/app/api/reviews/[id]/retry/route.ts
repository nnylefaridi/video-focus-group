import { updateReview } from "@/server/reviews";
import { enqueue } from "@/server/jobs";
import { accessibleReview } from "@/server/auth";

/** Resume a failed review. Completed stages (ledger, finished reviewers) are kept. */
export async function POST(_req: Request, ctx: RouteContext<"/api/reviews/[id]/retry">) {
  const { id } = await ctx.params;
  const found = await accessibleReview(id);
  if (!found) return Response.json({ error: "Not found" }, { status: 404 });
  if (found.review.stage !== "failed") return Response.json({ error: "This review isn't in a failed state." }, { status: 409 });
  await updateReview(id, { stage: "queued", error: null, stageDetail: null });
  await enqueue(id, "process");
  return Response.json({ ok: true });
}
