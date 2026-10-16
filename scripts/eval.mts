/**
 * Scores finished reviews for grounding and quality, and writes a blind
 * identification sheet for human testing.
 *   npm run eval                     all finished reviews
 *   npm run eval -- <review-id> ...  specific reviews
 *
 * Seeded defects: list known problems per review in tests/eval/labels.json, e.g.
 *   { "<review-id>": [{ "defect": "slow hook", "start": 0, "end": 3 }] }
 * A defect counts as found when a reviewer flags a problem whose evidence overlaps that window.
 */
import fs from "node:fs";
import path from "node:path";
import { db } from "../src/server/db";
import { getReview, type ReviewRecord } from "../src/server/reviews";
import { deriveSpan } from "../src/core/evidence";
import { getProfile } from "../src/experts/load";

const PREDICTION = /\b(go(es|ing)? viral|guarantee[ds]?\b|will (definitely|certainly|surely) (sell|convert|perform|blow up)|(million|thousand)s? of views)/i;
const AI_ISM = /\b(great question|it's worth noting|additionally|furthermore|in conclusion|let's dive|i'd recommend|leverage|crucial|key takeaway|elevate|compelling|resonate)\b/i;
const GENERIC = /\b(know your audience|make it (more )?engaging|be (more )?authentic|add (more )?value|engage your audience|high[- ]quality content|tell a story|be consistent)\b/i;

const ids = process.argv.slice(2);
const reviews: ReviewRecord[] = (
  ids.length ? ids : (db().prepare("SELECT id FROM reviews WHERE stage = 'done' ORDER BY created_at").all() as { id: string }[]).map((r) => r.id)
)
  .map((id) => getReview(id))
  .filter((r): r is ReviewRecord => r !== null && r.stage === "done");

if (reviews.length === 0) {
  console.log("No finished reviews to evaluate yet.");
  process.exit(0);
}

const labelsFile = path.join(process.cwd(), "tests", "eval", "labels.json");
const labels: Record<string, { defect: string; start: number; end: number }[]> = fs.existsSync(labelsFile)
  ? JSON.parse(fs.readFileSync(labelsFile, "utf8"))
  : {};

const words = (s: string) => new Set(s.toLowerCase().match(/[a-z]{4,}/g) ?? []);
const jaccard = (a: Set<string>, b: Set<string>) => {
  const inter = [...a].filter((x) => b.has(x)).length;
  return inter / Math.max(1, a.size + b.size - inter);
};
const pct = (n: number, d: number) => (d ? `${Math.round((n / d) * 100)}%` : "–");

type Row = { review: string; reviewer: string; obs: number; recs: number; cited: string; documented: string; general: string; dropped: number; generic: number; aiisms: number; predictions: number };
const rows: Row[] = [];
const overlaps: string[] = [];
let found = 0;
let seeded = 0;
const missed: string[] = [];

for (const r of reviews) {
  const ledger = r.ledger!;
  for (const [rid, n] of Object.entries(r.notes ?? {})) {
    const items = [...n.observations, ...n.recommendations];
    const framed = items.filter((x) => x.basis !== "general");
    const texts = [n.overall, ...n.observations.map((o) => o.claim), ...n.recommendations.map((x) => `${x.change} ${x.why}`)];
    rows.push({
      review: r.id.slice(0, 6),
      reviewer: getProfile(rid)?.name ?? rid,
      obs: n.observations.length,
      recs: n.recommendations.length,
      cited: pct(framed.filter((x) => x.principleIds.length > 0).length, framed.length),
      documented: pct(items.filter((x) => x.basis === "documented").length, items.length),
      general: pct(items.filter((x) => x.basis === "general").length, items.length),
      dropped: r.validation?.[rid]?.dropped.length ?? 0,
      generic: texts.filter((t) => GENERIC.test(t)).length,
      aiisms: texts.filter((t) => AI_ISM.test(t)).length + (r.discussion ?? []).filter((t) => t.reviewerId === rid && AI_ISM.test(t.text)).length,
      predictions: texts.filter((t) => PREDICTION.test(t)).length,
    });
  }
  // Distinctiveness: reviewers on one video should not give near-identical advice.
  const entries = Object.entries(r.notes ?? {});
  for (let i = 0; i < entries.length; i++)
    for (let j = i + 1; j < entries.length; j++) {
      const a = words(entries[i][1].recommendations.map((x) => x.change).join(" "));
      const b = words(entries[j][1].recommendations.map((x) => x.change).join(" "));
      const sim = jaccard(a, b);
      if (sim > 0.35) overlaps.push(`${r.id.slice(0, 6)}: ${entries[i][0]} vs ${entries[j][0]} share ${Math.round(sim * 100)}% of recommendation vocabulary`);
    }
  // Seeded defects.
  for (const d of labels[r.id] ?? []) {
    seeded++;
    const hit = entries.some(([, n]) =>
      [...n.observations.filter((o) => o.sentiment === "problem"), ...n.recommendations].some((x) => {
        const s = deriveSpan(ledger, x.evidenceIds);
        return s && s.start <= d.end && s.end >= d.start;
      }),
    );
    if (hit) found++;
    else missed.push(`${r.id.slice(0, 6)}: ${d.defect} (${d.start}–${d.end}s)`);
  }
}

console.log(`\nEvaluated ${reviews.length} review(s)\n`);
console.table(rows);
const cost = reviews.map((r) => r.cost.usd);
const mins = reviews.map((r) => (r.updatedAt - r.createdAt) / 60000);
console.log(`Cost per review: avg $${(cost.reduce((a, b) => a + b, 0) / cost.length).toFixed(2)}, max $${Math.max(...cost).toFixed(2)}`);
console.log(`Time per review: avg ${(mins.reduce((a, b) => a + b, 0) / mins.length).toFixed(1)} min`);
console.log(`Seeded-defect recall: ${seeded ? `${found}/${seeded} (${pct(found, seeded)})` : "no labels in tests/eval/labels.json"}`);
if (missed.length) console.log(`Missed:\n  ${missed.join("\n  ")}`);
console.log(overlaps.length ? `Low distinctiveness:\n  ${overlaps.join("\n  ")}` : "Distinctiveness: no reviewer pairs with near-identical advice.");
const problems = rows.filter((r) => r.predictions > 0 || r.generic > 1);
if (problems.length) console.log(`Needs attention: ${problems.map((p) => `${p.reviewer} on ${p.review}`).join(", ")}`);

// Blind identification sheet: each reviewer's take with names hidden, answer key separate.
const outDir = path.join(process.cwd(), "tests", "eval", "out");
fs.mkdirSync(outDir, { recursive: true });
const stamp = new Date().toISOString().slice(0, 10);
let sheet = `# Blind identification sheet (${stamp})\n\nFor each video, match each anonymous take (A, B, C…) to a reviewer. Score fidelity 1–5 against their published work.\n`;
let key = `# Answer key (${stamp})\n`;
for (const r of reviews) {
  const entries = Object.entries(r.notes ?? {}).sort(() => Math.random() - 0.5);
  sheet += `\n## ${r.title}\nReviewers on this panel: ${r.board.map((b) => getProfile(b)?.name ?? b).join(", ")}\n`;
  key += `\n## ${r.title}\n`;
  entries.forEach(([rid, n], i) => {
    const letter = String.fromCharCode(65 + i);
    sheet += `\n### Take ${letter}\n${n.overall}\n${n.recommendations.map((x) => `- ${x.change}`).join("\n")}\n\nWho is this? ______  Fidelity (1–5): __  Specific to the video (1–5): __\n`;
    key += `- ${letter}: ${getProfile(rid)?.name ?? rid}\n`;
  });
}
fs.writeFileSync(path.join(outDir, `blind-sheet-${stamp}.md`), sheet);
fs.writeFileSync(path.join(outDir, `blind-key-${stamp}.md`), key);
console.log(`\nBlind sheet: tests/eval/out/blind-sheet-${stamp}.md (answer key alongside)`);
