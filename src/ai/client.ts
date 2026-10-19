import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { z } from "zod";
import { addCost, getReview } from "@/server/reviews";
import { COST_CAP_USD } from "@/server/config";
import { assertWithinSpendLimits, LimitReached, recordSpend } from "@/server/budget";

export const MODELS = {
  fast: "claude-haiku-5-5",
  vision: "claude-sonnet-5-5",
  deep: "claude-opus-5-5",
} as const;
type ModelId = (typeof MODELS)[keyof typeof MODELS];

/** USD per million tokens: [input, output, cache read]. */
const PRICES: Record<ModelId, [number, number, number]> = {
  "claude-haiku-5-5": [0.1, 0.5, 0.01],
  "claude-sonnet-5-5": [2, 10, 0.2],
  "claude-opus-5-5": [4, 20, 0.2],
};

export class AiUnavailable extends Error {}
export class BudgetExceeded extends Error {}

let client: Anthropic | null = null;
function anthropic(): Anthropic {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new AiUnavailable("ANTHROPIC_API_KEY is not set. Add it to .env.local and restart.");
  }
  client ??= new Anthropic();
  return client;
}

/**
 * Problems with the key or the account won't go away by trying again, so they're
 * reported as AiUnavailable with what to do, instead of a generic "try again".
 */
function accountProblem(e: unknown): Error {
  if (!(e instanceof Anthropic.APIError)) return e as Error;
  if (e.status === 401) return new AiUnavailable("Anthropic rejected the API key in .env.local. Run npm run setup to enter a working key, then restart Panel.");
  if (e.status === 403) return new AiUnavailable("This Anthropic API key isn't allowed to use the models Panel needs. Check the key's workspace in the Anthropic Console.");
  if (e.status === 400 && /credit balance|billing/i.test(e.message)) return new AiUnavailable("Your Anthropic account is out of credits. Add some under Settings → Billing in the Anthropic Console, then try again.");
  return e;
}

function priceOf(model: ModelId, usage: Anthropic.Beta.BetaUsage): number {
  const [i, o, c] = PRICES[model];
  const cacheWrite = (usage.cache_creation_input_tokens ?? 0) * i * 1.25;
  return (usage.input_tokens * i + usage.output_tokens * o + (usage.cache_read_input_tokens ?? 0) * c + cacheWrite) / 1e6;
}

type CallOpts<S extends z.ZodType> = {
  label: string;
  reviewId?: string;
  model: ModelId;
  system: Anthropic.Beta.BetaTextBlockParam[] | string;
  messages: Anthropic.Beta.BetaMessageParam[];
  schema: S;
  effort?: "low" | "medium" | "high" | "xhigh";
  maxTokens?: number;
};

/** Checked before every paid call: app-wide daily/monthly caps, then this review's own cap. */
async function checkBudget(reviewId?: string) {
  try {
    await assertWithinSpendLimits();
  } catch (e) {
    if (e instanceof LimitReached) throw new BudgetExceeded(e.message);
    throw e;
  }
  if (!reviewId) return;
  const r = await getReview(reviewId);
  if (r && r.cost.usd >= COST_CAP_USD) {
    throw new BudgetExceeded(`This review reached its $${COST_CAP_USD.toFixed(2)} spending cap.`);
  }
}

/**
 * One structured call. Streams under the hood (long inputs/outputs), validates
 * the result against the zod schema, records cost against the review.
 */
export async function callStructured<S extends z.ZodType>(opts: CallOpts<S>): Promise<z.infer<S>> {
  await checkBudget(opts.reviewId);
  const useFallbacks = opts.model !== MODELS.fast;
  const stream = anthropic().beta.messages.stream({
    model: opts.model,
    max_tokens: opts.maxTokens ?? 32000,
    system: opts.system,
    messages: opts.messages,
    output_config: { format: betaZodOutputFormat(opts.schema), ...(opts.effort ? { effort: opts.effort } : {}) },
    ...(useFallbacks ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
  });
  const msg = await stream.finalMessage().catch((e) => {
    throw accountProblem(e);
  });
  const usd = priceOf(opts.model, msg.usage);
  await recordSpend({ label: opts.label, model: opts.model, usd, reviewId: opts.reviewId });
  if (opts.reviewId) {
    await addCost(opts.reviewId, { label: opts.label, model: opts.model, usd, inTok: msg.usage.input_tokens, outTok: msg.usage.output_tokens });
  }
  if (msg.stop_reason === "refusal") throw new Error(`${opts.label}: the model declined this request.`);
  if (msg.stop_reason === "max_tokens") throw new Error(`${opts.label}: response was cut off (max_tokens).`);
  if (!msg.parsed_output) throw new Error(`${opts.label}: response did not match the expected format.`);
  return msg.parsed_output as z.infer<S>;
}

/** Streaming plain-text call used for follow-up chat. Yields text deltas. */
export async function* streamText(opts: Omit<CallOpts<z.ZodType>, "schema"> & { tools?: Anthropic.Beta.BetaToolUnion[] }) {
  await checkBudget(opts.reviewId);
  const stream = anthropic().beta.messages.stream({
    model: opts.model,
    max_tokens: opts.maxTokens ?? 8000,
    system: opts.system,
    messages: opts.messages,
    ...(opts.tools ? { tools: opts.tools } : {}),
    ...(opts.effort ? { output_config: { effort: opts.effort } } : {}),
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
  });
  try {
    for await (const ev of stream) {
      if (ev.type === "content_block_delta" && ev.delta.type === "text_delta") yield { type: "text" as const, text: ev.delta.text };
    }
  } catch (e) {
    throw accountProblem(e);
  }
  const msg = await stream.finalMessage();
  await recordSpend({ label: opts.label, model: opts.model, usd: priceOf(opts.model, msg.usage), reviewId: opts.reviewId });
  if (opts.reviewId) {
    await addCost(opts.reviewId, {
      label: opts.label,
      model: opts.model,
      usd: priceOf(opts.model, msg.usage),
      inTok: msg.usage.input_tokens,
      outTok: msg.usage.output_tokens,
    });
  }
  yield { type: "final" as const, message: msg };
}
