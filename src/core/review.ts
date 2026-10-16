import { z } from "zod";

/**
 * Shapes the model must produce. Note: no timestamps anywhere — the model
 * cites evidence ids and the server derives time spans from the ledger.
 */

export const Basis = z.enum(["documented", "application", "general"]);

export const NoteObservation = z.object({
  id: z.string().describe("Short id like o1, o2"),
  evidenceIds: z.array(z.string()).describe("Ledger ids (F.., T.., S.., A..) this observation is based on"),
  claim: z.string().describe("What you noticed, in your own voice, specific to this video"),
  dimension: z.string(),
  sentiment: z.enum(["working", "problem", "neutral"]),
  basis: Basis,
  principleIds: z.array(z.string()).describe("Your principle ids this applies; empty only for basis=general"),
});

export const NoteRecommendation = z.object({
  id: z.string().describe("Short id like r1, r2"),
  change: z.string().describe("The concrete change to make"),
  why: z.string(),
  evidenceIds: z.array(z.string()),
  principleIds: z.array(z.string()),
  basis: Basis,
  priority: z.enum(["high", "medium", "low"]),
  confidence: z.enum(["firm", "tentative"]),
});

export const NoteKeep = z.object({
  what: z.string(),
  evidenceIds: z.array(z.string()),
  principleIds: z.array(z.string()),
});

export const ReviewerNotes = z.object({
  overall: z.string().describe("Two or three sentences, in your voice, on the video as a whole"),
  observations: z.array(NoteObservation),
  recommendations: z.array(NoteRecommendation),
  keep: z.array(NoteKeep),
  couldNotAssess: z.array(z.string()).describe("Things you'd want to judge but the evidence doesn't cover"),
});
export type ReviewerNotes = z.infer<typeof ReviewerNotes>;

export const DiscussionTurn = z.object({
  reviewerId: z.string(),
  stance: z.enum(["opens", "agrees", "disagrees", "builds", "closes"]),
  respondsTo: z.string().nullable(),
  text: z.string(),
  evidenceIds: z.array(z.string()),
  principleIds: z.array(z.string()),
});
export const Discussion = z.object({ turns: z.array(DiscussionTurn) });
export type DiscussionTurn = z.infer<typeof DiscussionTurn>;

export const Synthesis = z.object({
  consensus: z.array(
    z.object({ point: z.string(), reviewerIds: z.array(z.string()), evidenceIds: z.array(z.string()) }),
  ),
  disagreements: z.array(
    z.object({
      topic: z.string(),
      positions: z.array(
        z.object({ reviewerId: z.string(), position: z.string(), principleIds: z.array(z.string()) }),
      ),
      evidenceIds: z.array(z.string()),
    }),
  ),
  plan: z.object({
    high: z.array(
      z.object({
        change: z.string(),
        why: z.string(),
        reviewerIds: z.array(z.string()),
        evidenceIds: z.array(z.string()),
      }),
    ),
    experiments: z.array(
      z.object({
        idea: z.string(),
        options: z.array(z.object({ option: z.string(), reviewerIds: z.array(z.string()) })),
        evidenceIds: z.array(z.string()),
      }),
    ),
    keep: z.array(
      z.object({ what: z.string(), reviewerIds: z.array(z.string()), evidenceIds: z.array(z.string()) }),
    ),
  }),
});
export type Synthesis = z.infer<typeof Synthesis>;

/** A span the server attached after validating evidence ids. */
export type Span = { start: number; end: number };

export type StoredObservation = z.infer<typeof NoteObservation> & { reviewerId: string; span: Span };
export type StoredTurn = DiscussionTurn & { span: Span | null };

export type ReviewStage =
  | "uploading"
  | "queued"
  | "ingesting"
  | "transcribing"
  | "sampling"
  | "perceiving"
  | "reviewing"
  | "discussing"
  | "synthesizing"
  | "done"
  | "failed";

export const STAGE_LABELS: Record<ReviewStage, string> = {
  uploading: "Uploading your video",
  queued: "Waiting to start",
  ingesting: "Checking and preparing your video",
  transcribing: "Listening to the audio",
  sampling: "Finding cuts and pulling frames",
  perceiving: "Looking closely at each frame",
  reviewing: "Each reviewer is watching on their own",
  discussing: "The panel is talking it through",
  synthesizing: "Putting together your revision plan",
  done: "Ready",
  failed: "Something went wrong",
};
