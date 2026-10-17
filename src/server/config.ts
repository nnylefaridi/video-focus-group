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

const num = (v: string | undefined, fallback: number) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

/** Spending protection for your API key. Override any of these in .env.local. */
export const COST_CAP_USD = num(process.env.REVIEW_COST_CAP_USD, 3);
export const SPEND_LIMITS = {
  dailyUsd: num(process.env.DAILY_LIMIT_USD, 10),
  monthlyUsd: num(process.env.MONTHLY_LIMIT_USD, 40),
  maxReviewsPerDay: num(process.env.MAX_REVIEWS_PER_DAY, 8),
  maxFollowupsPerReview: num(process.env.MAX_FOLLOWUPS_PER_REVIEW, 20),
  maxAnswerChecksPerHour: num(process.env.MAX_ANSWER_CHECKS_PER_HOUR, 60),
  /** Rough cost of one full review, used to refuse starting one that can't finish within budget. */
  typicalReviewUsd: 1.5,
};

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
