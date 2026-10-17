import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { one, q, tx } from "./db";
import { MEDIA_DIR } from "./config";
import type { Answer } from "@/core/questionnaire/engine";
import type { IntentFields } from "@/core/intent";
import type { Ledger } from "@/core/evidence";
import type { ReviewerNotes, ReviewStage, StoredTurn, Synthesis } from "@/core/review";

export type VideoMeta = {
  originalName: string;
  bytes: number;
  durationSec: number;
  width: number;
  height: number;
  hasAudio: boolean;
};

export type Cost = { usd: number; calls: { label: string; model: string; usd: number; inTok: number; outTok: number }[] };

export type ReviewRecord = {
  id: string;
  createdAt: number;
  updatedAt: number;
  userId: string | null;
  anonId: string | null;
  stage: ReviewStage;
  stageDetail: string | null;
  error: string | null;
  answers: Answer[];
  intent: IntentFields;
  board: string[];
  title: string | null;
  video: VideoMeta | null;
  ledger: Ledger | null;
  notes: Record<string, ReviewerNotes> | null;
  discussion: StoredTurn[] | null;
  synthesis: Synthesis | null;
  validation: Record<string, { dropped: string[]; fixed: string[] }> | null;
  cost: Cost;
  storedFiles: string[];
};

type Row = Record<string, unknown>;

// jsonb comes back parsed from Postgres; tolerate text too.
const json = <T>(v: unknown): T | null => (v == null ? null : typeof v === "string" ? (JSON.parse(v) as T) : (v as T));

function fromRow(r: Row): ReviewRecord {
  return {
    id: String(r.id),
    createdAt: Number(r.created_at),
    updatedAt: Number(r.updated_at),
    userId: (r.user_id as string) ?? null,
    anonId: (r.anon_id as string) ?? null,
    stage: r.stage as ReviewStage,
    stageDetail: (r.stage_detail as string) ?? null,
    error: (r.error as string) ?? null,
    answers: json<Answer[]>(r.answers) ?? [],
    intent: json<IntentFields>(r.intent) ?? {},
    board: json<string[]>(r.board) ?? [],
    title: (r.title as string) ?? null,
    video: json<VideoMeta>(r.video),
    ledger: json<Ledger>(r.ledger),
    notes: json<Record<string, ReviewerNotes>>(r.notes),
    discussion: json<StoredTurn[]>(r.discussion),
    synthesis: json<Synthesis>(r.synthesis),
    validation: json<ReviewRecord["validation"]>(r.validation),
    cost: json<Cost>(r.cost) ?? { usd: 0, calls: [] },
    storedFiles: json<string[]>(r.stored_files) ?? [],
  };
}

export function newReviewId(): string {
  return crypto.randomBytes(12).toString("base64url");
}

export function reviewDir(id: string): string {
  if (!/^[A-Za-z0-9_-]{16}$/.test(id)) throw new Error("Invalid review id");
  return path.join(MEDIA_DIR, id);
}

export type Owner = { userId: string | null; anonId: string | null };

export const INSERT_REVIEW = `INSERT INTO app.reviews (id, created_at, updated_at, user_id, anon_id, stage, answers, intent, board, title)
  VALUES ($1, $2, $2, $3, $4, 'uploading', $5::jsonb, $6::jsonb, $7::jsonb, $8)`;

export function insertReviewParams(input: { id: string; answers: Answer[]; intent: IntentFields; board: string[]; title: string } & Owner) {
  return [
    input.id,
    Date.now(),
    input.userId,
    input.anonId,
    JSON.stringify(input.answers),
    JSON.stringify(input.intent),
    JSON.stringify(input.board),
    input.title,
  ];
}

export async function createReview(input: { id: string; answers: Answer[]; intent: IntentFields; board: string[]; title: string } & Partial<Owner>) {
  await q(INSERT_REVIEW, insertReviewParams({ userId: null, anonId: null, ...input }));
}

export async function getReview(id: string): Promise<ReviewRecord | null> {
  const row = await one("SELECT * FROM app.reviews WHERE id = $1", [id]);
  return row ? fromRow(row) : null;
}

/** A review belongs to its account once claimed; before that, to the browser that made it. */
export function canAccess(r: Pick<ReviewRecord, "userId" | "anonId">, viewer: Owner): boolean {
  if (r.userId) return r.userId === viewer.userId;
  return Boolean(r.anonId && r.anonId === viewer.anonId);
}

