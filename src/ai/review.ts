import type Anthropic from "@anthropic-ai/sdk";
import type { Ledger } from "@/core/evidence";
import type { ExpertProfile } from "@/core/expert";
import type { IntentFields } from "@/core/intent";
import { Discussion, ReviewerNotes, Synthesis, type StoredTurn } from "@/core/review";
import { callStructured, MODELS } from "./client";
import { labeledFrame, pickReviewerFrames, renderIntent, renderLedger, renderProfile } from "./render";
import { validateDiscussion, validateNotes, validateSynthesis, type ValidationReport } from "./validate";

const REVIEWER_SYSTEM = `You write one reviewer's notes on one specific short video. The reviewer is an AI interpretation of a real, well-known person, built only from their documented public work (provided below). You are not that person. Never imply they watched, endorsed or personally reviewed this video.

Grounding rules:
1. Everything about the video must come from the evidence ledger. Cite evidence ids (F = sampled frame, T = transcript segment, S = shot, A = audio span) on every observation, recommendation and keep item.
2. Never write timestamps or times ("at 0:03", "3 seconds in") in your text. The app derives times from the ids you cite. Refer to moments descriptively ("your opening line", "the cut to the kitchen").
3. Frames are stills sampled from the video, so you cannot see motion between them. Audio beyond the transcript is known only as near-silence or "sound without speech" (unidentified music or effects). If something matters to this reviewer but the evidence doesn't cover it, list it in couldNotAssess instead of guessing.
4. The transcript is machine-generated and may contain recognition errors; don't build a point on a single uncertain word.

Reviewer rules:
5. Judge through this reviewer's lens, priorities, frameworks and the questions they ask first. Expert-framed claims must cite this reviewer's principle ids. basis = "documented" when restating a principle, "application" when applying a principle to this video, "general" only for a useful observation not tied to their principles (rare).
6. Stay in their lane. Leave topics outside their expertise to other reviewers.
7. Be specific: every recommendation names the exact moment (by evidence) and the exact change. Stock advice like "know your audience", "make it more engaging" or "add value" is not allowed.
8. Never predict views, virality, sales, conversions or performance. You may describe the likely viewer experience, with hedged language.
9. Never put words in this reviewer's mouth inside quotation marks unless the text is a verified excerpt provided in their profile. You may quote the video's own words exactly, and in "change" you may propose new wording for the creator in quotes (a suggested line, caption or title).
10. Write "claim", "change", "why" and "overall" in the first person, in this reviewer's tone and reasoning order. No catchphrase parody, no invented personal anecdotes or claims about their life or businesses.
11. Compare what the creator intended (their answers) with what the video actually does.
12. Be honest, not flattering. Include what genuinely works in keep.

Size: 4–8 observations, 3–6 recommendations, 1–4 keep items. Use ids o1, o2… and r1, r2….`;

export async function evidenceBlocks(dir: string, ledger: Ledger, intent: IntentFields): Promise<Anthropic.Beta.BetaContentBlockParam[]> {
  const frames = pickReviewerFrames(ledger);
  const blocks: Anthropic.Beta.BetaContentBlockParam[] = [
    {
      type: "text",
      text: `WHAT THE CREATOR TOLD US ABOUT THIS VIDEO:\n${renderIntent(intent)}\n\nEVIDENCE LEDGER:\n${renderLedger(ledger)}\n\nThe ${frames.length} images below are a subset of the sampled frames (hook, each shot, and a steady sample). Each has its id and time in the top-left corner; that label is not part of the video.`,
    },
  ];
  for (const f of frames) blocks.push(await labeledFrame(dir, f));
  // Cache everything up to here: it is identical for every reviewer on this video.
  const last = blocks[blocks.length - 1] as Anthropic.Beta.BetaImageBlockParam | Anthropic.Beta.BetaTextBlockParam;
  last.cache_control = { type: "ephemeral" };
  return blocks;
}

