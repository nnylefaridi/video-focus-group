import fs from "node:fs";
import path from "node:path";
import type { ReviewerNotes } from "@/core/review";
import { deriveEvidence } from "@/media/analysis/manifest";
import { perceiveFrames, perceptionKey } from "@/ai/perceive";
import { composeDiscussion, evidenceBlocks, reviewerPass, synthesize } from "@/ai/review";
import { getProfile } from "@/experts/load";
import { getReview, reviewDir, updateReview } from "./reviews";
import { enqueue } from "./jobs";
import { isHosted } from "./config";
import { restoreFile } from "./storage";
import { onReservation, reservationForRun, settleReservation } from "./credits";
import { OwnerKeyUnavailable } from "@/ai/client";
import { ownerKeyFailedSince } from "./ownerkey";

/**
 * The frames (and sprite sheets) the reviewers look at live in storage for hosted reviews; the
 * local working folder is only a cache that a restart or a sleeping host may have emptied.
 */
export async function ensureLocalMedia(userId: string | null, id: string, files: string[]) {
  if (!isHosted() || !userId) return;
  const dir = reviewDir(id);
  for (const f of files) if (!fs.existsSync(path.join(/* turbopackIgnore: true */ dir, f))) await restoreFile(userId, id, f);
}

/**
 * The runner's way in (src/server/runner.ts). On prepaid credits (hosted mode) every paid call runs on the
 * credit set aside for this run; finished or failed, the run is then charged what its
 * calls cost plus the margin, and the rest is released. A run that failed because the
 * app's own Anthropic key was refused is charged nothing. Otherwise it's processReview.
 */
export async function runReview(id: string, work: (id: string) => Promise<void> = processReview) {
  const r = await getReview(id);
  if (!(isHosted() && r?.paidWith === "credits")) return work(id);
  if (!r.userId) throw new Error("Log in to run this review.");
  const reservation = await reservationForRun(r.userId, id);
  const started = Date.now();
  // A run that failed because Anthropic refused the app's own key isn't charged at all.
  let waive = false;
  try {
    await onReservation(reservation, () => work(id));
  } catch (e) {
    waive = e instanceof OwnerKeyUnavailable || ownerKeyFailedSince(started);
    throw e;
  } finally {
    await settleReservation(reservation, { waive }).catch((e) => console.error(`[credits] settling review ${id} failed:`, e));
  }
}

export async function processReview(id: string) {
  const r = await getReview(id);
  if (!r) throw new Error(`Review ${id} not found`);
  const dir = reviewDir(id);
  const stage = (stage: NonNullable<Parameters<typeof updateReview>[1]["stage"]>, stageDetail: string | null = null) =>
    updateReview(id, { stage, stageDetail });

  const board = r.board.map((rid) => getProfile(rid));
  if (board.some((p) => !p)) throw new Error("A reviewer on this board is no longer available.");
  const profiles = board.filter((p): p is NonNullable<typeof p> => p !== null);

  // 1. Media → ledger (skipped when resuming after a later-stage failure).
  let ledger = r.ledger;
  if (!ledger) {
    // The browser prepared the media and the runner checked it (verifyUpload); everything but
    // the frame descriptions comes from that, with ids and timings derived here.
    const manifest = r.draft?.manifest;
    if (!manifest || !r.video) throw new Error("This review's video details are missing. Please start it again.");
    const evidence = deriveEvidence(manifest, r.video);
    const { frames, transcript } = evidence;
    await ensureLocalMedia(r.userId, id, frames.map((f) => f.file));

    await stage("perceiving", `${frames.length} frames`);
    // Each batch is saved as it's paid for, so a restart only repeats the batches that were in flight.
    const key = perceptionKey(frames);
    const batches = r.draft?.perception?.key === key ? { ...r.draft.perception.batches } : {};
    const perception = await perceiveFrames(id, dir, frames, {
      intent: r.intent,
      transcript,
      saved: batches,
      onBatch: async (index, described) => {
        batches[String(index)] = described;
        await updateReview(id, { draft: { manifest, perception: { key, batches } } });
      },
    });

    ledger = { ...evidence, perception };
    await updateReview(id, { ledger, draft: null });
  }

  // 2. Independent reviewer passes. The first warms the shared evidence cache, the rest run in parallel.
  const notes: Record<string, ReviewerNotes> = { ...(r.notes ?? {}) };
  const validation = { ...(r.validation ?? {}) };
  const pending = profiles.filter((p) => !notes[p.id]);
  if (pending.length) {
    await stage("reviewing", `${Object.keys(notes).length} of ${profiles.length} done`);
    await ensureLocalMedia(r.userId, id, ledger.frames.map((f) => f.file));
    const evidence = await evidenceBlocks(dir, ledger, r.intent);
    const runOne = async (p: (typeof profiles)[number]) => {
      const out = await reviewerPass(id, evidence, ledger!, p);
      notes[p.id] = out.notes;
      validation[p.id] = out.report;
      await updateReview(id, { notes, validation, stageDetail: `${Object.keys(notes).length} of ${profiles.length} done` });
    };
    await runOne(pending[0]);
    await Promise.all(pending.slice(1).map(runOne));
  }

  // 3. Discussion and synthesis.
  let discussion = r.discussion;
  if (!discussion) {
    await stage("discussing");
    const out = await composeDiscussion(id, ledger, r.intent, profiles, notes);
    discussion = out.turns;
    validation.discussion = out.report;
    await updateReview(id, { discussion, validation });
  }
  if (!r.synthesis) {
    await stage("synthesizing");
    const out = await synthesize(id, profiles, notes, discussion, ledger);
    validation.synthesis = out.report;
    await updateReview(id, { synthesis: out.synthesis, validation });
  }
  await stage("done");
  // Signed-in owners keep a record: copy the media to storage. Re-read, since the
  // review may have been claimed by a sign-in while it was processing.
  // Hosted reviews are in storage from the start; a local one is copied there only if it's kept in an account.
  if (!isHosted() && (await getReview(id))?.userId) await enqueue(id, "store");
}
