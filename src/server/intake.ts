import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { inspectMp4, mp4Problems, MP4_HEAD_BYTES } from "@/media/mp4";
import { FRAME_MAX_BYTES, MAX_DURATION_SEC, MIN_DURATION_SEC, POSTER_MAX_BYTES, SPRITE_MAX_BYTES, type Manifest } from "@/media/analysis/manifest";
import { buildTranscript, captionsVtt } from "@/media/analysis/speech";
import { isHosted, LIMITS } from "./config";
import { settleOpenReservations } from "./credits";
import { q } from "./db";
import { getReview, reviewDir, updateReview, type ReviewRecord } from "./reviews";
import { fetchHead, listReviewObjects, putSmallFile, removeAllStoredMedia, restoreFile } from "./storage";
import { accessibleReview, mustSignIn, signInResponse } from "./auth";

/**
 * Prepared uploads. The browser makes the 720p video, poster, frames and sprite sheets on the
 * person's own device and sends them straight to storage (hosted) or to this computer (local),
 * then posts a manifest describing them (upload-complete, which checks its shape and numbers).
 * Before anything paid runs, `verifyUpload` checks the files themselves: they're all there at
 * the sizes declared and nothing else, the MP4 is what it claims from its own header bytes,
 * and every image really is a JPEG of the right size. The browser is never trusted.
 */

/** The review, if the caller may send its prepared files: its owner (hosted) or this computer's user (local), while it's waiting for them. */
export async function ownedUploadReview(id: string): Promise<{ response: Response } | { review: ReviewRecord; userId: string | null }> {
  const found = await accessibleReview(id);
  if (!found) return { response: Response.json({ error: "Not found" }, { status: 404 }) };
  if (mustSignIn(found.viewer)) return { response: signInResponse() };
  const { review, viewer } = found;
  if (isHosted() && (!review.userId || review.userId !== viewer.userId)) return { response: Response.json({ error: "Not found" }, { status: 404 }) };
  if (review.stage !== "uploading") return { response: Response.json({ error: "This review already has a video." }, { status: 409 }) };
  return { review, userId: isHosted() ? review.userId : null };
}

/** Every file a manifest says was sent, with its declared size. */
export function expectedFiles(m: Manifest): Map<string, number> {
  const files = new Map<string, number>([
    ["video.mp4", m.video.bytes],
    ["poster.jpg", m.poster.bytes],
  ]);
  for (const f of m.frames) files.set(f.file, f.bytes);
  for (const s of m.sprites) files.set(s.file, s.bytes);
  return files;
}

/** Files the browser may send for a review: the names the manifest allows, nothing else. */
export const UPLOADABLE = /^(video\.mp4|poster\.jpg|frames\/F\d{3}\.jpg|sprites\/P\d{3}\.jpg)$/;

/** The most a single uploaded file may be, by its name. */
export function maxBytesFor(file: string): number {
  if (file === "video.mp4") return LIMITS.maxBytes;
  if (file === "poster.jpg") return POSTER_MAX_BYTES;
  if (file.startsWith("frames/")) return FRAME_MAX_BYTES;
  return SPRITE_MAX_BYTES;
}

/**
 * A review whose upload can't be used: it stops here with a message saying why, the sent files
 * and any working files are removed, anything set aside for it is released, and it doesn't count
 * toward today's reviews.
 */
export async function rejectUpload(id: string, message: string) {
  const r = await getReview(id);
  if (r?.userId && isHosted()) await removeAllStoredMedia(r.userId, id).catch((e) => console.error("[intake] removing the upload failed", e));
  fs.rmSync(reviewDir(id), { recursive: true, force: true });
  await settleOpenReservations(id);
  await q("DELETE FROM app.usage WHERE review_id = $1 AND kind = 'review'", [id]);
  await updateReview(id, { stage: "failed", stageDetail: UPLOAD_REJECTED, error: message, storedFiles: [] });
}

/** Marks a review whose video was turned away: it can't be retried, since the files are gone. */
export const UPLOAD_REJECTED = "upload-rejected";

export type IntakeResult = "ready" | "rejected" | "not-needed";

class Rejected extends Error {}

/** What a person sees when their prepared files don't check out. The specific reason goes to the server log. */
const TRY_AGAIN = "Something went wrong preparing your video. Please try again.";

async function readLocalHead(file: string, bytes: number): Promise<Uint8Array> {
  const fh = await fs.promises.open(file, "r");
  try {
    const buf = Buffer.alloc(Math.min(bytes, (await fh.stat()).size));
    await fh.read(buf, 0, buf.length, 0);
    return new Uint8Array(buf.buffer, buf.byteOffset, buf.length);
  } finally {
    await fh.close();
  }
}

async function checkJpeg(file: string, rule: (w: number, h: number) => boolean, label: string) {
  const meta = await sharp(file).metadata().catch(() => null);
  if (!meta || meta.format !== "jpeg") throw new Rejected(`${label} isn't a JPEG.`);
  if (!meta.width || !meta.height || !rule(meta.width, meta.height)) throw new Rejected(`${label} is ${meta.width}×${meta.height}, which isn't allowed.`);
}