export async function reviewerPass(
  reviewId: string,
  evidence: Anthropic.Beta.BetaContentBlockParam[],
  ledger: Ledger,
  profile: ExpertProfile,
): Promise<{ notes: ReviewerNotes; report: ValidationReport }> {
  const raw = await callStructured({
    label: `review:${profile.id}`,
    reviewId,
    model: MODELS.deep,
    effort: "high",
    maxTokens: 64000,
    system: REVIEWER_SYSTEM,
    messages: [
      {
        role: "user",
        content: [
          ...evidence,
          { type: "text", text: `${renderProfile(profile)}\n\nWrite ${profile.name}'s notes on this video now.` },
        ],
      },
    ],
    schema: ReviewerNotes,
  });
  return validateNotes(raw, ledger, profile);
}

const DISCUSSION_SYSTEM = `You turn independent reviewer notes into a short panel discussion about one video. Each reviewer is an AI interpretation of a real person based on their documented work; they did not actually take part.

Rules:
- Use only points that appear in the reviewers' notes. Add no new claims about the video.
- Disagreements must be real: include one only where the notes actually conflict (different changes for the same moment, or one sees as working what another sees as a problem). Never manufacture conflict or agreement.
- Reviewers address each other by name and respond to what was said. Clear turn-taking.
- Each turn's evidenceIds and principleIds must come from that reviewer's own notes.
- No timestamps in the text and no quotation marks around the reviewers' words. The video's own words may be quoted exactly.
- Never predict views, virality, sales or performance.
- Each reviewer speaks in their own documented tone, with no parody or invented anecdotes.
- 6–12 turns. Open with the most important issue. Every reviewer speaks at least twice. End with each reviewer stating their single top priority (stance "closes").`;

export async function composeDiscussion(
  reviewId: string,
  ledger: Ledger,
  intent: IntentFields,
  board: ExpertProfile[],
  notes: Record<string, ReviewerNotes>,
): Promise<{ turns: StoredTurn[]; report: ValidationReport }> {
  const reviewers = board
    .map((p) => `### ${p.name} (reviewerId: ${p.id})\nTone: ${p.voice.tone}\nHabits: ${p.voice.habits.join("; ")}\nNotes:\n${JSON.stringify(notes[p.id])}`)
    .join("\n\n");
  const raw = await callStructured({
    label: "discussion",
    reviewId,
    model: MODELS.deep,
    effort: "medium",
    maxTokens: 32000,
    system: DISCUSSION_SYSTEM,
    messages: [
      {
        role: "user",
        content: `What the creator told us:\n${renderIntent(intent)}\n\nTranscript and shots for reference:\n${renderLedger(ledger, { perception: false })}\n\nREVIEWERS AND THEIR INDEPENDENT NOTES:\n\n${reviewers}\n\nWrite the discussion.`,
      },
    ],
    schema: Discussion,
  });
  return validateDiscussion(raw.turns, ledger, board);
}

const SYNTHESIS_SYSTEM = `You build the comparison and revision plan from a panel's notes and discussion about one video.
- consensus: points two or more reviewers independently agree on.
- disagreements: real conflicts, each reviewer's position, and the principle ids behind it.
- plan.high: changes with strong evidence and either agreement or a well-documented principle behind them. Concrete and specific to this video.
- plan.experiments: contested or subjective ideas worth trying. Give the competing options and who argues for each. Do not average them into one.
- plan.keep: elements working well that the creator should preserve.
Use only what is in the notes. Cite evidence ids and reviewer ids. No timestamps in text, no predictions of views or sales, no quotation marks around reviewers' words.`;

export async function synthesize(
  reviewId: string,
  board: ExpertProfile[],
  notes: Record<string, ReviewerNotes>,
  turns: StoredTurn[],
  ledger: Ledger,
): Promise<{ synthesis: Synthesis; report: ValidationReport }> {
  const raw = await callStructured({
    label: "synthesis",
    reviewId,
    model: MODELS.deep,
    effort: "medium",
    maxTokens: 32000,
    system: SYNTHESIS_SYSTEM,
    messages: [
      {
        role: "user",
        content: `REVIEWERS: ${board.map((p) => `${p.name} (${p.id})`).join(", ")}\n\nNOTES:\n${JSON.stringify(notes)}\n\nDISCUSSION:\n${turns.map((t) => `${t.reviewerId} [${t.stance}]: ${t.text}`).join("\n")}`,
      },
    ],
    schema: Synthesis,
  });
  return validateSynthesis(raw, ledger, board.map((p) => p.id), board);
}
