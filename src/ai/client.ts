import { AsyncLocalStorage } from "node:async_hooks";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { z } from "zod";
import { addCost, getReview } from "@/server/reviews";
import { COST_CAP_USD } from "@/server/config";
import { assertWithinSpendLimits, LimitReached, recordSpend } from "@/server/budget";
import { accountKey, KEY_FORBIDDEN, KEY_REJECTED, KEY_REMOVED, markKeyRejected, reviewKey } from "@/server/apikeys";
import { isHosted } from "@/server/config";
import type { PaymentMethod } from "@/server/billing";
import sharp from "sharp";
import { creditsPaused, OWNER_KEY_DOWN, ownerKeyFailed, ownerKeyWorked } from "@/server/ownerkey";
import { assertCreditsFor, chargeCall, currentReservation, holdForCall, NotEnoughCredits, releaseHold, ReservationUsed, usdToMicros, type Hold } from "@/server/credits";

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
/** Hosted mode: Anthropic refused the app's own key (401, or out of credit). Not the customer's doing, so nothing is charged. */
export class OwnerKeyUnavailable extends AiUnavailable {}

let serverClient: Anthropic | null = null;
function serverAnthropic(): Anthropic {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new AiUnavailable("ANTHROPIC_API_KEY is not set. Add it to .env.local and restart.");
  }
  serverClient ??= new Anthropic();
  return serverClient;
}

/**
 * The client a call runs on, whose own key that is (null: the server's), how the call is
 * paid for, and (credits, no review) whose credits it's charged to afterwards.
 */
type Caller = { client: Anthropic; ownKeyOf: string | null; paidWith: PaymentMethod | null; chargeTo?: string | null };

/** Who pays for calls that belong to no review (answer checks), in hosted mode. Set per request by asPayer. */
export type Payer = { userId: string; method: PaymentMethod };
const payers = new AsyncLocalStorage<Payer>();

/** Runs fn with its no-review calls paid by this account: on its own key, or charged to its credits. */
export function asPayer<T>(payer: Payer, fn: () => Promise<T>): Promise<T> {
  return payers.run(payer, fn);
}

export const NO_PAYER = "Choose how to pay first: prepaid credits or your own Anthropic API key.";

/**
 * Every paid call gets its client here. Calls for a review started on the owner's own
 * key (hosted mode) use that key, looked up on the server at the moment of the call, so
 * a key removed or replaced mid-review takes effect on the next call. Everything else
 * (answer checks, local mode) uses the server's ANTHROPIC_API_KEY as always.
 */
async function anthropicFor(reviewId: string | null): Promise<Caller> {
  // Hosted mode: a call that belongs to no review runs only for an account that pays for it.
  // The server's key is never spent on a visitor who hasn't chosen how to pay.
  if (!reviewId && isHosted()) return payerFor(payers.getStore());
  const k = reviewId ? await reviewKey(reviewId) : ({ kind: "server", paidWith: null } as const);
  if (k.kind === "server") return { client: serverAnthropic(), ownKeyOf: null, paidWith: k.paidWith };
  if (!k.key) throw new AiUnavailable(k.problem ?? KEY_REMOVED);
  return { client: ownKeyClient(k.key), ownKeyOf: k.userId, paidWith: "own_key" };
}

/** The one place a client is made on an account's own key (never the server's, whatever the environment holds). */
function ownKeyClient(key: { reveal(): string }): Anthropic {
  return new Anthropic({ apiKey: key.reveal(), authToken: null });
}

export async function payerFor(payer: Payer | undefined): Promise<Caller> {
  if (!payer) throw new AiUnavailable(NO_PAYER);
  if (payer.method === "credits") return { client: serverAnthropic(), ownKeyOf: null, paidWith: "credits", chargeTo: payer.userId };
  const { key, problem } = await accountKey(payer.userId);
  if (!key) throw new AiUnavailable(problem ?? KEY_REMOVED);
  return { client: ownKeyClient(key), ownKeyOf: payer.userId, paidWith: "own_key" };
}

/** The runner checks a review's key before starting, so a missing one fails before any media work. */
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
  // Hosted mode: the app's own key. The customer can't fix this, so they're told plainly
  // that nothing was charged; the owner gets an alert and credits pause (ownerkey.ts).
  const outOfCredit = e.status === 400 && /credit balance|billing/i.test(e.message);
  if (isHosted() && (e.status === 401 || outOfCredit)) {
    ownerKeyFailed(e.status === 401 ? "Anthropic rejected it (401)" : "its Anthropic account is out of credit (400 credit balance too low)");
    return new OwnerKeyUnavailable(OWNER_KEY_DOWN);
  }
  if (e.status === 401) return new AiUnavailable("Anthropic rejected the API key in .env.local. Run npm run setup to enter a working key, then restart Video Focus Group.");
  if (e.status === 403) return new AiUnavailable("This Anthropic API key isn't allowed to use the models Video Focus Group needs. Check the key's workspace in the Anthropic Console.");
  if (e.status === 400 && /credit balance|billing/i.test(e.message)) return new AiUnavailable("Your Anthropic account is out of credits. Add some under Settings → Billing in the Anthropic Console, then try again.");
  return e;
}

