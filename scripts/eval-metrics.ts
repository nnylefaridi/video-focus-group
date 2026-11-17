/**
 * Pure scoring for `npm run eval`.
 *
 * Basis columns follow the stored `basis` field (see Basis in src/core/review.ts).
 * "documented" is allowed and often unused: the reviewer prompt reserves it for
 * restating a principle, while every observation and recommendation has to be
 * about this video, which the same prompt calls "application". This module
 * counts stored values and does not relabel them.
 *
 * Processing time is the completed process job, started_at to finished_at.
 * That job finishes as the review reaches stage done. Review.updatedAt moves
 * again when follow-up chat writes, so it is not a processing time.
 */
import { Basis } from "../src/core/review";

export const pct = (n: number, d: number) => (d ? `${Math.round((n / d) * 100)}%` : "–");

/** Basis values the reviewer schema accepts, in enum order. */
export function schemaBasisValues(): readonly string[] {
  return Basis.options;
}

export type BasisItem = { basis?: string | null; principleIds?: readonly string[] | null };

export type ReviewerScore = {
  review: string;
  reviewer: string;
  obs: number;
  recs: number;
  cited: string;
  basisCounts: Record<string, number>;
  itemCount: number;
  dropped: number;
  generic: number;
  aiisms: number;
  predictions: number;
};

/** Counts observations and recommendations. "cited" is principle-id coverage among non-general items. */
export function scoreNotes(notes: {
  observations?: readonly BasisItem[] | null;
  recommendations?: readonly BasisItem[] | null;
}): { obs: number; recs: number; cited: string; basisCounts: Record<string, number>; itemCount: number } {
  const observations = notes.observations ?? [];
  const recommendations = notes.recommendations ?? [];
  const counts: Record<string, number> = {};
  let framed = 0;
  let cited = 0;
  for (const item of [...observations, ...recommendations]) {
    const basis = item.basis?.trim() || "(blank)";
    counts[basis] = (counts[basis] ?? 0) + 1;
    if (basis !== "general") {
      framed++;
      if ((item.principleIds ?? []).length > 0) cited++;
    }
  }
  return { obs: observations.length, recs: recommendations.length, cited: pct(cited, framed), basisCounts: counts, itemCount: observations.length + recommendations.length };
}

/** Table rows. Schema basis values are always columns, even at 0%. Any other stored value gets its own column. */
export function evalRows(scores: readonly ReviewerScore[]): Record<string, string | number>[] {
  const schema = [...schemaBasisValues()];
  const extras = new Set<string>();
  for (const s of scores) for (const k of Object.keys(s.basisCounts)) if (!schema.includes(k)) extras.add(k);
  const basisCols = [...schema, ...[...extras].sort()];
  return scores.map((s) => {
    const row: Record<string, string | number> = {
      review: s.review,
      reviewer: s.reviewer,
      obs: s.obs,
      recs: s.recs,
      cited: s.cited,
    };
    for (const col of basisCols) row[col] = pct(s.basisCounts[col] ?? 0, s.itemCount);
    row.dropped = s.dropped;
    row.generic = s.generic;
    row.aiisms = s.aiisms;
    row.predictions = s.predictions;
    return row;
  });
}

/** Corpus totals, including schema values that were never stored. */
export function basisSummary(scores: readonly ReviewerScore[]): string {
  const counts: Record<string, number> = {};
  for (const s of scores) for (const [k, n] of Object.entries(s.basisCounts)) counts[k] = (counts[k] ?? 0) + n;
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  if (!total) return "Basis: no observations or recommendations.";
  const schema = [...schemaBasisValues()];
  const extras = Object.keys(counts).filter((k) => !schema.includes(k)).sort();
  const parts = [...schema, ...extras].map((k) => `${k} ${pct(counts[k] ?? 0, total)} (${counts[k] ?? 0})`);
  return `Basis: ${parts.join(", ")}`;
}

/**
 * Present when the schema still allows "documented" and this run stored none,
 * so a 0% column is read as an unused value rather than a missing field.
 */
