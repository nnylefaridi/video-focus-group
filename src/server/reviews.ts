import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { db } from "./db";
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
};

type Row = Record<string, unknown>;

const json = <T>(v: unknown): T | null => (v == null ? null : (JSON.parse(String(v)) as T));

function fromRow(r: Row): ReviewRecord {
  return {
    id: String(r.id),
    createdAt: Number(r.created_at),
    updatedAt: Number(r.updated_at),
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
  };
}

export function newReviewId(): string {
  return crypto.randomBytes(12).toString("base64url");
}

export function reviewDir(id: string): string {
  if (!/^[A-Za-z0-9_-]{16}$/.test(id)) throw new Error("Invalid review id");
  return path.join(MEDIA_DIR, id);
}

export function createReview(input: { id: string; answers: Answer[]; intent: IntentFields; board: string[]; title: string }) {
  const now = Date.now();
  db()
    .prepare(
      `INSERT INTO reviews (id, created_at, updated_at, stage, answers, intent, board, title)
       VALUES (?, ?, ?, 'uploading', ?, ?, ?, ?)`,
    )
    .run(input.id, now, now, JSON.stringify(input.answers), JSON.stringify(input.intent), JSON.stringify(input.board), input.title);
}

export function getReview(id: string): ReviewRecord | null {
  const row = db().prepare("SELECT * FROM reviews WHERE id = ?").get(id) as Row | undefined;
  return row ? fromRow(row) : null;
}

export function listReviews(): Pick<ReviewRecord, "id" | "createdAt" | "stage" | "title" | "board" | "intent">[] {
  const rows = db().prepare("SELECT id, created_at, stage, title, board, intent FROM reviews ORDER BY created_at DESC").all() as Row[];
  return rows.map((r) => ({
    id: String(r.id),
    createdAt: Number(r.created_at),
    stage: r.stage as ReviewStage,
    title: (r.title as string) ?? null,
    board: json<string[]>(r.board) ?? [],
    intent: json<IntentFields>(r.intent) ?? {},
  }));
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
} as const;

export function updateReview(id: string, patch: Partial<Pick<ReviewRecord, keyof typeof COLUMNS>>) {
  const sets: string[] = ["updated_at = ?"];
  const vals: unknown[] = [Date.now()];
  for (const [k, col] of Object.entries(COLUMNS)) {
    if (!(k in patch)) continue;
    const v = patch[k as keyof typeof patch];
    sets.push(`${col} = ?`);
    vals.push(v === null || typeof v === "string" ? v : JSON.stringify(v));
  }
  db().prepare(`UPDATE reviews SET ${sets.join(", ")} WHERE id = ?`).run(...vals, id);
}

export function addCost(id: string, call: Cost["calls"][number]) {
  const tx = db().transaction(() => {
    const r = getReview(id);
    if (!r) return;
    const cost: Cost = { usd: r.cost.usd + call.usd, calls: [...r.cost.calls, call] };
    updateReview(id, { cost });
  });
  tx();
}

/** Remove reviews whose upload never finished (tab closed mid-upload, etc.). */
export function cleanupAbandonedUploads(olderThanMs = 30 * 60 * 1000): number {
  const rows = db()
    .prepare("SELECT id FROM reviews WHERE stage = 'uploading' AND created_at < ?")
    .all(Date.now() - olderThanMs) as { id: string }[];
  rows.forEach((r) => deleteReview(r.id));
  return rows.length;
}

export function deleteReview(id: string) {
  db().prepare("DELETE FROM reviews WHERE id = ?").run(id);
  fs.rmSync(reviewDir(id), { recursive: true, force: true });
}
