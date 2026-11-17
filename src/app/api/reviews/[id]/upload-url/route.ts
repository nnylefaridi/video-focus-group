import { LIMITS, MAX_UPLOAD_MB } from "@/server/config";
import { ownedUploadReview } from "@/server/intake";
import { createUploadUrl, uploadedSize } from "@/server/storage";

/**
 * Hosted mode: a one-time address for the owner's browser to send this review's video
 * straight to private storage. Only the review's owner gets one, only while it's waiting
 * for its video, and never once a video is there.
 */
export async function POST(_req: Request, ctx: RouteContext<"/api/reviews/[id]/upload-url">) {
  const { id } = await ctx.params;
  const owned = await ownedUploadReview(id);
  if ("response" in owned) return owned.response;
  try {
    if ((await uploadedSize(owned.userId, id)) !== null) {
      return Response.json({ error: "This review already has a video." }, { status: 409 });
    }
    return Response.json({ url: await createUploadUrl(owned.userId, id), maxBytes: LIMITS.maxBytes, maxMb: MAX_UPLOAD_MB });
  } catch (e) {
    console.error("[upload-url]", e);
    const message = e instanceof Error ? e.message : "";
    // Missing storage settings are the host's to fix; say so plainly instead of a vague failure.
    if (/must be set/.test(message)) return Response.json({ error: message }, { status: 503 });
    return Response.json({ error: "Couldn't get the upload ready. Please try again." }, { status: 502 });
  }
}
