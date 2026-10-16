import { z } from "zod";
import { connection } from "next/server";
import type Anthropic from "@anthropic-ai/sdk";
import { getReview, reviewDir, updateReview } from "@/server/reviews";
import { addMessage, getThread } from "@/server/followups";
import { getProfile } from "@/experts/load";
import { followupSystem, INSPECT_TOOL, MODELS, streamText } from "@/ai/followup";
import { AiUnavailable, BudgetExceeded } from "@/ai/client";
import { denseSample } from "@/media/pipeline";
import { perceiveFrames } from "@/ai/perceive";
import { evidenceSpan, type Ledger } from "@/core/evidence";

const Body = z.object({ reviewerId: z.string(), message: z.string().trim().min(1).max(2000) });

export async function GET(req: Request, ctx: RouteContext<"/api/reviews/[id]/chat">) {
  await connection();
  const { id } = await ctx.params;
  const reviewerId = new URL(req.url).searchParams.get("reviewer") ?? "";
  if (!getReview(id)) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json({ messages: getThread(id, reviewerId) });
}

async function inspect(reviewId: string, ledger: Ledger, seconds: number, focus: string) {
  const dir = reviewDir(reviewId);
  const t = Math.min(Math.max(0, seconds), ledger.coverage.durationSec);
  const added = await denseSample(dir, ledger.frames, ledger.shots, ledger.coverage.durationSec, t, 1.5);
  const perception = added.length
    ? await perceiveFrames(reviewId, dir, added, { intent: getReview(reviewId)!.intent, transcript: ledger.transcript })
    : [];
  ledger.frames.push(...added);
  ledger.perception.push(...perception);
  updateReview(reviewId, { ledger });
  // Include frames already sampled in this window too.
  const window = ledger.frames.filter((f) => Math.abs(f.t - t) <= 1.5).sort((a, b) => a.t - b.t);
  const byId = new Map(ledger.perception.map((p) => [p.frameId, p]));
  const speech = ledger.transcript.filter((s) => s.end >= t - 1.5 && s.start <= t + 1.5);
  return [
    `Close look around the requested moment (focus: ${focus}). ${added.length} new frames extracted.`,
    ...window.map((f) => {
      const p = byId.get(f.id);
      return `${f.id} @${f.t.toFixed(2)}s: ${p ? `${p.description} | on-screen text: ${p.onScreenText || "none"}` : "(not described)"}`;
    }),
    speech.length ? `Speech in this window: ${speech.map((s) => `${s.id} ${s.text}`).join(" ")}` : "No speech in this window.",
  ].join("\n");
}

/** Remove citations of ids that don't exist, so every cited id is real. */
function cleanCitations(text: string, ledger: Ledger, principleIds: Set<string>) {
  return text
    .replace(/\[([FTSA]\d+)\]/g, (m, id) => (evidenceSpan(ledger, id) ? m : ""))
    .replace(/\{([a-z0-9-]+)\}/g, (m, id) => (principleIds.has(id) ? m : ""));
}

export async function POST(req: Request, ctx: RouteContext<"/api/reviews/[id]/chat">) {
  const { id } = await ctx.params;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid request" }, { status: 400 });
  const r = getReview(id);
  if (!r || !r.ledger) return Response.json({ error: "This review isn't ready yet." }, { status: 409 });
  if (!r.board.includes(parsed.data.reviewerId)) return Response.json({ error: "That reviewer isn't on this panel." }, { status: 400 });
  const profile = getProfile(parsed.data.reviewerId);
  if (!profile) return Response.json({ error: "That reviewer is no longer available." }, { status: 400 });

  const ledger = r.ledger;
  const history = getThread(id, profile.id);
  addMessage(id, profile.id, "user", parsed.data.message);

  const system = followupSystem(profile, r.notes?.[profile.id], r.intent, ledger);
  const messages: Anthropic.Beta.BetaMessageParam[] = [
    ...history.map((m) => ({ role: m.role, content: m.text }) as Anthropic.Beta.BetaMessageParam),
    { role: "user", content: parsed.data.message },
  ];
  const principleIds = new Set(profile.principles.map((p) => p.id));

  const encoder = new TextEncoder();
  const body = new ReadableStream({
    async start(controller) {
      const send = (obj: unknown) => controller.enqueue(encoder.encode(`${JSON.stringify(obj)}\n`));
      let full = "";
      try {
        for (let step = 0; step < 4; step++) {
          let final: Anthropic.Beta.BetaMessage | null = null;
          for await (const ev of streamText({
            label: `followup:${profile.id}`,
            reviewId: id,
            model: MODELS.deep,
            effort: "medium",
            system,
            messages,
            tools: [INSPECT_TOOL],
          })) {
            if (ev.type === "text") {
              full += ev.text;
              send({ type: "text", text: ev.text });
            } else final = ev.message;
          }
          if (!final || final.stop_reason !== "tool_use") break;
          const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
          for (const block of final.content) {
            if (block.type !== "tool_use") continue;
            const input = block.input as { seconds?: number; focus?: string };
            if (typeof input.seconds !== "number") {
              results.push({ type: "tool_result", tool_use_id: block.id, content: "seconds must be a number", is_error: true });
              continue;
            }
            send({ type: "inspecting", seconds: input.seconds });
            results.push({ type: "tool_result", tool_use_id: block.id, content: await inspect(id, ledger, input.seconds, input.focus ?? "") });
          }
          messages.push({ role: "assistant", content: final.content });
          messages.push({ role: "user", content: results });
          full += "\n\n";
        }
        const cleaned = cleanCitations(full.trim(), ledger, principleIds);
        addMessage(id, profile.id, "assistant", cleaned);
        send({ type: "done", text: cleaned });
      } catch (e) {
        const message =
          e instanceof AiUnavailable || e instanceof BudgetExceeded ? e.message : "The reviewer couldn't answer just now. Please try again.";
        console.error("[chat]", e);
        send({ type: "error", error: message });
      } finally {
        controller.close();
      }
    },
  });
  return new Response(body, { headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store" } });
}
