import crypto from "node:crypto";
import { MEDIA_SECRET } from "./config";

/** Files inside a review folder that may be served to the browser. */
const SERVABLE = /^(video\.mp4|poster\.jpg|captions\.vtt|frames\/F\d{3,4}\.jpg)$/;

export function isServable(file: string): boolean {
  return SERVABLE.test(file);
}

function sign(reviewId: string, file: string, exp: number): string {
  return crypto.createHmac("sha256", MEDIA_SECRET).update(`${reviewId}/${file}/${exp}`).digest("base64url");
}

/**
 * A short-lived URL for one media file (valid 6–7 hours). The expiry is rounded
 * up to the hour so the URL stays identical across polls and the player never reloads.
 */
export function signedMediaUrl(reviewId: string, file: string, ttlSec = 6 * 3600): string {
  const exp = ttlSec <= 0 ? Math.floor(Date.now() / 1000) + ttlSec : Math.ceil((Date.now() / 1000 + ttlSec) / 3600) * 3600;
  return `/api/media/${reviewId}/${file}?exp=${exp}&sig=${sign(reviewId, file, exp)}`;
}

export function verifyMediaSignature(reviewId: string, file: string, exp: string | null, sig: string | null): boolean {
  if (!exp || !sig) return false;
  const e = Number(exp);
  if (!Number.isFinite(e) || e < Date.now() / 1000) return false;
  const expected = Buffer.from(sign(reviewId, file, e));
  const given = Buffer.from(sig);
  return expected.length === given.length && crypto.timingSafeEqual(expected, given);
}
