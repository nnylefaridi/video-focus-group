import fs from "node:fs";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { isHosted } from "@/server/config";
import { maxBytesFor, ownedUploadReview, UPLOADABLE } from "@/server/intake";
import { reviewDir } from "@/server/reviews";

class TooLarge extends Error {}

/**
 * Local mode: receives one prepared file (the 720p video, the poster, a frame or a sprite sheet)
 * into this review's folder, streaming with a byte limit per file. Hosted mode never uses this;
 * files go straight to storage there. What arrives is checked before anything else uses it.
 */
export async function PUT(req: Request, ctx: RouteContext<"/api/reviews/[id]/files/[...file]">) {
  const { id, file: parts } = await ctx.params;
  const file = (parts ?? []).join("/");
  if (!UPLOADABLE.test(file)) return Response.json({ error: "Not found" }, { status: 404 });
  const owned = await ownedUploadReview(id);
  if ("response" in owned) return owned.response;
  if (isHosted()) return Response.json({ error: "Videos are sent straight to storage on this site. Please upload again from the upload step." }, { status: 410 });
  const max = maxBytesFor(file);
  if (Number(req.headers.get("content-length") ?? 0) > max) return Response.json({ error: "That file is too big." }, { status: 413 });
  if (!req.body) return Response.json({ error: "No file was received." }, { status: 400 });

  const dest = path.join(/* turbopackIgnore: true */ reviewDir(id), file);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const tmp = `${dest}.part`;
  let bytes = 0;
  try {
    const counter = new Transform({
      transform(chunk, _enc, cb) {
        bytes += chunk.length;
        if (bytes > max) cb(new TooLarge());
        else cb(null, chunk);
      },
    });
    await pipeline(Readable.fromWeb(req.body as import("node:stream/web").ReadableStream), counter, fs.createWriteStream(tmp));
    fs.renameSync(tmp, dest);
    return Response.json({ ok: true, bytes });
  } catch (e) {
    fs.rmSync(tmp, { force: true });
    if (e instanceof TooLarge) return Response.json({ error: "That file is too big." }, { status: 413 });
    console.error("[files]", e);
    return Response.json({ error: "The upload didn't finish. Please try again." }, { status: 500 });
  }
}
