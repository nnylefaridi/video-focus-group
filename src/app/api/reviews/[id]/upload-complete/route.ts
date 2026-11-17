import { LIMITS } from "@/server/config";
import { enqueue } from "@/server/jobs";
import { kickAfterResponse } from "@/server/kick";
import { ownedUploadReview } from "@/server/intake";
import { deleteReview, updateReview } from "@/server/reviews";
import { MANIFEST_MAX_BYTES, parseManifest } from "@/media/analysis/manifest";

/**
 * The browser has sent every file it prepared and now describes them (the manifest). Its shape,
 * counts and timestamps are checked here, cheaply and before anything else; the files themselves
 * are checked by the runner's first step, before any paid call. A manifest that fails ends the
 * review and gives back today's review, so a bad request costs nothing.
 */
export async function POST(req: Request, ctx: RouteContext<"/api/reviews/[id]/upload-complete">) {
  const { id } = await ctx.params;
  const owned = await ownedUploadReview(id);
  if ("response" in owned) return owned.response;

  const text = await req.text().catch(() => "");
  let raw: unknown = null;
  if (text.length <= MANIFEST_MAX_BYTES) {
    try {
      raw = JSON.parse(text);
    } catch {}
  }
  const parsed = parseManifest(raw, { maxVideoBytes: LIMITS.maxBytes });
  if (!parsed.ok) {
    console.error(`[upload-complete] ${id} manifest refused: ${raw === null ? "unreadable or too big" : parsed.reason}`);
    await deleteReview(id, { refund: true });
    return Response.json({ error: "Something went wrong preparing your video. Please try again." }, { status: 400 });
  }

  await updateReview(id, { stage: "queued", draft: { manifest: parsed.manifest } });
  await enqueue(id, "process");
  kickAfterResponse();
  return Response.json({ ok: true });
}
