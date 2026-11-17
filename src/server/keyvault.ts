import crypto from "node:crypto";
import { encryptionSecretOf } from "./mode.mjs";

/**
 * Hosted mode: encrypts people's own Anthropic API keys at rest with AES-256-GCM.
 * Each seal uses a fresh random 12-byte IV, and is bound to the account it belongs to
 * (as additional data), so a sealed key copied onto another account won't open.
 *
 * key_version says which secret sealed it. Version 1 is KEY_ENCRYPTION_SECRET. To
 * rotate later, add version 2 under a new setting, seal new keys with it, and re-seal
 * the old rows; until then both stay readable.
 */
export const KEY_VERSION = 1;

export type Sealed = { version: number; iv: string; tag: string; ciphertext: string };

export class KeyVaultUnavailable extends Error {}

function secretFor(version: number): Buffer {
  if (version !== 1) throw new KeyVaultUnavailable(`This key was sealed with secret version ${version}, which this copy of Panel doesn't have.`);
  const secret = encryptionSecretOf(process.env.KEY_ENCRYPTION_SECRET);
  if (!secret)
    throw new KeyVaultUnavailable("KEY_ENCRYPTION_SECRET isn't set to 32 random bytes (base64 or hex). Make one with `openssl rand -base64 32`, set it, and restart Video Focus Group.");
  return secret;
}

export function seal(plaintext: string, boundTo: string): Sealed {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", secretFor(KEY_VERSION), iv);
  cipher.setAAD(Buffer.from(boundTo, "utf8"));
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return { version: KEY_VERSION, iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), ciphertext: ciphertext.toString("base64") };
}

/** Throws if the sealed key was changed, belongs to another account, or was sealed with another secret. */
export function unseal(sealed: Sealed, boundTo: string): string {
  const iv = Buffer.from(sealed.iv, "base64");
  const tag = Buffer.from(sealed.tag, "base64");
  if (iv.length !== 12 || tag.length !== 16) throw new Error("The stored key is damaged.");
  const decipher = crypto.createDecipheriv("aes-256-gcm", secretFor(sealed.version), iv, { authTagLength: 16 });
  decipher.setAAD(Buffer.from(boundTo, "utf8"));
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(Buffer.from(sealed.ciphertext, "base64")), decipher.final()]).toString("utf8");
}
