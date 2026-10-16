import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";

export const DATA_DIR = path.resolve(/* turbopackIgnore: true */ process.env.DATA_DIR ?? path.join(/* turbopackIgnore: true */ process.cwd(), "data"));
export const MEDIA_DIR = path.join(DATA_DIR, "media");
export const DB_PATH = path.join(DATA_DIR, "app.db");
export const WHISPER_MODEL = path.resolve(/* turbopackIgnore: true */ process.env.WHISPER_MODEL ?? path.join(/* turbopackIgnore: true */ DATA_DIR, "models", "ggml-base.en.bin"));

export const LIMITS = {
  maxBytes: 250 * 1024 * 1024,
  maxDurationSec: 180,
  minDurationSec: 1,
  maxDimension: 4096,
};

export const COST_CAP_USD = Number(process.env.REVIEW_COST_CAP_USD ?? 3);

fs.mkdirSync(MEDIA_DIR, { recursive: true });

/** Secret for signing media URLs. Generated once per install, kept in the data dir. */
function loadSecret(): Buffer {
  const file = path.join(DATA_DIR, ".media-secret");
  if (!fs.existsSync(file)) fs.writeFileSync(file, crypto.randomBytes(32).toString("hex"), { mode: 0o600 });
  return Buffer.from(fs.readFileSync(file, "utf8").trim(), "hex");
}
export const MEDIA_SECRET = loadSecret();

export function hasAnthropicKey(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}
