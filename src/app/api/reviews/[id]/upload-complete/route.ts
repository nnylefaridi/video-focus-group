import { z } from "zod";
import { LIMITS, MAX_UPLOAD_MB } from "@/server/config";
import { enqueue } from "@/server/jobs";
import { ownedUploadReview } from "@/server/intake";
import { deleteReview, updateReview } from "@/server/reviews";
import { uploadedSize } from "@/server/storage";

const Body = z.object({ name: z.string().max(200).optional() });

/**
 * Hosted mode: the browser says the video is in storage. We confirm it really is there and
 * within the size limit, then queue it. The worker checks what's inside (type, length,
 * shape) before any reviewing starts.
 */
export async function POST(req: Request, ctx: RouteContext<"/api/reviews/[id]/upload-complete">) {
  const { id } = await ctx.params;
  const owned = await ownedUploadReview(id);
  if ("response" in owned) return owned.response;
  const body = Body.safeParse(await req.json().catch(() => ({})));

  let size: number | null;
  try {
    size = await uploadedSize(owned.userId, id);
  } catch (e) {
    console.error("[upload-complete]", e);
    return Response.json({ error: "Couldn't confirm your upload. Please try again." }, { status: 502 });
  }
  // The upload didn't land: the review keeps waiting, so they can try again.
  if (size === null) return Response.json({ error: "Your video didn't arrive. Please try uploading it again." }, { status: 400 });

  // A rejected upload never became a review, so it doesn't count toward today's limit.
  // Deleting the review removes the raw upload from storage too.
  if (size === 0 || size > LIMITS.maxBytes) {
    await deleteReview(id, { refund: true });
    return size === 0
      ? Response.json({ error: "That file is empty." }, { status: 400 })
      : Response.json({ error: `That file is larger than ${MAX_UPLOAD_MB} MB.` }, { status: 413 });
  }

  await updateReview(id, { stage: "queued" });
  await enqueue(id, "process", { name: body.success ? body.data.name : undefined });
  return Response.json({ ok: true });
}
