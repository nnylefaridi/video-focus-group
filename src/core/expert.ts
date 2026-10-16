import { z } from "zod";

/** Dimensions a reviewer can cover. Used for board coverage and principle filtering. */
export const Dimension = z.enum([
  "hook",
  "retention",
  "payoff",
  "story",
  "comedy",
  "clarity",
  "editing",
  "visuals",
  "audio",
  "captions",
  "authenticity",
  "platform_fit",
  "offer",
  "brand",
  "cta",
  "persuasion",
  "teaching",
]);
export type Dimension = z.infer<typeof Dimension>;

export const Source = z.object({
  id: z.string(),
  title: z.string(),
  type: z.enum(["book", "talk", "interview", "video", "article", "podcast", "document"]),
  url: z.string().url(),
  date: z.string().optional(),
  kind: z.enum(["primary", "secondary"]),
  note: z.string().optional(),
});
export type Source = z.infer<typeof Source>;

export const SourceRef = z.object({ source: z.string(), locator: z.string().optional() });

export const Principle = z.object({
  id: z.string(),
  statement: z.string(),
  refs: z.array(SourceRef).min(1),
  /** Verbatim, short, only when verified against the source. */
  excerpt: z.string().max(220).optional(),
  confidence: z.enum(["well_documented", "stated_once", "disputed_source"]),
  dimensions: z.array(Dimension).min(1),
  context: z.string().optional(),
  status: z.enum(["verified", "draft"]),
});
export type Principle = z.infer<typeof Principle>;

export const Framework = z.object({
  id: z.string(),
  name: z.string(),
  steps: z.array(z.string()),
  refs: z.array(SourceRef).min(1),
  /** Authored interpretation: how this maps onto observable things in a short video. */
  videoApplication: z.string(),
});

export const Criterion = z.object({
  dimension: Dimension,
  priority: z.number().int().min(1).max(5),
  good: z.string(),
  bad: z.string(),
});

export const ExpertProfile = z.object({
  id: z.string(),
  name: z.string(),
  field: z.string(),
  /** Two or three words for the name card on the table. */
  short: z.string().max(28),
  lens: z.string(),
  bio: z.string(),
  status: z.enum(["verified", "draft"]),
  categories: z.array(z.enum(["creator", "ad"])).min(1),
  /** Board scoring weights keyed by signal (e.g. "format:skit", "comedy", "goal:conversion"). */
  appliesTo: z.record(z.string(), z.number()),
  covers: z.array(Dimension).min(1),
  sources: z.array(Source).min(1),
  principles: z.array(Principle).min(1),
  frameworks: z.array(Framework).default([]),
  criteria: z.array(Criterion).min(1),
  reasoningPattern: z.array(z.string()).min(1),
  voice: z.object({
    tone: z.string(),
    /** How they actually talk: rhythm, sentence shape, how they make and push back on a point. */
    speech: z.array(z.string()).default([]),
    /** Ordinary words and framework terms they lean on, used sparingly and never as quotes. */
    words: z.array(z.string()).default([]),
    habits: z.array(z.string()),
    avoid: z.array(z.string()),
  }),
  tensions: z
    .array(z.object({ with: z.string(), about: z.string(), documented: z.boolean() }))
    .default([]),
  limitations: z.array(z.string()).default([]),
  art: z.object({ color: z.string(), initials: z.string() }),
});
export type ExpertProfile = z.infer<typeof ExpertProfile>;

/** Safe subset sent to the browser. */
export type ExpertCard = {
  id: string;
  name: string;
  field: string;
  short: string;
  lens: string;
  color: string;
  initials: string;
  categories: ("creator" | "ad")[];
  covers: Dimension[];
};
