import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";
import { mediaSecretOf, parseMode, publicOriginOf, type Mode } from "./mode.mjs";

export type { Mode };

/**
 * How this copy of Panel runs: "local" (the default: one person on their own computer)
 * or "hosted" (PANEL_MODE=hosted: a public site, where people sign in before anything
 * paid runs). Startup refuses any other value, so this only throws if that was skipped.
 */
export function getMode(): Mode {
  return parseMode(process.env.PANEL_MODE);
}

export function isHosted(): boolean {
  return getMode() === "hosted";
}

/** Hosted mode's public address (HOSTED_PUBLIC_URL), where sign-in and payments send people back to. */
export function hostedOrigin(): string {
  const origin = publicOriginOf(process.env.HOSTED_PUBLIC_URL);
  if (!origin) throw new Error("HOSTED_PUBLIC_URL isn't set to the site's public https address. Set it and restart Video Focus Group.");
  return origin;
}

export const DATA_DIR = path.resolve(/* turbopackIgnore: true */ process.env.DATA_DIR ?? path.join(/* turbopackIgnore: true */ process.cwd(), "data"));
export const MEDIA_DIR = path.join(DATA_DIR, "media");
export const DB_PATH = path.join(DATA_DIR, "app.db");

const num = (v: string | undefined, fallback: number) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

/**
 * The default for MAX_UPLOAD_MB: 50 MB on a hosted site (the browser sends a 720p copy, which
 * fits easily, and storage and bandwidth stay small), 250 MB on your own computer. The mode is
 * read straight from PANEL_MODE here so that this file needs nothing else at import time.
 */
export const DEFAULT_UPLOAD_MB = process.env.PANEL_MODE?.trim() === "hosted" ? 50 : 250;
/** The biggest prepared video in megabytes (MAX_UPLOAD_MB). The only upload setting the browser is told. */
export const MAX_UPLOAD_MB = Math.floor(num(process.env.MAX_UPLOAD_MB, DEFAULT_UPLOAD_MB));

export const LIMITS = {
  maxBytes: MAX_UPLOAD_MB * 1024 * 1024,
  maxDurationSec: 180,
  minDurationSec: 1,
  maxDimension: 4096,
};

/** Spending protection for your API key. Override any of these in .env.local. */
export const COST_CAP_USD = num(process.env.REVIEW_COST_CAP_USD, 3);
/** Hosted mode, prepaid credits: the most one follow-up answer may cost (it sets this aside, with the margin, while it's written). */
export const FOLLOWUP_COST_CAP_USD = num(process.env.FOLLOWUP_COST_CAP_USD, 1.5);
export const SPEND_LIMITS = {
  dailyUsd: num(process.env.DAILY_LIMIT_USD, 10),
  monthlyUsd: num(process.env.MONTHLY_LIMIT_USD, 40),
  maxReviewsPerDay: num(process.env.MAX_REVIEWS_PER_DAY, 8),
  maxFollowupsPerReview: num(process.env.MAX_FOLLOWUPS_PER_REVIEW, 20),
  maxAnswerChecksPerHour: num(process.env.MAX_ANSWER_CHECKS_PER_HOUR, 60),
  /** Ceilings for one network (school, office, café) across all its people, signed in or not. */
  maxReviewsPerNetworkPerDay: num(process.env.MAX_REVIEWS_PER_NETWORK_PER_DAY, 40),
  maxAnswerChecksPerNetworkPerHour: num(process.env.MAX_ANSWER_CHECKS_PER_NETWORK_PER_HOUR, 300),
  /** Hosted mode: tries at saving an Anthropic API key, per account. */
  maxKeyChecksPerHour: num(process.env.MAX_KEY_CHECKS_PER_HOUR, 10),
  /** Rough cost of one full review, used to refuse starting one that can't finish within budget. */
  typicalReviewUsd: 1.5,
};

fs.mkdirSync(MEDIA_DIR, { recursive: true });

/**
 * Secret for signing media URLs and keying the per-network limits. Hosted mode: MEDIA_SECRET, the
 * same on every machine and across restarts. Local mode: generated once per install, kept in the data dir.
 */
let secret: Buffer | undefined;
export function mediaSecret(): Buffer {
  return (secret ??= loadSecret());
}
function loadSecret(): Buffer {
  if (isHosted()) {
    const fromEnv = mediaSecretOf(process.env.MEDIA_SECRET);
    if (!fromEnv) throw new Error("MEDIA_SECRET isn't set to at least 32 random bytes (base64 or hex). Make one with `openssl rand -base64 32`, set it, and restart.");
    return fromEnv;
  }
  const file = path.join(DATA_DIR, ".media-secret");
  if (!fs.existsSync(file)) fs.writeFileSync(file, crypto.randomBytes(32).toString("hex"), { mode: 0o600 });
  return Buffer.from(fs.readFileSync(file, "utf8").trim(), "hex");
}

export function hasAnthropicKey(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}
