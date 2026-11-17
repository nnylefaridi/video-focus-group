import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { Transform } from "node:stream";
import { isHosted, LIMITS, MAX_UPLOAD_MB } from "@/server/config";
import { deleteReview, reviewDir, updateReview } from "@/server/reviews";
import { accessibleReview, mustSignIn, signInResponse } from "@/server/auth";
import { enqueue } from "@/server/jobs";
import { probe, sniffContainer, UploadRejected } from "@/media/probe";

class TooLarge extends Error {}

export async function PUT(req: Request, ctx: RouteContext<"/api/reviews/[id]/video">) {
  const { id } = await ctx.params;
  const found = await accessibleReview(id);
  if (!found) return Response.json({ error: "Not found" }, { status: 404 });
  if (mustSignIn(found.viewer)) return signInResponse();
  // Hosted videos go straight to storage (upload-url, then upload-complete), never through here.
  if (isHosted()) return Response.json({ error: "Videos are sent straight to storage on this site. Please upload again from the upload step." }, { status: 410 });
  const { review } = found;
  if (review.stage !== "uploading") return Response.json({ error: "This review already has a video." }, { status: 409 });

  const declared = Number(req.headers.get("content-length") ?? 0);
  // A rejected upload never became a review, so it doesn't count toward today's limit.
  const reject = async (message: string, status = 400) => {
    await deleteReview(id, { refund: true });
    return Response.json({ error: message }, { status });
  };
  if (declared > LIMITS.maxBytes) return reject(`That file is larger than ${MAX_UPLOAD_MB} MB.`, 413);
  if (!req.body) return reject("No file was received.");

  const dir = reviewDir(id);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(dir, "upload.tmp");
  let bytes = 0;
  try {
    const counter = new Transform({
      transform(chunk, _enc, cb) {
        bytes += chunk.length;
        if (bytes > LIMITS.maxBytes) cb(new TooLarge());
        else cb(null, chunk);
      },
    });
    await pipeline(Readable.fromWeb(req.body as import("node:stream/web").ReadableStream), counter, fs.createWriteStream(tmp));

    const container = sniffContainer(tmp);
    if (!container) return reject("That file isn't an MP4, MOV or WebM video.");
    const meta = await probe(tmp);
    const original = path.join(dir, `original.${container === "mp4" ? "mp4" : "webm"}`);
    fs.renameSync(tmp, original);

    const name = decodeURIComponent(req.headers.get("x-file-name") ?? "video").slice(0, 200);
    await updateReview(id, {
      stage: "queued",
      video: { originalName: name, bytes, durationSec: meta.durationSec, width: meta.width, height: meta.height, hasAudio: meta.hasAudio },
    });
    await enqueue(id, "process");
    return Response.json({ ok: true });
  } catch (e) {
    if (e instanceof TooLarge) return reject(`That file is larger than ${MAX_UPLOAD_MB} MB.`, 413);
    if (e instanceof UploadRejected) return reject(e.message);
    console.error("[upload]", e);
    return reject("The upload didn't finish. Please try again.", 500);
  }
}
