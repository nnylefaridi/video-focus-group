import { z } from "zod";
import { IntentFields, type IntentKey } from "@/core/intent";
import type { QuestionNode } from "@/core/questionnaire/graph";
import { callStructured, MODELS } from "./client";

/** Structured fields the interpreter may infer from free text. Free-text fields are copied verbatim instead. */
const INFERABLE = ["category", "format", "isComedy", "platforms", "offerType", "goal", "placement", "reactions", "niche", "product"] as const;

const InterpretOutput = z.object({
  updates: z.array(
    z.object({
      field: z.enum(INFERABLE),
      value: z.string(),
      confidence: z.enum(["high", "low"]),
    }),
  ),
});

const SYSTEM = `You turn one free-text questionnaire answer about a short-form video into structured fields.
Only infer what the answer clearly states or makes obvious. If something is merely possible, mark it low confidence or leave it out.

Fields and allowed values:
- category: "creator" (their own channel/content) or "ad" (advertising a product or service they sell)
- format: skit | talking_head | explainer | vlog | pov | challenge | other   (creator videos only)
- isComedy: "true" or "false"   (only if the answer says or clearly implies it is meant to be funny or not)
- platforms: comma-separated from tiktok, reels, shorts, youtube, linkedin, x, other
- offerType: physical_product | app_or_software | service | course_or_coaching | other   (ads only)
- goal: awareness | consideration | conversion | retargeting   (ads only)
- placement: paid_feed | organic | ugc_style   (ads only)
- reactions: comma-separated from laugh, learn, relate, share, follow
- niche: a few words naming the creator's niche, in their words
- product: what is being advertised, in their words

Return an empty updates list if nothing can be inferred.`;

function coerce(field: IntentKey, value: string): Partial<IntentFields> | null {
  const shape = IntentFields.shape[field];
  let candidate: unknown = value.trim();
  if (field === "isComedy") candidate = value.trim().toLowerCase() === "true";
  if (field === "platforms" || field === "reactions") {
    candidate = value.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  }
  const parsed = shape.safeParse(candidate);
  if (!parsed.success || parsed.data === "" || (Array.isArray(parsed.data) && parsed.data.length === 0)) return null;
  return { [field]: parsed.data } as Partial<IntentFields>;
}

/**
 * Fields contributed by a free-text answer: the question's own text fields
 * verbatim, plus high-confidence inferences for structured fields that are
 * not already known.
 */
export async function interpretAnswer(q: QuestionNode, raw: string, known: IntentFields): Promise<Partial<IntentFields>> {
  const fields: Partial<IntentFields> = {};
  for (const k of q.fills) {
    if (IntentFields.shape[k].safeParse(raw).success) Object.assign(fields, { [k]: raw });
  }

  const out = await callStructured({
    label: `interpret:${q.id}`,
    model: MODELS.fast,
    system: SYSTEM,
    maxTokens: 1500,
    messages: [
      {
        role: "user",
        content: `Question asked: ${q.prompt}\nAnswer: ${raw}\n\nAlready known (do not repeat): ${JSON.stringify(known)}`,
      },
    ],
    schema: InterpretOutput,
  });

  for (const u of out.updates) {
    if (u.confidence !== "high") continue;
    const current = known[u.field];
    if (current !== undefined && !(Array.isArray(current) && current.length === 0)) continue;
    if (fields[u.field] !== undefined) continue;
    const c = coerce(u.field, u.value);
    if (c) Object.assign(fields, c);
  }
  return fields;
}
