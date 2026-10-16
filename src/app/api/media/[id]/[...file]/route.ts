import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { connection } from "next/server";
import { isServable, verifyMediaSignature } from "@/server/media";
import { reviewDir } from "@/server/reviews";

const TYPES: Record<string, string> = { ".mp4": "video/mp4", ".jpg": "image/jpeg", ".vtt": "text/vtt; charset=utf-8" };

/** Signed, short-lived access to a review's media. Supports Range requests so the player can seek. */
export async function GET(req: Request, ctx: RouteContext<"/api/media/[id]/[...file]">) {
  await connection();
  const { id, file: parts } = await ctx.params;
  const file = parts.join("/");
  const url = new URL(req.url);
  if (!isServable(file) || !verifyMediaSignature(id, file, url.searchParams.get("exp"), url.searchParams.get("sig"))) {
    return new Response("Forbidden", { status: 403 });
  }
  let full: string;
  try {
    full = path.join(reviewDir(id), file);
  } catch {
    return new Response("Not found", { status: 404 });
  }
  if (!fs.existsSync(full)) return new Response("Not found", { status: 404 });

  const size = fs.statSync(full).size;
  const type = TYPES[path.extname(full)] ?? "application/octet-stream";
  const headers = { "content-type": type, "accept-ranges": "bytes", "cache-control": "private, max-age=3600" };
  const range = req.headers.get("range")?.match(/bytes=(\d*)-(\d*)/);
  if (range) {
    const start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
    const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
    if (start >= size || start > end) return new Response(null, { status: 416, headers: { "content-range": `bytes */${size}` } });
    const stream = Readable.toWeb(fs.createReadStream(full, { start, end })) as ReadableStream;
    return new Response(stream, {
      status: 206,
      headers: { ...headers, "content-range": `bytes ${start}-${end}/${size}`, "content-length": String(end - start + 1) },
    });
  }
  const stream = Readable.toWeb(fs.createReadStream(full)) as ReadableStream;
  return new Response(stream, { headers: { ...headers, "content-length": String(size) } });
}