function priceOf(model: ModelId, usage: Anthropic.Beta.BetaUsage): number {
  const [i, o, c] = PRICES[model];
  const cacheWrite = (usage.cache_creation_input_tokens ?? 0) * i * 1.25;
  return (usage.input_tokens * i + usage.output_tokens * o + (usage.cache_read_input_tokens ?? 0) * c + cacheWrite) / 1e6;
}

/** Tokens an image can take: Anthropic counts about width x height / 750 (after shrinking big ones), plus room for error. */
async function imageTokens(block: { source?: { type?: string; data?: string } }): Promise<number> {
  const UNKNOWN = 10_000;
  if (block.source?.type !== "base64" || typeof block.source.data !== "string") return UNKNOWN;
  try {
    const meta = await sharp(Buffer.from(block.source.data, "base64")).metadata();
    if (!meta.width || !meta.height) return UNKNOWN;
    return Math.ceil(((meta.width * meta.height) / 750) * 1.1) + 100;
  } catch {
    return UNKNOWN;
  }
}

/**
 * An upper bound on a request's input tokens, without asking Anthropic: every byte of
 * text counts as a token (a token is never shorter than a byte), images by their size,
 * plus a margin for the request's own framing. Prepaid credits use it to make sure a
 * call can't cost more than the credit set aside for it.
 */
export async function inputTokenBound(request: { system: unknown; messages: Anthropic.Beta.BetaMessageParam[]; extra?: unknown }): Promise<number> {
  let images = 0;
  for (const m of request.messages) {
    if (typeof m.content === "string") continue;
    for (const b of m.content) {
      if (b.type === "image") images += await imageTokens(b as { source?: { type?: string; data?: string } });
      if (b.type === "tool_result" && Array.isArray(b.content))
        for (const inner of b.content) if (inner.type === "image") images += await imageTokens(inner as { source?: { type?: string; data?: string } });
    }
  }
  const text = JSON.stringify({ s: request.system, m: request.messages, x: request.extra ?? null }, (k, v) => (k === "data" && typeof v === "string" ? "" : v));
  return Buffer.byteLength(text, "utf8") + images + 2_000;
}

/**
 * Prepaid credits: claims the call's worst case from the reservation it runs on
 * (credits.ts holdForCall), which may lower its max_tokens to what still fits. Null for
 * calls that aren't paid with credits.
 */
async function holdCredits(
  caller: Caller,
  reviewId: string | null,
  model: ModelId,
  request: Parameters<typeof inputTokenBound>[0],
  maxTokens: number,
  minTokens: number,
): Promise<Hold | null> {
  if (caller.paidWith !== "credits") return null;
  if (caller.chargeTo) {
    // No review, so no reservation: the account must have the call's worst case free.
    const [i, o] = PRICES[model];
    try {
      await assertCreditsFor(caller.chargeTo, (await inputTokenBound(request)) * i * 1.25 + o * maxTokens);
    } catch (e) {
      if (e instanceof NotEnoughCredits) throw new BudgetExceeded(e.message);
      throw e;
    }
    return null;
  }
  const reservation = currentReservation();
  if (!reservation || !reviewId) throw new AiUnavailable("No credit was set aside for this, so it can't run. Please try again.");
  const [i, o] = PRICES[model];
  // Every input token priced as a cache write, the most an input token can cost (see priceOf).
  const inputMicros = (await inputTokenBound(request)) * i * 1.25;
  try {
    return await holdForCall(reservation, reviewId, { inputMicros, outputMicrosPerToken: o, maxTokens, minTokens });
  } catch (e) {
    if (e instanceof ReservationUsed || e instanceof NotEnoughCredits) throw new BudgetExceeded(e.message);
    throw e;
  }
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
 * server's key from spend nobody prepaid, so they're skipped for calls on the account's
 * own key and for calls paid with credits), then this review's own cap, which applies to
 * every review. Calls on credits also stop while credits are paused (ownerkey.ts).
 */
