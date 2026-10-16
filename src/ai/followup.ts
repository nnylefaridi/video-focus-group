import type Anthropic from "@anthropic-ai/sdk";
import type { ExpertProfile } from "@/core/expert";
import type { Ledger } from "@/core/evidence";
import type { ReviewerNotes } from "@/core/review";
import type { IntentFields } from "@/core/intent";
import { renderIntent, renderLedger, renderProfile } from "./render";
import { MODELS, streamText } from "./client";
import { SPOKEN_STYLE } from "./review";

const RULES = `You are answering the creator's follow-up questions as one reviewer on their panel. The reviewer is an AI interpretation of a real, well-known person, based only on their documented public work. You are not that person; if asked, say so plainly.

- Ground every statement about the video in the evidence ledger, and cite evidence ids in square brackets, like [F012] or [T03]. Never write timestamps yourself; the app shows times for the ids you cite.
- If the creator asks about a moment you haven't looked at closely, or about something between sampled frames, call inspect_moment with that time before answering. If the evidence still doesn't show it, say you couldn't observe it.
- When you rely on one of this reviewer's documented principles, cite it as {principle-id}, for example {ah-value-equation}. Distinguish what they documented from how you're applying it.
- Stay in this reviewer's lane and voice: their priorities, their reasoning order, their tone. No catchphrase parody, no invented anecdotes, and no quotation marks around their words unless the text is a verified excerpt from their profile.
- Never predict views, virality, sales or performance.
- Answer the way this person would answer across the table: concrete, in their voice, usually a few short paragraphs. Use "- " bullets only when listing distinct moments.

${SPOKEN_STYLE}`;

export const INSPECT_TOOL: Anthropic.Beta.BetaTool = {
  name: "inspect_moment",
  description:
    "Take a closer look at one moment of the video: extracts frames at 8 per second for about 1.5 seconds either side of the given time and describes each one. Returns new frame ids you can cite. Use it when asked about a specific moment or anything between the sampled frames.",
  input_schema: {
    type: "object",
    properties: {
      seconds: { type: "number", description: "Time in the video to inspect, in seconds" },
      focus: { type: "string", description: "What to look for, in a few words" },
    },
    required: ["seconds", "focus"],
    additionalProperties: false,
  },
  strict: true,
};

export function followupSystem(profile: ExpertProfile, notes: ReviewerNotes | undefined, intent: IntentFields, ledger: Ledger): Anthropic.Beta.BetaTextBlockParam[] {
  return [
    { type: "text", text: RULES },
    {
      type: "text",
      text: `${renderProfile(profile)}\n\nWHAT THE CREATOR TOLD US:\n${renderIntent(intent)}\n\nYOUR EARLIER NOTES ON THIS VIDEO:\n${JSON.stringify(notes ?? {})}`,
      cache_control: { type: "ephemeral" },
    },
    { type: "text", text: `EVIDENCE LEDGER:\n${renderLedger(ledger)}` },
  ];
}

export { MODELS, streamText };
