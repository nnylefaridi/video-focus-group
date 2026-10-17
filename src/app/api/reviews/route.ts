import { z } from "zod";
import { connection } from "next/server";
import { isComplete, resolve, type Answer } from "@/core/questionnaire/engine";
import { liveProfiles } from "@/experts/load";
import { createReview, listReviews, newReviewId } from "@/server/reviews";
import { hasAnthropicKey } from "@/server/config";
import { assertCanStartReview, LimitReached } from "@/server/budget";

const Body = z.object({
  answers: z.array(z.object({ questionId: z.string(), display: z.string(), fields: z.record(z.string(), z.unknown()), skipped: z.boolean().optional() })),
  board: z.array(z.string()).min(1).max(4),
});

export async function GET() {
  await connection();
  return Response.json({ reviews: listReviews() });
}

export async function POST(req: Request) {
  if (!hasAnthropicKey()) {
    return Response.json({ error: "ANTHROPIC_API_KEY is not set. Add it to .env.local and restart the app." }, { status: 503 });
  }
  try {
    assertCanStartReview();
  } catch (e) {
    if (e instanceof LimitReached) return Response.json({ error: e.message }, { status: 429 });
    throw e;
  }
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid request" }, { status: 400 });
  const answers = parsed.data.answers as Answer[];
  if (!isComplete(answers)) return Response.json({ error: "Please finish the questions first." }, { status: 400 });
  const { fields, active } = resolve(answers);

  const live = new Map(liveProfiles().map((p) => [p.id, p]));
  const board = [...new Set(parsed.data.board)];
  if (board.some((id) => !live.get(id)?.categories.includes(fields.category!))) {
    return Response.json({ error: "One of those reviewers isn't available for this kind of video." }, { status: 400 });
  }

  const id = newReviewId();
  const title = (fields.summary ?? "Untitled video").slice(0, 120);
  createReview({ id, answers: active, intent: fields, board, title });
  return Response.json({ id });
}
