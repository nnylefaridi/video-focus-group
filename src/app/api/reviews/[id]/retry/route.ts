import { getReview, updateReview } from "@/server/reviews";
import { enqueue } from "@/server/jobs";

/** Resume a failed review. Completed stages (ledger, finished reviewers) are kept. */
export async function POST(_req: Request, ctx: RouteContext<"/api/reviews/[id]/retry">) {
  const { id } = await ctx.params;
  const r = getReview(id);
  if (!r) return Response.json({ error: "Not found" }, { status: 404 });
  if (r.stage !== "failed") return Response.json({ error: "This review isn't in a failed state." }, { status: 409 });
  updateReview(id, { stage: "queued", error: null, stageDetail: null });
  enqueue(id, "process");
  return Response.json({ ok: true });
}
