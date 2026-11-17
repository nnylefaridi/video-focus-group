/**
 * Re-runs the paid review steps for one review that's already been prepared and sent from the
 * browser (videos are prepared on the person's own device now, so there's no command-line way
 * in), then prints a summary. Costs real Anthropic money, like a review in the app.
 *   npm run smoke -- <review-id>
 * Make the review in the app first (http://127.0.0.1:3000), then pass its id from the /r/<id> address.
 * The review keeps its checked files and evidence; its reviews are made again by the same
 * in-process runner the website uses (src/server/runner.ts).
 */
import { getReview, updateReview } from "../src/server/reviews";
import { enqueue } from "../src/server/jobs";
import { getRunner } from "../src/server/runner";

const id = process.argv[2];
if (!id) {
  console.error("Usage: npm run smoke -- <review-id>");
  process.exit(1);
}
const before = await getReview(id);
if (!before) throw new Error(`No review ${id}.`);
if (!before.video) throw new Error("That review never got a video. Make one in the app first.");
if (!before.ledger && !before.draft?.manifest) throw new Error("That review's prepared files are gone, so it can't be run again.");
// The evidence (and its frame descriptions) is kept if it's there; the reviews, discussion and summary are made again.
await updateReview(id, { stage: "queued", stageDetail: null, error: null, notes: null, discussion: null, synthesis: null });
await enqueue(id, "process");
await getRunner().kick();
console.log(`Review ${id} queued again. Open http://127.0.0.1:3000/r/${id}`);

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
    await getRunner().idle();
    process.exit(0);
  }
  await new Promise((res) => setTimeout(res, 1000));
}
console.error("Timed out after 15 minutes");
process.exit(1);
