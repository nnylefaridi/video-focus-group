import { deriveSpan, type Ledger } from "@/core/evidence";
import type { ExpertProfile } from "@/core/expert";
import type { DiscussionTurn, ReviewerNotes, StoredTurn, Synthesis } from "@/core/review";

export type ValidationReport = { dropped: string[]; fixed: string[] };

/** Predictions of performance are never allowed. */
const PREDICTION = /\b(go(es|ing)? viral|guarantee[ds]?\b|will (definitely|certainly|surely) (sell|convert|perform|blow up)|(million|thousand)s? of views|will get \d|blow up overnight)/i;
/** Stock advice that says nothing about this video. */
const GENERIC = /\b(know your audience|make it (more )?engaging|be (more )?authentic|add (more )?value|engage your audience|high[- ]quality content|tell a story|be consistent)\b/i;

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();

/** Quoted spans of 4+ words must come from a verified excerpt or from the video itself. */
function unverifiedQuote(text: string, allowed: string[]): string | null {
  for (const m of text.matchAll(/["“]([^"”]{8,})["”]/g)) {
    const q = norm(m[1]);
    if (q.split(" ").length < 4) continue;
    if (!allowed.some((a) => norm(a).includes(q))) return m[1];
  }
  return null;
}

function quoteSources(ledger: Ledger, profiles: ExpertProfile[]): string[] {
  return [
    ...ledger.transcript.map((s) => s.text),
    ...ledger.perception.map((p) => p.onScreenText),
    ...profiles.flatMap((p) => p.principles.map((x) => x.excerpt ?? "")).filter(Boolean),
  ];
}

function cleanIds(ids: string[], ledger: Ledger): string[] {
  return ids.filter((id) => deriveSpan(ledger, [id]) !== null);
}

/** Problems with free text that make an item unusable. */
function textProblem(text: string, allowed: string[]): string | null {
  if (PREDICTION.test(text)) return "performance prediction";
  const q = unverifiedQuote(text, allowed);
  if (q) return `unverified quote "${q.slice(0, 60)}"`;
  return null;
}

export function validateNotes(
  notes: ReviewerNotes,
  ledger: Ledger,
  profile: ExpertProfile,
): { notes: ReviewerNotes; report: ValidationReport } {
  const report: ValidationReport = { dropped: [], fixed: [] };
  const own = new Set(profile.principles.filter((p) => p.status === "verified").map((p) => p.id));
  const allowed = quoteSources(ledger, [profile]);

  const fixPrinciples = <T extends { principleIds: string[]; basis?: "documented" | "application" | "general" }>(item: T, label: string): T => {
    const kept = item.principleIds.filter((id) => own.has(id));
    if (kept.length !== item.principleIds.length) report.fixed.push(`${label}: removed principle ids not in ${profile.name}'s profile`);
    const next = { ...item, principleIds: kept };
    if (next.basis && next.basis !== "general" && kept.length === 0) {
      report.fixed.push(`${label}: no valid principle, relabeled as a general observation`);
      next.basis = "general";
    }
    return next;
  };

  const observations = notes.observations.flatMap((o) => {
    const evidenceIds = cleanIds(o.evidenceIds, ledger);
    if (evidenceIds.length === 0) return report.dropped.push(`${o.id}: no valid evidence`), [];
    const problem = textProblem(o.claim, allowed);
    if (problem) return report.dropped.push(`${o.id}: ${problem}`), [];
    return [fixPrinciples({ ...o, evidenceIds }, o.id)];
  });

  const recommendations = notes.recommendations.flatMap((r) => {
    const evidenceIds = cleanIds(r.evidenceIds, ledger);
    if (evidenceIds.length === 0) return report.dropped.push(`${r.id}: no valid evidence`), [];
    const problem = textProblem(`${r.change} ${r.why}`, allowed);
    if (problem) return report.dropped.push(`${r.id}: ${problem}`), [];
    if (GENERIC.test(r.change) && r.principleIds.length === 0) return report.dropped.push(`${r.id}: generic advice`), [];
    return [fixPrinciples({ ...r, evidenceIds }, r.id)];
  });

  const keep = notes.keep.flatMap((k, i) => {
    const evidenceIds = cleanIds(k.evidenceIds, ledger);
    if (evidenceIds.length === 0) return report.dropped.push(`keep#${i + 1}: no valid evidence`), [];
    if (textProblem(k.what, allowed)) return report.dropped.push(`keep#${i + 1}: text problem`), [];
    return [{ ...k, evidenceIds, principleIds: k.principleIds.filter((id) => own.has(id)) }];
  });

  let overall = notes.overall;
  if (textProblem(overall, allowed)) {
    report.fixed.push("overall: removed (prediction or unverified quote)");
    overall = "";
  }

  return { notes: { ...notes, overall, observations, recommendations, keep }, report };
}

export function validateDiscussion(
  turns: DiscussionTurn[],
  ledger: Ledger,
  profiles: ExpertProfile[],
): { turns: StoredTurn[]; report: ValidationReport } {
  const report: ValidationReport = { dropped: [], fixed: [] };
  const byId = new Map(profiles.map((p) => [p.id, p]));
  const allowed = quoteSources(ledger, profiles);
  const out: StoredTurn[] = [];
  turns.forEach((t, i) => {
    const p = byId.get(t.reviewerId);
    if (!p) return report.dropped.push(`turn ${i + 1}: unknown reviewer`);
    const problem = textProblem(t.text, allowed);
    if (problem) return report.dropped.push(`turn ${i + 1}: ${problem}`);
    const evidenceIds = cleanIds(t.evidenceIds, ledger);
    const own = new Set(p.principles.map((x) => x.id));
    out.push({
      ...t,
      respondsTo: t.respondsTo && byId.has(t.respondsTo) ? t.respondsTo : null,
      evidenceIds,
      principleIds: t.principleIds.filter((id) => own.has(id)),
      span: deriveSpan(ledger, evidenceIds),
    });
  });
  return { turns: out, report };
}

export function validateSynthesis(s: Synthesis, ledger: Ledger, reviewerIds: string[], profiles: ExpertProfile[]) {
  const report: ValidationReport = { dropped: [], fixed: [] };
  const allowed = quoteSources(ledger, profiles);
  const ok = new Set(reviewerIds);
  const rv = (ids: string[]) => ids.filter((id) => ok.has(id));
  const ev = (ids: string[]) => cleanIds(ids, ledger);
  const textOk = (label: string, t: string) => {
    const p = textProblem(t, allowed);
    if (p) report.dropped.push(`${label}: ${p}`);
    return !p;
  };
  const synthesis: Synthesis = {
    consensus: s.consensus
      .filter((c, i) => textOk(`consensus ${i + 1}`, c.point))
      .map((c) => ({ ...c, reviewerIds: rv(c.reviewerIds), evidenceIds: ev(c.evidenceIds) }))
      .filter((c) => c.reviewerIds.length >= 2),
    disagreements: s.disagreements
      .filter((d, i) => textOk(`disagreement ${i + 1}`, `${d.topic} ${d.positions.map((p) => p.position).join(" ")}`))
      .map((d) => ({ ...d, positions: d.positions.filter((p) => ok.has(p.reviewerId)), evidenceIds: ev(d.evidenceIds) }))
      .filter((d) => d.positions.length >= 2),
    plan: {
      high: s.plan.high
        .filter((h, i) => textOk(`plan.high ${i + 1}`, `${h.change} ${h.why}`))
        .map((h) => ({ ...h, reviewerIds: rv(h.reviewerIds), evidenceIds: ev(h.evidenceIds) }))
        .filter((h) => h.evidenceIds.length > 0),
      experiments: s.plan.experiments
        .filter((e, i) => textOk(`plan.experiment ${i + 1}`, `${e.idea} ${e.options.map((o) => o.option).join(" ")}`))
        .map((e) => ({ ...e, options: e.options.map((o) => ({ ...o, reviewerIds: rv(o.reviewerIds) })), evidenceIds: ev(e.evidenceIds) })),
      keep: s.plan.keep
        .filter((k, i) => textOk(`plan.keep ${i + 1}`, k.what))
        .map((k) => ({ ...k, reviewerIds: rv(k.reviewerIds), evidenceIds: ev(k.evidenceIds) }))
        .filter((k) => k.evidenceIds.length > 0),
    },
  };
  return { synthesis, report };
}
