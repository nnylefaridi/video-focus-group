/**
 * Runs one real video through the full pipeline using the running worker, then prints a summary.
 *   npx tsx --env-file=.env.local scripts/smoke-review.mts path/to/video.mp4 [reviewer-id ...]
 * Defaults to a comedy-skit board. Requires `npm run dev` (or `npm run worker`) to be running.
 */
import fs from "node:fs";
import path from "node:path";
import { createReview, newReviewId, reviewDir, updateReview, getReview } from "../src/server/reviews";
import { enqueue } from "../src/server/jobs";
import { probe, sniffContainer } from "../src/media/probe";

const src = process.argv[2];
if (!src) {
  console.error("Usage: scripts/smoke-review.mts <video> [reviewer-id ...]");
  process.exit(1);
}
const board = process.argv.slice(3).length ? process.argv.slice(3) : ["jerry-seinfeld", "steve-martin", "mrbeast"];
const container = sniffContainer(src);
if (!container) throw new Error("Not an MP4/MOV/WebM file");
const meta = await probe(src);

const id = newReviewId();
createReview({
  id,
  answers: [],
  intent: { category: "creator", summary: `Smoke test of ${path.basename(src)}`, isComedy: true, format: "skit" },
  board,
  title: `Smoke test: ${path.basename(src)}`,
});
fs.mkdirSync(reviewDir(id), { recursive: true });
fs.copyFileSync(src, path.join(reviewDir(id), `original.${container}`));
updateReview(id, { stage: "queued", video: { originalName: path.basename(src), bytes: fs.statSync(src).size, ...meta } });
enqueue(id, "process");
console.log(`Review ${id} queued. Open http://localhost:3000/r/${id}`);

let last = "";
const t0 = Date.now();
while (Date.now() - t0 < 15 * 60 * 1000) {
  const r = getReview(id)!;
  const line = `${r.stage}${r.stageDetail ? ` (${r.stageDetail})` : ""}`;
  if (line !== last) console.log(`  ${((Date.now() - t0) / 1000).toFixed(0)}s  ${line}`);
  last = line;
  if (r.stage === "failed") {
    console.error(`Failed: ${r.error}`);
    process.exit(1);
  }
  if (r.stage === "done") {
    const obs = Object.values(r.notes ?? {}).reduce((n, x) => n + x.observations.length, 0);
    console.log(`Done: ${r.ledger?.frames.length} frames, ${obs} observations, ${r.discussion?.length} turns, $${r.cost.usd.toFixed(3)}`);
    console.log(`Validation: ${JSON.stringify(r.validation)}`);
    process.exit(0);
  }
  await new Promise((res) => setTimeout(res, 1000));
}
console.error("Timed out after 15 minutes");
process.exit(1);
