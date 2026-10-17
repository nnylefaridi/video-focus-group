/**
 * Runs one real video through the full pipeline using the running worker, then prints a summary.
 *   npm run smoke -- path/to/video.mp4 [reviewer-id ...] [--email you@example.com]
 * Defaults to a comedy-skit board. Requires `npm run dev` (or `npm run worker`) to be running.
 * With --email the review goes into that account, so you can open it in the app.
 */
import fs from "node:fs";
import path from "node:path";
import { createReview, newReviewId, reviewDir, updateReview, getReview } from "../src/server/reviews";
import { enqueue } from "../src/server/jobs";
import { one } from "../src/server/db";
import { probe, sniffContainer } from "../src/media/probe";

const args = process.argv.slice(2);
const emailAt = args.indexOf("--email");
const email = emailAt >= 0 ? args.splice(emailAt, 2)[1] : null;
const src = args[0];
if (!src) {
  console.error("Usage: scripts/smoke-review.mts <video> [reviewer-id ...]");
  process.exit(1);
}
const board = args.slice(1).length ? args.slice(1) : ["jerry-seinfeld", "steve-martin", "mrbeast"];
const userId = email ? (await one<{ id: string }>("SELECT id FROM auth.users WHERE lower(email) = lower($1)", [email]))?.id : null;
if (email && !userId) throw new Error(`No account with the email ${email}. Sign up in the app first.`);
const container = sniffContainer(src);
if (!container) throw new Error("Not an MP4/MOV/WebM file");
const meta = await probe(src);

const id = newReviewId();
await createReview({
  id,
  userId: userId ?? null,
  answers: [],
  intent: { category: "creator", summary: `Smoke test of ${path.basename(src)}`, isComedy: true, format: "skit" },
  board,
  title: `Smoke test: ${path.basename(src)}`,
});
fs.mkdirSync(reviewDir(id), { recursive: true });
fs.copyFileSync(src, path.join(reviewDir(id), `original.${container}`));
await updateReview(id, { stage: "queued", video: { originalName: path.basename(src), bytes: fs.statSync(src).size, ...meta } });
await enqueue(id, "process");
const accounts = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL);
console.log(userId || !accounts ? `Review ${id} queued. Open http://127.0.0.1:3000/r/${id}` : `Review ${id} queued (pass --email to open it in your account).`);

let last = "";
const t0 = Date.now();
while (Date.now() - t0 < 15 * 60 * 1000) {
  const r = (await getReview(id))!;
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
