import fs from "node:fs";
import path from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { SUPABASE_URL } from "@/lib/supabase";
import { LIMITS } from "./config";
import { getReview, reviewDir, updateReview } from "./reviews";

/**
 * Signed-in users' review media lives in a private Supabase Storage bucket at
 * <user id>/<review id>/<file>. The browser sends its prepared files straight there over
 * one-time signed upload URLs and plays them back over short-lived signed URLs, so no video
 * bytes ever pass through this server (which matters on hosts with a small bandwidth allowance).
 * The server itself only reads small things: the MP4's first few MB to check it, and the
 * frames and sprite sheets it shows to the reviewers, kept in a local working folder that's
 * safe to lose (it's fetched again when needed).
 */
const BUCKET = "review-media";
/** The biggest file kept in storage: MAX_UPLOAD_MB (50 hosted by default, Supabase Free's cap per file). */
export const MAX_FILE_BYTES = LIMITS.maxBytes;
const TYPES: Record<string, string> = { ".mp4": "video/mp4", ".jpg": "image/jpeg", ".vtt": "text/vtt" };

let admin: SupabaseClient | null = null;
function storage() {
  const secret = process.env.SUPABASE_SECRET_KEY;
  if (!SUPABASE_URL || !secret) throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY must be set to store videos.");
  admin ??= createClient(SUPABASE_URL, secret, { auth: { persistSession: false, autoRefreshToken: false } });
  return admin.storage.from(BUCKET);
}

const objectPath = (userId: string, reviewId: string, file: string) => `${userId}/${reviewId}/${file}`;

/**
 * One-time URLs for the browser to PUT each prepared file to, each valid only for its own path
 * (Supabase fixes their lifetime at 2 hours). Upsert is on so a retried upload can replace a
 * half-sent file; the paths are fixed by the server, so nothing else can be overwritten.
 */
export async function signedUploadUrls(userId: string, reviewId: string, files: string[]): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const queue = [...files];
  const worker = async () => {
    for (let file = queue.shift(); file; file = queue.shift()) {
      const { data, error } = await storage().createSignedUploadUrl(objectPath(userId, reviewId, file), { upsert: true });
      if (error || !data) throw new Error(`Couldn't prepare the upload: ${error?.message}`);
      out[file] = data.signedUrl;
    }
  };
  await Promise.all(Array.from({ length: Math.min(8, files.length) }, worker));
  return out;
}

/** Every object stored for a review, with its size in bytes, keyed by its path inside the review folder. */
export async function listReviewObjects(userId: string, reviewId: string): Promise<Map<string, number>> {
  const found = new Map<string, number>();
  for (const sub of ["", "frames", "sprites"]) {
    const prefix = objectPath(userId, reviewId, sub).replace(/\/$/, "");
    const { data, error } = await storage().list(prefix, { limit: 1000 });
    if (error) throw new Error(`Couldn't list the stored files: ${error.message}`);
    for (const o of data ?? []) {
      // Folders come back as entries without an id.
      if (!o.id) continue;
      found.set(sub ? `${sub}/${o.name}` : o.name, Number((o.metadata as { size?: number } | null)?.size ?? 0));
    }
  }
  return found;
}

/** The first `bytes` bytes of a stored file (one ranged request; the file itself may be much bigger). */
export async function fetchHead(userId: string, reviewId: string, file: string, bytes: number): Promise<Uint8Array> {
  const { data, error } = await storage().createSignedUrl(objectPath(userId, reviewId, file), 120);
  if (error || !data) throw new Error(`Couldn't read ${file}: ${error?.message}`);
  const res = await fetch(data.signedUrl, { headers: { Range: `bytes=0-${bytes - 1}` } });
  if (!res.ok || !res.body) throw new Error(`Couldn't read ${file} (${res.status}).`);
  // Read at most `bytes`, even if the server ignored the range and sends the whole file.
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let got = 0;
  while (got < bytes) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    got += value.length;
  }
  await reader.cancel().catch(() => {});
  const out = new Uint8Array(Math.min(got, bytes));
  let at = 0;
  for (const c of chunks) {
    const part = c.subarray(0, Math.min(c.length, out.length - at));
    out.set(part, at);
    at += part.length;
    if (at >= out.length) break;
  }
  return out;
}

/** Stores one small file the server made itself (captions, or a still cropped for a follow-up). */
export async function putSmallFile(userId: string, reviewId: string, file: string, body: Buffer) {
  for (let attempt = 1; ; attempt++) {
    const { error } = await storage()
      .upload(objectPath(userId, reviewId, file), body, { contentType: TYPES[path.extname(file)], upsert: true })
      .catch((e: unknown) => ({ error: e instanceof Error ? e : new Error(String(e)) }));
    if (!error) return;
    if (attempt >= 3) throw new Error(`Couldn't store ${file}: ${error.message}`);
    await new Promise((res) => setTimeout(res, 500 * 2 ** attempt));
  }
}

/** The files a finished review keeps: the playable video, poster, captions, every sampled frame and the sprite sheets. */
function localMediaFiles(dir: string): string[] {
  const files = ["video.mp4", "poster.jpg", "captions.vtt"].filter((f) => fs.existsSync(/* turbopackIgnore: true */ path.join(/* turbopackIgnore: true */ dir, f)));
  for (const [sub, re] of [["frames", /^F\d{3,4}\.jpg$/], ["sprites", /^P\d{3}\.jpg$/]] as const) {
    const d = path.join(/* turbopackIgnore: true */ dir, sub);
    if (fs.existsSync(d)) files.push(...fs.readdirSync(d).filter((f) => re.test(f)).map((f) => `${sub}/${f}`));
  }
  return files;
}

/**
 * Copies a local-mode review's media into the owner's account storage (a review made on this
 * computer and kept in a signed-in account). Hosted reviews never need this: their files are
 * in storage from the start. Safe to run more than once.
 */
export async function storeReviewMedia(reviewId: string) {
  const r = await getReview(reviewId);
  if (!r?.userId) return;
  const dir = reviewDir(reviewId);
  const stored = new Set(r.storedFiles);
  const todo = localMediaFiles(dir).filter((f) => !stored.has(f));
  for (const file of todo) {
    const src = path.join(/* turbopackIgnore: true */ dir, file);
    if (fs.statSync(src).size > MAX_FILE_BYTES) {
      // Prepared videos are made to fit; an older, bigger one stays on this computer only.
      console.error(`[storage] ${file} of ${reviewId} is over the storage limit, so it stays local`);
      continue;
    }
    await putSmallFile(r.userId, reviewId, file, fs.readFileSync(src));
    stored.add(file);
  }
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

/** Brings a small stored file (a frame or sprite sheet) back into the local working folder, if it isn't there. */
export async function restoreFile(userId: string, reviewId: string, file: string) {
  const dest = path.join(/* turbopackIgnore: true */ reviewDir(reviewId), file);
  if (fs.existsSync(dest)) return;
  const { data, error } = await storage().download(objectPath(userId, reviewId, file));
  if (error || !data) throw new Error(`Couldn't fetch ${file} from storage: ${error?.message}`);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, Buffer.from(await data.arrayBuffer()));
}

export async function removeStoredMedia(userId: string, reviewId: string, files: string[]) {
  if (!files.length) return;
  const { error } = await storage().remove(files.map((f) => objectPath(userId, reviewId, f)));
  if (error) throw new Error(error.message);
}

/** Removes everything stored for a review, including files sent but never checked. */
export async function removeAllStoredMedia(userId: string, reviewId: string) {
  const found = await listReviewObjects(userId, reviewId);
  await removeStoredMedia(userId, reviewId, [...found.keys()]);
}
