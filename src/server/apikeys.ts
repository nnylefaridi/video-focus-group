import { inspect } from "node:util";
import Anthropic from "@anthropic-ai/sdk";
import { one, q } from "./db";
import { isHosted } from "./config";
import { seal, unseal } from "./keyvault";
import type { PaymentMethod } from "./billing";
import { KEY_REJECTED, KEY_REMOVED, KEY_UNREADABLE } from "@/core/ownkey";

/**
 * Hosted mode: the Anthropic API keys of accounts that pay with their own. Stored
 * encrypted (keyvault.ts); the browser only ever sees the last 4 characters and the
 * date it was saved.
 */

/**
 * A decrypted key. It only comes out through reveal(), for handing to the Anthropic
 * client; printing, logging or serializing it shows just the last 4 characters.
 */
export class SecretKey {
  readonly #value: string;
  constructor(value: string) {
    this.#value = value;
  }
  reveal(): string {
    return this.#value;
  }
  get last4(): string {
    return this.#value.slice(-4);
  }
  toString() {
    return `[Anthropic API key ending in ${this.last4}]`;
  }
  toJSON() {
    return this.toString();
  }
  [inspect.custom]() {
    return this.toString();
  }
}

/** What the browser may see about a saved key. */
export type KeyInfo = { last4: string; savedAt: number; rejected: boolean };

export { KEY_FORBIDDEN, KEY_REJECTED, KEY_REMOVED, KEY_UNREADABLE } from "@/core/ownkey";

/** The key failed its check with Anthropic (or wasn't a key at all), so it wasn't saved. */
export class KeyCheckFailed extends Error {}

/** Trims what was pasted and checks it looks like a key, without saying anything about the key itself. */
export function normalizeKey(input: unknown): string {
  const key = typeof input === "string" ? input.trim() : "";
  if (!key) throw new KeyCheckFailed("Paste your Anthropic API key first.");
  if (/\s/.test(key) || key.length < 20 || key.length > 512) throw new KeyCheckFailed("That doesn't look like an Anthropic API key. Copy the whole key from the Anthropic Console and paste it again.");
  return key;
}

const CHECK_TIMEOUT_MS = 10_000;

/**
 * Checks the key works by listing models, which Anthropic doesn't charge for. Throws
 * KeyCheckFailed with what to do. The error never contains the key.
 */
export async function checkAnthropicKey(key: string): Promise<void> {
  try {
    const client = new Anthropic({ apiKey: key, authToken: null, timeout: CHECK_TIMEOUT_MS, maxRetries: 0 });
    await client.models.list({ limit: 1 });
  } catch (e) {
    throw new KeyCheckFailed(keyCheckMessage(e));
  }
}

function keyCheckMessage(e: unknown): string {
  if (e instanceof Anthropic.APIConnectionTimeoutError) return "Anthropic took too long to answer while checking your key. Please try again.";
  if (e instanceof Anthropic.APIConnectionError) return "Couldn't reach Anthropic to check your key. Please try again in a minute.";
  if (e instanceof Anthropic.AuthenticationError) return "Anthropic didn't accept that key. Check you copied the whole key and that it hasn't been deleted in the Anthropic Console.";
  if (e instanceof Anthropic.PermissionDeniedError) return "That key isn't allowed to use Anthropic's models. Check its workspace and permissions in the Anthropic Console.";
  if (e instanceof Anthropic.RateLimitError) return "Anthropic is limiting requests on that key right now. Wait a minute and try again.";
  if (e instanceof Anthropic.APIError && (e.status ?? 0) >= 500) return "Anthropic is having trouble right now, so the key couldn't be checked. Please try again in a few minutes.";
  return "Couldn't check that key with Anthropic. Please try again.";
}

type KeyRow = { key_version: number; iv: string; auth_tag: string; ciphertext: string; last4: string; saved_at: string; rejected_at: string | null };

const infoOf = (r: Pick<KeyRow, "last4" | "saved_at" | "rejected_at">): KeyInfo => ({ last4: r.last4, savedAt: Number(r.saved_at), rejected: r.rejected_at != null });

export async function getKeyInfo(userId: string): Promise<KeyInfo | null> {
  const row = await one<KeyRow>("SELECT last4, saved_at, rejected_at FROM app.api_keys WHERE user_id = $1", [userId]);
  return row ? infoOf(row) : null;
}

/** Saves (or replaces) the account's key. Check it with checkAnthropicKey first. */
export async function saveKey(userId: string, key: string): Promise<KeyInfo> {
  const s = seal(key, userId);
  const now = Date.now();
  await q(
    `INSERT INTO app.api_keys (user_id, key_version, iv, auth_tag, ciphertext, last4, saved_at, rejected_at) VALUES ($1, $2, $3, $4, $5, $6, $7, NULL)
     ON CONFLICT (user_id) DO UPDATE SET key_version = excluded.key_version, iv = excluded.iv, auth_tag = excluded.auth_tag,
       ciphertext = excluded.ciphertext, last4 = excluded.last4, saved_at = excluded.saved_at, rejected_at = NULL`,
    [userId, s.version, s.iv, s.tag, s.ciphertext, key.slice(-4), now],
  );
  return { last4: key.slice(-4), savedAt: now, rejected: false };
}

/** Removes the key entirely. Returns whether there was one. */
export async function deleteKey(userId: string): Promise<boolean> {
  return (await q("DELETE FROM app.api_keys WHERE user_id = $1 RETURNING user_id", [userId])).length > 0;
}

/** Anthropic turned the key down mid-review: remember that until it's replaced. */
export async function markKeyRejected(userId: string): Promise<void> {
  await q("UPDATE app.api_keys SET rejected_at = $2 WHERE user_id = $1", [userId, Date.now()]);
}

/**
 * Which key pays for a review's calls, decided on the server each time one is made:
 * the server's own, or (hosted mode, a review started on the account's own key) the
 * owner's key as saved right now. `problem` says why the owner's key can't be used.
 */
export type ReviewKey =
  | { kind: "server"; paidWith: Exclude<PaymentMethod, "own_key"> | null }
  | { kind: "own"; userId: string; key: SecretKey | null; problem: string | null };

export async function reviewKey(reviewId: string): Promise<ReviewKey> {
  if (!isHosted()) return { kind: "server", paidWith: null };
  const review = await one<{ user_id: string | null; paid_with: string | null }>("SELECT user_id, paid_with::text AS paid_with FROM app.reviews WHERE id = $1", [reviewId]);
  if (!review?.user_id || review.paid_with !== "own_key") return { kind: "server", paidWith: review?.paid_with === "credits" ? "credits" : null };
  return { kind: "own", userId: review.user_id, ...(await accountKey(review.user_id)) };
}

/** The account's saved key as it is right now, or why it can't be used. */
export async function accountKey(userId: string): Promise<{ key: SecretKey | null; problem: string | null }> {
  const row = await one<KeyRow>("SELECT * FROM app.api_keys WHERE user_id = $1", [userId]);
  if (!row) return { key: null, problem: KEY_REMOVED };
  if (row.rejected_at != null) return { key: null, problem: KEY_REJECTED };
  try {
    const key = unseal({ version: Number(row.key_version), iv: row.iv, tag: row.auth_tag, ciphertext: row.ciphertext }, userId);
    return { key: new SecretKey(key), problem: null };
  } catch (e) {
    console.error(`[keys] couldn't decrypt the saved key of account ${userId}:`, e instanceof Error ? e.message : "unknown error");
    return { key: null, problem: KEY_UNREADABLE };
  }
}
