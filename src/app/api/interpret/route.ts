import { z } from "zod";
import { QUESTION_BY_ID } from "@/core/questionnaire/graph";
import { resolve, type Answer } from "@/core/questionnaire/engine";
import { interpretAnswer } from "@/ai/interpret";
import { AiUnavailable, BudgetExceeded, asPayer, NO_PAYER, type Payer } from "@/ai/client";
import { spendAnswerCheck, LimitReached, limitResponse } from "@/server/budget";
import { whoIsCalling } from "@/server/client";
import { getViewer } from "@/server/auth";
import { isHosted } from "@/server/config";
import { getPaymentContext, paymentResponse } from "@/server/billing";

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
  const { userId } = await getViewer();
  // Hosted mode: the answer check runs on the visitor's own saved key or is charged to their
  // credits. Someone who hasn't signed in and chosen how to pay gets nothing from the server's key.
  let payer: Payer | null = null;
  if (isHosted()) {
    if (!userId) return Response.json({ error: NO_PAYER, payment: "choose", login: true }, { status: 401 });
    const payment = await getPaymentContext(userId);
    if (!payment.method || !payment.ready) return paymentResponse(payment);
    payer = { userId, method: payment.method };
  }
  try {
    await spendAnswerCheck(whoIsCalling(req.headers, userId));
  } catch (e) {
    if (e instanceof LimitReached) return limitResponse(e);
    throw e;
  }
  try {
    const check = () => interpretAnswer(q, parsed.data.raw, resolve(earlier).fields);
    const fields = payer ? await asPayer(payer, check) : await check();
    return Response.json({ fields });
  } catch (e) {
    const known = e instanceof AiUnavailable || e instanceof BudgetExceeded;
    const message = known ? e.message : "Couldn't read that answer just now. Please try again.";
    console.error("[interpret]", e);
    return Response.json({ error: message }, { status: e instanceof BudgetExceeded ? 429 : e instanceof AiUnavailable ? 503 : 502 });
  }
}
