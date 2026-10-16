import { z } from "zod";
import type Anthropic from "@anthropic-ai/sdk";
import { FramePerception, type Frame, type Ledger } from "@/core/evidence";
import type { IntentFields } from "@/core/intent";
import { callStructured, MODELS } from "./client";
import { labeledFrame, renderIntent } from "./render";
import { mapLimit } from "@/media/exec";

const Out = z.object({ frames: z.array(FramePerception) });

const SYSTEM = `You describe sampled still frames from a short video so that reviewers who cannot see the video can rely on your descriptions.
Each image has its frame id and timestamp burned into the top-left corner. That label is not part of the video; never describe it as on-screen text.
For each frame, report only what is visible in that still:
- description: one or two concrete sentences (who/what is in frame, action implied by the pose, setting, notable visual details). Do not guess motion you cannot see.
- onScreenText: any text or captions that are part of the video, transcribed exactly; empty string if none.
- captionsVisible: true if burned-in captions/subtitles are visible.
- people: number of people visible (0 if none).
- framing: e.g. "extreme close-up", "close-up", "medium", "wide", "screen recording", "product shot", "overhead".
- productVisible: true/false if the video is an ad and a product could be on screen; null if not an ad.
Be neutral and factual. Do not judge quality. Do not invent anything you cannot see.`;

export async function perceiveFrames(
  reviewId: string,
  dir: string,
  frames: Frame[],
  ctx: { intent: IntentFields; transcript: Ledger["transcript"] },
): Promise<FramePerception[]> {
  const batches: Frame[][] = [];
  for (let i = 0; i < frames.length; i += 16) batches.push(frames.slice(i, i + 16));
  const transcript = ctx.transcript.map((s) => `[${s.start.toFixed(1)}–${s.end.toFixed(1)}s] ${s.text}`).join("\n") || "(no speech)";

  const results = await mapLimit(batches, 3, async (batch, bi) => {
    const content: Anthropic.Beta.BetaContentBlockParam[] = [
      {
        type: "text",
        text: `What the creator says this video is:\n${renderIntent(ctx.intent)}\n\nTranscript, for context only:\n${transcript}\n\nDescribe these ${batch.length} frames, in order, one entry per frame id: ${batch.map((f) => f.id).join(", ")}.`,
      },
    ];
    for (const f of batch) {
      content.push({ type: "text", text: `${f.id} @ ${f.t.toFixed(2)}s` });
      content.push(await labeledFrame(dir, f));
    }
    const out = await callStructured({
      label: `perceive:${bi + 1}/${batches.length}`,
      reviewId,
      model: MODELS.vision,
      effort: "low",
      maxTokens: 24000,
      system: SYSTEM,
      messages: [{ role: "user", content }],
      schema: Out,
    });
    const ids = new Set(batch.map((f) => f.id));
    return out.frames.filter((p) => ids.has(p.frameId));
  });
  return results.flat();
}
