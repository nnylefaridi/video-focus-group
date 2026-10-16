/**
 * Background worker: processes uploaded videos into reviews.
 * Runs alongside the web app (`npm run dev` starts both).
 */
import { claimNext, finishJob, requeueStale } from "../src/server/jobs";
import { processReview } from "../src/server/process";
import { cleanupAbandonedUploads, getReview, updateReview } from "../src/server/reviews";
import { AiUnavailable, BudgetExceeded } from "../src/ai/client";

requeueStale();
let lastCleanup = 0;
console.log("[worker] ready");

let stopping = false;
process.on("SIGINT", () => (stopping = true));
process.on("SIGTERM", () => (stopping = true));

function friendly(e: unknown): string {
  if (e instanceof AiUnavailable || e instanceof BudgetExceeded) return e.message;
  const msg = e instanceof Error ? e.message : String(e);
  if (/overloaded|529|rate.?limit|429/i.test(msg)) return "The AI service is busy right now. Try again in a minute.";
  return msg.length > 300 ? `${msg.slice(0, 300)}…` : msg;
}

while (!stopping) {
  if (Date.now() - lastCleanup > 10 * 60 * 1000) {
    const n = cleanupAbandonedUploads();
    if (n) console.log(`[worker] removed ${n} abandoned upload(s)`);
    lastCleanup = Date.now();
  }
  const job = claimNext();
  if (!job) {
    await new Promise((r) => setTimeout(r, 1000));
    continue;
  }
  const started = Date.now();
  console.log(`[worker] job ${job.id} ${job.kind} for ${job.reviewId}`);
  try {
    if (job.kind === "process") await processReview(job.reviewId);
    finishJob(job.id);
    const r = getReview(job.reviewId);
    console.log(`[worker] job ${job.id} done in ${((Date.now() - started) / 1000).toFixed(0)}s, cost $${r?.cost.usd.toFixed(3)}`);
  } catch (e) {
    console.error(`[worker] job ${job.id} failed:`, e);
    finishJob(job.id, String(e));
    updateReview(job.reviewId, { stage: "failed", error: friendly(e) });
  }
}