/**
 * Checks a review's prepared files before any paid step (plan section 4.3, steps 7–10), writes
 * its captions, and records the video's own duration and size. Anything wrong ends the review
 * with a plain message; network trouble throws, so the step is retried.
 */
export async function verifyUpload(id: string): Promise<IntakeResult> {
  const r = await getReview(id);
  if (!r || r.ledger) return "not-needed";
  const m = r.draft?.manifest;
  const hosted = isHosted();
  if (hosted && !r.userId) return "not-needed";
  if (!m) {
    await rejectUpload(id, "Your video's details went missing. Please start again and send it once more.");
    return "rejected";
  }
  await updateReview(id, { stage: "ingesting", stageDetail: "Checking your video" });
  const dir = reviewDir(id);
  const expected = expectedFiles(m);
  let own = { durationSec: m.video.durationSec, width: m.video.width, height: m.video.height };
  try {
    // 7. Exactly the files declared, at the sizes declared.
    const present = new Map<string, number>();
    if (hosted) {
      for (const [f, size] of await listReviewObjects(r.userId!, id)) if (f !== "captions.vtt") present.set(f, size);
    } else {
      for (const f of expected.keys()) {
        const p = path.join(/* turbopackIgnore: true */ dir, f);
        if (fs.existsSync(p)) present.set(f, fs.statSync(p).size);
      }
    }
    for (const [f, size] of expected) {
      if (!present.has(f)) throw new Rejected(`${f} never arrived.`);
      if (present.get(f) !== size) throw new Rejected(`${f} is ${present.get(f)} bytes, not the ${size} declared.`);
    }
    for (const f of present.keys()) if (!expected.has(f)) throw new Rejected(`${f} wasn't declared.`);

    // 8. The MP4, from its own bytes.
    const head = hosted ? await fetchHead(r.userId!, id, "video.mp4", MP4_HEAD_BYTES) : await readLocalHead(path.join(dir, "video.mp4"), MP4_HEAD_BYTES);
    const parsed = inspectMp4(head);
    if (!parsed.ok) throw new Rejected(`The MP4 couldn't be read: ${parsed.reason}`);
    const info = parsed.info;
    const problems = mp4Problems(info);
    if (problems.length) throw new Rejected(problems.join(" "));
    if (Math.abs(info.durationSec - m.video.durationSec) > 0.1) throw new Rejected(`The MP4 is ${info.durationSec} s long, not ${m.video.durationSec} s.`);
    if (info.width !== m.video.width || info.height !== m.video.height) throw new Rejected(`The MP4 is ${info.width}×${info.height}, not ${m.video.width}×${m.video.height}.`);
    if (!(info.durationSec >= MIN_DURATION_SEC && info.durationSec <= MAX_DURATION_SEC)) throw new Rejected("The MP4's length is outside the limits.");
    if (!(info.height > info.width) || Math.min(info.width, info.height) > 720) throw new Rejected("The MP4 isn't a vertical 720p video.");
    if ((info.audio.length > 0) !== m.video.hasAudio) throw new Rejected("The MP4's audio doesn't match what was declared.");
    own = { durationSec: Math.round(info.durationSec * 1000) / 1000, width: info.width, height: info.height };

    // 9. The images: real JPEGs of the sizes they should be. They stay in the working folder for the reviewers.
    const images = [...expected.keys()].filter((f) => f !== "video.mp4");
    for (const f of images) {
      if (hosted) await restoreFile(r.userId!, id, f);
      const p = path.join(/* turbopackIgnore: true */ dir, f);
      if (f === "poster.jpg") await checkJpeg(p, (w, h) => Math.max(w, h) <= 1280, "The poster");
      else if (f.startsWith("frames/")) await checkJpeg(p, (w, h) => Math.max(w, h) <= 640, f);
      else {
        const s = m.sprites.find((x) => x.file === f)!;
        await checkJpeg(p, (w, h) => w === s.cols * s.tileW && h === s.rows * s.tileH, f);
      }
    }
  } catch (e) {
    if (!(e instanceof Rejected)) throw e;
    console.error(`[intake] ${id} rejected: ${e.message}`);
    await rejectUpload(id, TRY_AGAIN);
    return "rejected";
  }

  // 10. Captions come from the checked transcript, written here (the browser doesn't send them).
  const transcript = buildTranscript(m.transcript);
  const stored = hosted ? [...expected.keys()] : [];
  if (transcript.length) {
    const vtt = Buffer.from(captionsVtt(transcript));
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "captions.vtt"), vtt);
    if (hosted) {
      await putSmallFile(r.userId!, id, "captions.vtt", vtt);
      stored.push("captions.vtt");
    }
  }
  const latest = await getReview(id);
  await updateReview(id, {
    video: { originalName: m.originalName || "video", bytes: m.video.bytes, ...own, hasAudio: m.video.hasAudio },
    ...(hosted ? { storedFiles: [...new Set([...(latest?.storedFiles ?? []), ...stored])] } : {}),
  });
  return "ready";
}
