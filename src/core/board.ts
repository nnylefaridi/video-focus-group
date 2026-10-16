import type { IntentFields } from "./intent";
import type { Dimension } from "./expert";

export type BoardCandidate = {
  id: string;
  name: string;
  categories: ("creator" | "ad")[];
  appliesTo: Record<string, number>;
  covers: Dimension[];
  tensions: { with: string }[];
};

export type BoardPick = { id: string; score: number; reasons: string[] };

const SIGNAL_LABELS: Record<string, string> = {
  comedy: "it's comedy",
  "format:skit": "it's a skit",
  "format:talking_head": "you talk to camera",
  "format:explainer": "it teaches something",
  "format:vlog": "it's a vlog",
  "format:pov": "it's a POV",
  "format:challenge": "it's a challenge or stunt",
  "reaction:laugh": "you want laughs",
  "reaction:learn": "you want people to learn",
  "reaction:relate": "you want people to feel seen",
  "reaction:share": "you want shares",
  "reaction:follow": "you want follows",
  "goal:awareness": "the goal is awareness",
  "goal:consideration": "the goal is consideration",
  "goal:conversion": "the goal is sales or sign-ups",
  "goal:retargeting": "it's for retargeting",
  "placement:paid_feed": "it runs as a paid ad",
  "placement:organic": "it runs organically",
  "placement:ugc_style": "it's UGC-style",
  "offerType:physical_product": "it sells a physical product",
  "offerType:app_or_software": "it sells software",
  "offerType:service": "it sells a service",
  "offerType:course_or_coaching": "it sells a course or coaching",
  "platform:youtube": "it's for YouTube",
  "platform:shorts": "it's for Shorts",
  "platform:tiktok": "it's for TikTok",
  "platform:reels": "it's for Reels",
  "stage:starting": "your account is new",
};

/** Turn intent into the signals that profiles weight. */
export function intentSignals(f: IntentFields): string[] {
  const s: string[] = [];
  if (f.category) s.push(`category:${f.category}`);
  if (f.format) s.push(`format:${f.format}`);
  if (f.isComedy) s.push("comedy");
  for (const r of f.reactions ?? []) s.push(`reaction:${r}`);
  for (const p of f.platforms ?? []) s.push(`platform:${p}`);
  if (f.goal) s.push(`goal:${f.goal}`);
  if (f.placement) s.push(`placement:${f.placement}`);
  if (f.offerType) s.push(`offerType:${f.offerType}`);
  if (f.accountStage) s.push(`stage:${f.accountStage}`);
  return s;
}

function baseScore(c: BoardCandidate, signals: string[]) {
  const matched = signals
    .map((sig) => ({ sig, w: c.appliesTo[sig] ?? 0 }))
    .filter((m) => m.w > 0)
    .sort((a, b) => b.w - a.w);
  return { score: matched.reduce((sum, m) => sum + m.w, 0), matched };
}

/**
 * Pick a board: relevance first, then coverage diversity (so the board isn't
 * three hook specialists), with a small bonus for a documented-tension pair so
 * the panel can genuinely disagree.
 */
export function recommendBoard(candidates: BoardCandidate[], intent: IntentFields, size = 3): BoardPick[] {
  if (!intent.category) return [];
  const signals = intentSignals(intent);
  const pool = candidates
    .filter((c) => c.categories.includes(intent.category!))
    .map((c) => ({ c, ...baseScore(c, signals) }));

  const picks: (typeof pool)[number][] = [];
  const covered = new Set<Dimension>();

  while (picks.length < size && pool.length > picks.length) {
    let best: (typeof pool)[number] | null = null;
    let bestTotal = -Infinity;
    for (const cand of pool) {
      if (picks.includes(cand)) continue;
      const newDims = cand.c.covers.filter((d) => !covered.has(d)).length;
      const tension = picks.some(
        (p) => p.c.tensions.some((t) => t.with === cand.c.id) || cand.c.tensions.some((t) => t.with === p.c.id),
      )
        ? 1.5
        : 0;
      const total = cand.score + newDims * 0.6 + tension;
      if (total > bestTotal) {
        bestTotal = total;
        best = cand;
      }
    }
    if (!best) break;
    picks.push(best);
    best.c.covers.forEach((d) => covered.add(d));
  }

  return picks.map((p) => ({
    id: p.c.id,
    score: Math.round(p.score * 10) / 10,
    reasons: p.matched
      .map((m) => SIGNAL_LABELS[m.sig])
      .filter((x): x is string => Boolean(x))
      .slice(0, 2),
  }));
}
