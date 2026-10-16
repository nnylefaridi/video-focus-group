import type { Ledger, Frame } from "./evidence";
import type { ExpertCard } from "./expert";
import type { IntentFields } from "./intent";
import type { Answer } from "./questionnaire/engine";
import type { ReviewerNotes, ReviewStage, StoredTurn, Synthesis } from "./review";

export type PrincipleRef = {
  reviewerId: string;
  statement: string;
  confidence: "well_documented" | "stated_once" | "disputed_source";
  sources: { title: string; url: string; locator: string | null; kind: "primary" | "secondary" }[];
};

/** Everything the review room needs, as sent by GET /api/reviews/[id]. */
export type ReviewView = {
  id: string;
  createdAt: number;
  stage: ReviewStage;
  stageLabel: string;
  stageDetail: string | null;
  error: string | null;
  title: string | null;
  intent: IntentFields;
  answers: Answer[];
  board: ExpertCard[];
  video:
    | {
        url: string | null;
        poster: string | null;
        originalName: string;
        bytes: number;
        durationSec: number;
        width: number;
        height: number;
        hasAudio: boolean;
      }
    | null;
  ledger: (Omit<Ledger, "frames"> & { frames: (Frame & { url: string })[] }) | null;
  notes: Record<string, ReviewerNotes> | null;
  discussion: StoredTurn[] | null;
  synthesis: Synthesis | null;
  principles: Record<string, PrincipleRef>;
  costUsd: number;
};
