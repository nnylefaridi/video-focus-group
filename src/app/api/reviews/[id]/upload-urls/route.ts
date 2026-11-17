import { z } from "zod";
import { isHosted } from "@/server/config";
import { ownedUploadReview, UPLOADABLE } from "@/server/intake";
import { signedUploadUrls } from "@/server/storage";

const Body = z.object({ files: z.array(z.string().regex(UPLOADABLE)).min(2).max(200) });

/**
 * Where the browser sends each file it prepared for this review. Hosted: one-time signed URLs
 * straight into private storage, so the video never passes through this server. Local: this
 * computer's own upload route. Only the review's owner gets them, only while it's waiting.
 */
export async function POST(req: Request, ctx: RouteContext<"/api/reviews/[id]/upload-urls">) {
  const { id } = await ctx.params;
  const owned = await ownedUploadReview(id);
  if ("response" in owned) return owned.response;
  const body = Body.safeParse(await req.json().catch(() => null));
  if (!body.success) return Response.json({ error: "Something went wrong preparing your video. Please try again." }, { status: 400 });
  const files = [...new Set(body.data.files)];
  if (!isHosted()) return Response.json({ urls: Object.fromEntries(files.map((f) => [f, `/api/reviews/${id}/files/${f}`])) });
  try {
    return Response.json({ urls: await signedUploadUrls(owned.userId!, id, files) });
  } catch (e) {
    console.error("[upload-urls]", e);
    const message = e instanceof Error ? e.message : "";
    // Missing storage settings are the host's to fix; say so plainly instead of a vague failure.
    if (/must be set/.test(message)) return Response.json({ error: message }, { status: 503 });
    return Response.json({ error: "Couldn't get the upload ready. Please try again." }, { status: 502 });
  }
}