export type ReviewSummary = Pick<ReviewRecord, "id" | "createdAt" | "stage" | "title" | "board" | "intent">;

export async function listReviewsFor(userId: string): Promise<ReviewSummary[]> {
  const rows = await q("SELECT id, created_at, stage, title, board, intent FROM app.reviews WHERE user_id = $1 ORDER BY created_at DESC", [userId]);
  return rows.map((r) => ({
    id: String(r.id),
    createdAt: Number(r.created_at),
    stage: r.stage as ReviewStage,
    title: (r.title as string) ?? null,
    board: json<string[]>(r.board) ?? [],
    intent: json<IntentFields>(r.intent) ?? {},
  }));
}

/**
 * After sign-in, reviews this browser made while signed out become the account's.
 * Returns the claimed ids so their media can be copied to storage.
 */
export async function claimAnonymous(userId: string, anonId: string): Promise<{ id: string; stage: ReviewStage }[]> {
  return q<{ id: string; stage: ReviewStage }>(
    "UPDATE app.reviews SET user_id = $1, updated_at = $3 WHERE user_id IS NULL AND anon_id = $2 RETURNING id, stage",
    [userId, anonId, Date.now()],
  );
}

const COLUMNS = {
  stage: "stage",
  stageDetail: "stage_detail",
  error: "error",
  video: "video",
  ledger: "ledger",
  notes: "notes",
  discussion: "discussion",
  synthesis: "synthesis",
  validation: "validation",
  cost: "cost",
  storedFiles: "stored_files",
} as const;
const TEXT_COLUMNS = new Set(["stage", "stage_detail", "error"]);

export async function updateReview(id: string, patch: Partial<Pick<ReviewRecord, keyof typeof COLUMNS>>) {
  const sets: string[] = ["updated_at = $1"];
  const vals: unknown[] = [Date.now()];
  for (const [k, col] of Object.entries(COLUMNS)) {
    if (!(k in patch)) continue;
    const v = patch[k as keyof typeof patch];
    vals.push(TEXT_COLUMNS.has(col) ? (v ?? null) : v == null ? null : JSON.stringify(v));
    sets.push(`${col} = $${vals.length}${TEXT_COLUMNS.has(col) ? "" : "::jsonb"}`);
  }
  vals.push(id);
  await q(`UPDATE app.reviews SET ${sets.join(", ")} WHERE id = $${vals.length}`, vals);
}

/** Adds one paid call to the review's running cost in a single statement, so parallel calls never lose one. */
export async function addCost(id: string, call: Cost["calls"][number]) {
  await q(
    `UPDATE app.reviews SET updated_at = $2, cost = jsonb_build_object(
       'usd', COALESCE((cost->>'usd')::float8, 0) + $3::float8,
       'calls', COALESCE(cost->'calls', '[]'::jsonb) || $4::jsonb)
     WHERE id = $1`,
    [id, Date.now(), call.usd, JSON.stringify([call])],
  );
}

/** Remove reviews whose upload never finished (tab closed mid-upload, etc.). Their usage is refunded. */
export async function cleanupAbandonedUploads(olderThanMs = 30 * 60 * 1000): Promise<number> {
  const rows = await q<{ id: string }>("SELECT id FROM app.reviews WHERE stage = 'uploading' AND created_at < $1", [Date.now() - olderThanMs]);
  for (const r of rows) await deleteReview(r.id, { refund: true });
  return rows.length;
}

/**
 * Deletes the review, its local files and its stored media. `refund` gives the
 * person their daily review back (only for uploads that never became a review).
 */
export async function deleteReview(id: string, opts: { refund?: boolean } = {}) {
  const r = await getReview(id);
  await tx(async (t) => {
    if (opts.refund) await t("DELETE FROM app.usage WHERE review_id = $1 AND kind = 'review'", [id]);
    await t("DELETE FROM app.reviews WHERE id = $1", [id]);
  });
  fs.rmSync(reviewDir(id), { recursive: true, force: true });
  if (r?.userId && r.storedFiles.length) {
    const { removeStoredMedia } = await import("./storage");
    await removeStoredMedia(r.userId, id, r.storedFiles).catch((e) => console.error("[storage] remove failed", e));
  }
}
