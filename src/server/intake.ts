import fs from "node:fs";
import path from "node:path";
import { probe, sniffContainer, UploadRejected } from "@/media/probe";
import { isTallerThanWide } from "@/core/uploadChecks";
import { isHosted, LIMITS, MAX_UPLOAD_MB } from "./config";
import { settleOpenReservations } from "./credits";
import { q } from "./db";
import { getReview, reviewDir, updateReview, type ReviewRecord } from "./reviews";
import { downloadUpload, removeUpload, uploadedSize } from "./storage";
import { accessibleReview, mustSignIn, signInResponse } from "./auth";

/**
 * Hosted uploads: the browser sends the video straight to private storage, the website only
 * checks it arrived (upload-complete), and the worker pulls it down here, checks it from its
 * own bytes and hands it to the usual processing. Local mode never comes through here.
 */

/** The review, if this signed-in person owns it and a direct upload may be started or finished for it. */
export async function ownedUploadReview(id: string): Promise<{ response: Response } | { review: ReviewRecord; userId: string }> {
  if (!isHosted()) return { response: Response.json({ error: "Videos are uploaded to this computer in local mode." }, { status: 400 }) };
  const found = await accessibleReview(id);
  if (!found) return { response: Response.json({ error: "Not found" }, { status: 404 }) };
  if (mustSignIn(found.viewer)) return { response: signInResponse() };
  const { review, viewer } = found;
  if (!review.userId || review.userId !== viewer.userId) return { response: Response.json({ error: "Not found" }, { status: 404 }) };
  if (review.stage !== "uploading") return { response: Response.json({ error: "This review already has a video." }, { status: 409 }) };
  return { review, userId: review.userId };
}

/**
 * A review whose upload can't be used: it stops here with a message saying why, the raw
 * upload and any working files are removed, anything set aside for it is released, and it
 * doesn't count toward today's reviews.
 */
export async function rejectUpload(id: string, message: string) {
  const r = await getReview(id);
  if (r?.userId) await removeUpload(r.userId, id).catch((e) => console.error("[intake] removing the upload failed", e));
  fs.rmSync(reviewDir(id), { recursive: true, force: true });
  await settleOpenReservations(id);
  await q("DELETE FROM app.usage WHERE review_id = $1 AND kind = 'review'", [id]);
  await updateReview(id, { stage: "failed", stageDetail: UPLOAD_REJECTED, error: message });
}

/** Marks a review whose video was turned away: it can't be retried, since the file is gone. */
export const UPLOAD_REJECTED = "upload-rejected";

export type IntakeResult = "ready" | "rejected" | "not-needed";

/**
 * Brings a directly uploaded video down from storage and checks it (size, magic bytes,
 * ffprobe: a real video stream, at most 3 minutes, taller than wide). Leaves it as
 * original.<ext> with its details saved, ready for processing. Anything wrong ends the
 * review with a clear message. Network trouble throws, so the review can be retried.
 */
export async function intakeUpload(id: string, fileName?: string): Promise<IntakeResult> {
  const r = await getReview(id);
  if (!r?.userId || r.ledger) return "not-needed";
  const dir = reviewDir(id);
  if (fs.existsSync(dir) && fs.readdirSync(dir).some((f) => f.startsWith("original."))) return "not-needed";

  await updateReview(id, { stage: "ingesting", stageDetail: "Checking your video" });
  const size = await uploadedSize(r.userId, id);
  if (size === null) {
    await rejectUpload(id, "Your video never arrived. Please start again and upload it once more.");
    return "rejected";
  }
  if (size === 0 || size > LIMITS.maxBytes) {
    await rejectUpload(id, size === 0 ? "That file is empty." : `That file is larger than ${MAX_UPLOAD_MB} MB. Please export a smaller version.`);
    return "rejected";
  }

  fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(dir, "upload.tmp");
  try {
    await downloadUpload(r.userId, id, tmp);
    const bytes = fs.statSync(tmp).size;
    if (bytes > LIMITS.maxBytes) throw new UploadRejected(`That file is larger than ${MAX_UPLOAD_MB} MB. Please export a smaller version.`);
    const container = sniffContainer(tmp);
    if (!container) throw new UploadRejected("That file isn't an MP4, MOV or WebM video.");
    const meta = await probe(tmp);
    if (!isTallerThanWide(meta)) {
      throw new UploadRejected(
        "Video Focus Group reviews vertical videos (like 9:16 for TikTok, Reels and Shorts), and this one is wider than it is tall. Please export a vertical version and try again.",
      );
    }
    fs.renameSync(tmp, path.join(dir, `original.${container === "mp4" ? "mp4" : "webm"}`));
    await updateReview(id, {
      video: {
        originalName: (fileName ?? r.video?.originalName ?? "video").slice(0, 200),
        bytes,
        durationSec: meta.durationSec,
        width: meta.width,
        height: meta.height,
        hasAudio: meta.hasAudio,
      },
    });
    return "ready";
  } catch (e) {
    fs.rmSync(tmp, { force: true });
    if (!(e instanceof UploadRejected)) throw e;
    await rejectUpload(id, e.message);
    return "rejected";
  }
}

/** The raw upload isn't needed once the review's analysis is saved. Best effort. */
export async function dropRawUpload(userId: string | null, id: string) {
  if (!userId || !isHosted()) return;
  await removeUpload(userId, id).catch((e) => console.error("[intake] removing the upload failed", e));
}