async function checkBudget(reviewId: string | null, caller: Caller) {
  if (caller.paidWith === "credits" && creditsPaused()) throw new OwnerKeyUnavailable(OWNER_KEY_DOWN);
  if (!caller.ownKeyOf && caller.paidWith !== "credits") {
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
  const format = betaZodOutputFormat(opts.schema);
  const wanted = opts.maxTokens ?? 32000;
  const hold = await holdCredits(caller, opts.reviewId, opts.model, { system: opts.system, messages: opts.messages, extra: format }, wanted, Math.min(wanted, 16000));
  let usd = 0;
  let msg: Anthropic.Beta.BetaMessage & { parsed_output?: unknown };
  try {
    const stream = client.beta.messages.stream({
      model: opts.model,
      max_tokens: hold?.maxTokens ?? wanted,
      system: opts.system,
      messages: opts.messages,
      output_config: { format, ...(opts.effort ? { effort: opts.effort } : {}) },
      ...(useFallbacks ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
    });
    msg = await stream.finalMessage().catch(async (e) => {
      throw await accountProblem(e, ownKeyOf);
    });
    if (!ownKeyOf) ownerKeyWorked();
    usd = priceOf(opts.model, msg.usage);
    await recordSpend({ label: opts.label, model: opts.model, usd, reviewId: opts.reviewId, paidWith });
    if (caller.chargeTo) await chargeCall(caller.chargeTo, usdToMicros(usd), opts.label);
    if (opts.reviewId) {
      await addCost(opts.reviewId, { label: opts.label, model: opts.model, usd, inTok: msg.usage.input_tokens, outTok: msg.usage.output_tokens });
    }
  } finally {
    if (hold) await releaseHold(hold, usdToMicros(usd));
  }
  if (msg.stop_reason === "refusal") throw new Error(`${opts.label}: the model declined this request.`);
  if (msg.stop_reason === "max_tokens") throw new Error(`${opts.label}: response was cut off (max_tokens).`);
  if (!msg.parsed_output) throw new Error(`${opts.label}: response did not match the expected format.`);
  return msg.parsed_output as z.infer<S>;
}

/** Streaming plain-text call used for follow-up chat. Yields text deltas. */
export async function* streamText(opts: Omit<CallOpts<z.ZodType>, "schema"> & { tools?: Anthropic.Beta.BetaToolUnion[] }) {
  const caller = await anthropicFor(opts.reviewId);
  // Streams are follow-up answers, which always belong to a review and its reservation.
  if (caller.chargeTo) throw new AiUnavailable("This can only run as part of a review.");
  await checkBudget(opts.reviewId, caller);
  const { client, ownKeyOf, paidWith } = caller;
  const wanted = opts.maxTokens ?? 8000;
  const hold = await holdCredits(caller, opts.reviewId, opts.model, { system: opts.system, messages: opts.messages, extra: opts.tools }, wanted, Math.min(wanted, 4000));
  let msg: Anthropic.Beta.BetaMessage | null = null;
  let failed = false;
  const record = async (m: Anthropic.Beta.BetaMessage) => {
    const usd = priceOf(opts.model, m.usage);
    await recordSpend({ label: opts.label, model: opts.model, usd, reviewId: opts.reviewId, paidWith });
    if (opts.reviewId) await addCost(opts.reviewId, { label: opts.label, model: opts.model, usd, inTok: m.usage.input_tokens, outTok: m.usage.output_tokens });
  };
  const stream = (() => {
    try {
      return client.beta.messages.stream({
        model: opts.model,
        max_tokens: hold?.maxTokens ?? wanted,
        system: opts.system,
        messages: opts.messages,
        ...(opts.tools ? { tools: opts.tools } : {}),
        ...(opts.effort ? { output_config: { effort: opts.effort } } : {}),
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
      });
    } catch (e) {
      if (hold) void releaseHold(hold, 0);
      throw e;
    }
  })();
  try {
    try {
      for await (const ev of stream) {
        if (ev.type === "content_block_delta" && ev.delta.type === "text_delta") yield { type: "text" as const, text: ev.delta.text };
      }
    } catch (e) {
      failed = true;
      throw await accountProblem(e, ownKeyOf);
    }
    msg = await stream.finalMessage();
    if (!ownKeyOf) ownerKeyWorked();
    await record(msg);
    yield { type: "final" as const, message: msg };
  } finally {
    let actual = msg ? usdToMicros(priceOf(opts.model, msg.usage)) : 0;
    // Whoever was reading stopped early. If the answer still finished, its real cost is
    // recorded; if it was cut off, what it used isn't known, so on credits its worst case is.
    if (!msg && !failed) {
      msg = await stream.finalMessage().catch(() => null);
      if (msg) {
        actual = usdToMicros(priceOf(opts.model, msg.usage));
        await record(msg).catch((e) => console.error("[ai] recording an abandoned call's cost failed", e));
      } else if (hold) {
        actual = hold.ceiling;
        await recordSpend({ label: `${opts.label} (stopped early, worst case)`, model: opts.model, usd: actual / 1e6, reviewId: opts.reviewId, paidWith }).catch(() => {});
      }
    }
    if (hold) await releaseHold(hold, actual);
  }
}
