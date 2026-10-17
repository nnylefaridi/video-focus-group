import { z } from "zod";
import { QUESTION_BY_ID } from "@/core/questionnaire/graph";
import { resolve, type Answer } from "@/core/questionnaire/engine";
import { interpretAnswer } from "@/ai/interpret";
import { AiUnavailable, BudgetExceeded } from "@/ai/client";
import { spendAnswerCheck, LimitReached, limitResponse } from "@/server/budget";
import { whoIsCalling } from "@/server/client";
import { getViewer } from "@/server/auth";

const Body = z.object({
  questionId: z.string(),
  raw: z.string().trim().min(1).max(2000),
  answers: z.array(z.object({ questionId: z.string(), display: z.string(), fields: z.record(z.string(), z.unknown()), skipped: z.boolean().optional() })),
});

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid request" }, { status: 400 });
  const q = QUESTION_BY_ID.get(parsed.data.questionId);
  if (!q || q.answer.kind !== "text") return Response.json({ error: "Unknown question" }, { status: 400 });

  // Earlier answers, minus the one being (re)answered.
  const earlier = (parsed.data.answers as Answer[]).filter((a) => a.questionId !== q.id);
  try {
    await spendAnswerCheck(whoIsCalling(req.headers, (await getViewer()).userId));
  } catch (e) {
    if (e instanceof LimitReached) return limitResponse(e);
    throw e;
  }
  try {
    const fields = await interpretAnswer(q, parsed.data.raw, resolve(earlier).fields);
    return Response.json({ fields });
  } catch (e) {
    const known = e instanceof AiUnavailable || e instanceof BudgetExceeded;
    const message = known ? e.message : "Couldn't read that answer just now. Please try again.";
    console.error("[interpret]", e);
    return Response.json({ error: message }, { status: e instanceof BudgetExceeded ? 429 : e instanceof AiUnavailable ? 503 : 502 });
  }
}
