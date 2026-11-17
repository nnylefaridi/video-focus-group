import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { z } from "zod";
import { addCost, getReview } from "@/server/reviews";
import { COST_CAP_USD } from "@/server/config";
import { assertWithinSpendLimits, LimitReached, recordSpend } from "@/server/budget";
import { KEY_FORBIDDEN, KEY_REJECTED, KEY_REMOVED, markKeyRejected, reviewKey } from "@/server/apikeys";
import type { PaymentMethod } from "@/server/billing";

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

let serverClient: Anthropic | null = null;
function serverAnthropic(): Anthropic {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new AiUnavailable("ANTHROPIC_API_KEY is not set. Add it to .env.local and restart.");
  }
  serverClient ??= new Anthropic();
  return serverClient;
}

/** The client a call runs on, whose own key that is (null: the server's), and how the call is paid for. */
type Caller = { client: Anthropic; ownKeyOf: string | null; paidWith: PaymentMethod | null };

/**
 * Every paid call gets its client here. Calls for a review started on the owner's own
 * key (hosted mode) use that key, looked up on the server at the moment of the call, so
 * a key removed or replaced mid-review takes effect on the next call. Everything else
 * (answer checks, local mode) uses the server's ANTHROPIC_API_KEY as always.
 */
async function anthropicFor(reviewId: string | null): Promise<Caller> {
  const k = reviewId ? await reviewKey(reviewId) : ({ kind: "server", paidWith: null } as const);
  if (k.kind === "server") return { client: serverAnthropic(), ownKeyOf: null, paidWith: k.paidWith };
  if (!k.key) throw new AiUnavailable(k.problem ?? KEY_REMOVED);
  return { client: new Anthropic({ apiKey: k.key.reveal(), authToken: null }), ownKeyOf: k.userId, paidWith: "own_key" };
}

/** The worker checks a review's key before starting, so a missing one fails before any media work. */
export async function checkReviewKey(reviewId: string): Promise<void> {
  await anthropicFor(reviewId);
}

/**
 * Problems with the key or the account won't go away by trying again, so they're
 * reported as AiUnavailable with what to do, instead of a generic "try again".
 */
async function accountProblem(e: unknown, ownKeyOf: string | null): Promise<Error> {
  if (!(e instanceof Anthropic.APIError)) return e as Error;
  if (ownKeyOf) {
    if (e.status === 401) {
      await markKeyRejected(ownKeyOf).catch(() => {});
      return new AiUnavailable(KEY_REJECTED);
    }
    if (e.status === 403) return new AiUnavailable(KEY_FORBIDDEN);
    if (e.status === 400 && /credit balance|billing/i.test(e.message))
      return new AiUnavailable("Your Anthropic account is out of credits. Add some under Settings → Billing in the Anthropic Console, then run the review again.");
    return e;
  }
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
  /**
   * The review this call is for, which decides whose key pays (see anthropicFor). Always
   * given for review work; null only for calls that belong to no review (answer checks).
   */
  reviewId: string | null;
  model: ModelId;
  system: Anthropic.Beta.BetaTextBlockParam[] | string;
  messages: Anthropic.Beta.BetaMessageParam[];
  schema: S;
  effort?: "low" | "medium" | "high" | "xhigh";
  maxTokens?: number;
};

/**
 * Checked before every paid call: the app-wide daily/monthly caps (which protect the
 * server's key, so they're skipped for calls on the owner's own key), then this
 * review's own cap, which applies to every review.
 */
async function checkBudget(reviewId: string | null, caller: Caller) {
  if (!caller.ownKeyOf) {
    try {
      await assertWithinSpendLimits();
    } catch (e) {
      if (e instanceof LimitReached) throw new BudgetExceeded(e.message);
      throw e;
    }
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
  const caller = await anthropicFor(opts.reviewId);
  await checkBudget(opts.reviewId, caller);
  const { client, ownKeyOf, paidWith } = caller;
  const useFallbacks = opts.model !== MODELS.fast;
  const stream = client.beta.messages.stream({
    model: opts.model,
    max_tokens: opts.maxTokens ?? 32000,
    system: opts.system,
    messages: opts.messages,
    output_config: { format: betaZodOutputFormat(opts.schema), ...(opts.effort ? { effort: opts.effort } : {}) },
    ...(useFallbacks ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
  });
  const msg = await stream.finalMessage().catch(async (e) => {
    throw await accountProblem(e, ownKeyOf);
  });
  const usd = priceOf(opts.model, msg.usage);
  await recordSpend({ label: opts.label, model: opts.model, usd, reviewId: opts.reviewId, paidWith });
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
  const caller = await anthropicFor(opts.reviewId);
  await checkBudget(opts.reviewId, caller);
  const { client, ownKeyOf, paidWith } = caller;
  const stream = client.beta.messages.stream({
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
    throw await accountProblem(e, ownKeyOf);
  }
  const msg = await stream.finalMessage();
  await recordSpend({ label: opts.label, model: opts.model, usd: priceOf(opts.model, msg.usage), reviewId: opts.reviewId, paidWith });
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
