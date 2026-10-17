import fs from "node:fs";
import path from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { SUPABASE_URL } from "@/lib/supabase";
import { run } from "@/media/exec";
import { getReview, reviewDir, updateReview } from "./reviews";

/**
 * Signed-in users' review media lives in a private Supabase Storage bucket at
 * <user id>/<review id>/<file>. Only the server touches it (with the secret key);
 * the browser gets short-lived signed URLs. The local media folder is a working
 * copy used while processing and as a fast path for playback.
 */
const BUCKET = "review-media";
/** Supabase's free plan caps each file at 50 MB. */
const MAX_FILE_BYTES = 50 * 1024 * 1024;
const TYPES: Record<string, string> = { ".mp4": "video/mp4", ".jpg": "image/jpeg", ".vtt": "text/vtt" };

let admin: SupabaseClient | null = null;
function storage() {
  const secret = process.env.SUPABASE_SECRET_KEY;
  if (!SUPABASE_URL || !secret) throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY must be set to store videos.");
  admin ??= createClient(SUPABASE_URL, secret, { auth: { persistSession: false, autoRefreshToken: false } });
  return admin.storage.from(BUCKET);
}

const objectPath = (userId: string, reviewId: string, file: string) => `${userId}/${reviewId}/${file}`;

/** The files a finished review needs: the playable video, poster, captions and every sampled frame. */
function localMediaFiles(dir: string): string[] {
  const files = ["video.mp4", "poster.jpg", "captions.vtt"].filter((f) => fs.existsSync(path.join(dir, f)));
  const frames = path.join(dir, "frames");
  if (fs.existsSync(frames)) files.push(...fs.readdirSync(frames).filter((f) => /^F\d{3,4}\.jpg$/.test(f)).map((f) => `frames/${f}`));
  return files;
}

/** A copy of the video small enough for the storage limit, re-encoded at 720p to fit. */
async function fitVideo(dir: string, durationSec: number): Promise<string> {
  const src = path.join(dir, "video.mp4");
  if (fs.statSync(src).size <= MAX_FILE_BYTES) return src;
  const out = path.join(dir, "video.store.mp4");
  const kbps = Math.max(300, Math.floor(((MAX_FILE_BYTES * 0.9 * 8) / Math.max(1, durationSec)) / 1000) - 128);
  await run("ffmpeg", [
    "-y", "-v", "error", "-i", src,
    "-vf", "scale='if(gte(iw,ih),min(1280,iw),-2)':'if(gte(iw,ih),-2,min(1280,ih))'",
    "-c:v", "libx264", "-preset", "veryfast", "-b:v", `${kbps}k`, "-maxrate", `${kbps}k`, "-bufsize", `${kbps * 2}k`,
    "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart", out,
  ]);
  return out;
}

/** Uploads any of the review's media not yet in storage. Safe to run more than once. */
export async function storeReviewMedia(reviewId: string) {
  const r = await getReview(reviewId);
  if (!r?.userId) return;
  const dir = reviewDir(reviewId);
  const stored = new Set(r.storedFiles);
  const todo = localMediaFiles(dir).filter((f) => !stored.has(f));
  for (const file of todo) {
    const src = file === "video.mp4" ? await fitVideo(dir, r.video?.durationSec ?? 180) : path.join(dir, file);
    const body = fs.readFileSync(src);
    // Network blips happen over a long run of uploads; try each file a few times.
    for (let attempt = 1; ; attempt++) {
      const { error } = await storage()
        .upload(objectPath(r.userId, reviewId, file), body, { contentType: TYPES[path.extname(file)], upsert: true })
        .catch((e: unknown) => ({ error: e instanceof Error ? e : new Error(String(e)) }));
      if (!error) break;
      if (attempt >= 4) throw new Error(`Couldn't store ${file}: ${error.message}`);
      await new Promise((res) => setTimeout(res, 1000 * 2 ** attempt));
    }
    stored.add(file);
  }
  fs.rmSync(path.join(dir, "video.store.mp4"), { force: true });
  if (todo.length) {
    // Re-read so files stored by a parallel job aren't dropped.
    const latest = (await getReview(reviewId))?.storedFiles ?? [];
    await updateReview(reviewId, { storedFiles: [...new Set([...latest, ...stored])] });
  }
}

/** Signed URLs (6 hours) for stored files, keyed by file name. */
export async function storedMediaUrls(userId: string, reviewId: string, files: string[]): Promise<Map<string, string>> {
  if (!files.length) return new Map();
  const { data, error } = await storage().createSignedUrls(files.map((f) => objectPath(userId, reviewId, f)), 6 * 3600);
  if (error || !data) throw new Error(`Couldn't sign media URLs: ${error?.message}`);
  const prefix = objectPath(userId, reviewId, "");
  return new Map(data.filter((d) => d.signedUrl && d.path).map((d) => [d.path!.slice(prefix.length), d.signedUrl as string]));
}

/** Brings a stored file back into the local working folder (e.g. the video, for a close look in chat). */
export async function restoreFile(userId: string, reviewId: string, file: string) {
  const dest = path.join(reviewDir(reviewId), file);
  if (fs.existsSync(dest)) return;
  const { data, error } = await storage().download(objectPath(userId, reviewId, file));
  if (error || !data) throw new Error(`Couldn't fetch ${file} from storage: ${error?.message}`);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, Buffer.from(await data.arrayBuffer()));
}

export async function removeStoredMedia(userId: string, reviewId: string, files: string[]) {
  const { error } = await storage().remove(files.map((f) => objectPath(userId, reviewId, f)));
  if (error) throw new Error(error.message);
}