export function documentedGapNote(scores: readonly ReviewerScore[]): string | null {
  if (!schemaBasisValues().includes("documented")) return null;
  let total = 0;
  let documented = 0;
  for (const s of scores) {
    for (const [k, n] of Object.entries(s.basisCounts)) {
      total += n;
      if (k === "documented") documented += n;
    }
  }
  if (!total || documented > 0) return null;
  return 'Note: "documented" is an allowed basis value and was not stored on any item. The columns are the basis values these reviews actually stored.';
}

export type JobStamp = {
  reviewId: string;
  kind: string;
  status: string;
  startedAt: number | null;
  finishedAt: number | null;
};

function parseEpoch(v: unknown): number | null {
  if (v == null || v === "") return null;
  if (typeof v === "bigint") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** One app.jobs row. Bigint columns come back as strings from Postgres. */
export function parseJobStamp(row: {
  review_id: unknown;
  kind: unknown;
  status: unknown;
  started_at: unknown;
  finished_at: unknown;
}): JobStamp {
  return {
    reviewId: String(row.review_id),
    kind: String(row.kind),
    status: String(row.status),
    startedAt: parseEpoch(row.started_at),
    finishedAt: parseEpoch(row.finished_at),
  };
}

function doneProcess(job: JobStamp): job is JobStamp & { startedAt: number; finishedAt: number } {
  return job.kind === "process" && job.status === "done" && job.startedAt != null && job.finishedAt != null && job.finishedAt >= job.startedAt;
}

/** Duration of the process job that reached stage done. Later jobs win when a review was run more than once. */
export function completingProcessMs(jobs: readonly JobStamp[]): number | null {
  const done = jobs.filter(doneProcess);
  if (!done.length) return null;
  const job = done.reduce((best, j) => {
    if (j.finishedAt !== best.finishedAt) return j.finishedAt > best.finishedAt ? j : best;
    return j.startedAt > best.startedAt ? j : best;
  });
  return job.finishedAt - job.startedAt;
}

/**
 * Average processing time across reviews that have a usable completed process job.
 * Says so when that timestamp is missing, instead of falling back to updated_at - created_at.
 */
export function describeProcessingTime(reviewIds: readonly string[], jobs: readonly JobStamp[]): string {
  const byReview = new Map<string, JobStamp[]>();
  for (const id of reviewIds) byReview.set(id, []);
  for (const job of jobs) byReview.get(job.reviewId)?.push(job);

  const minutes: number[] = [];
  let omitted = 0;
  let withFailed = 0;
  let multiDone = 0;
  for (const id of reviewIds) {
    const list = byReview.get(id) ?? [];
    const ms = completingProcessMs(list);
    if (ms == null) {
      omitted++;
      continue;
    }
    minutes.push(ms / 60000);
    if (list.some((j) => j.kind === "process" && j.status === "failed")) withFailed++;
    if (list.filter(doneProcess).length > 1) multiDone++;
  }

  if (!minutes.length) {
    return "Time per review: unknown. No completed process job has both started_at and finished_at, so processing time cannot be measured. updated_at - created_at is not used, because follow-up chat updates updated_at after the review is done.";
  }

  const avg = minutes.reduce((a, b) => a + b, 0) / minutes.length;
  const max = Math.max(...minutes);
  const scope = omitted ? ` across ${minutes.length} of ${reviewIds.length} reviews` : "";
  const parts = [`Time per review: avg ${avg.toFixed(1)} min, max ${max.toFixed(1)} min${scope} (process job started_at to finished_at, when the review reached stage done)`];
  if (omitted === 1) parts.push("1 review has no completed process job with started_at and finished_at and is omitted from the average");
  else if (omitted > 1) parts.push(`${omitted} reviews have no completed process job with started_at and finished_at and are omitted from the average`);
  if (withFailed === 1) parts.push("Earlier failed process attempts on 1 review are not included");
  else if (withFailed > 1) parts.push(`Earlier failed process attempts on ${withFailed} reviews are not included`);
  if (multiDone) parts.push("Where a review has more than one completed process job, the latest finished_at is used");
  return parts.join(". ");
}
