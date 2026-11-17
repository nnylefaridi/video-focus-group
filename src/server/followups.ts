import { q } from "./db";

/**
 * A question's answer can stop before it's written: the reviewer's call fails, or the server
 * restarts or sleeps mid-answer (a free host can do either at any time). The question then says
 * so ("failed"), so the thread never shows a question waiting forever, and it's left out of what
 * the reviewer is shown next time, so a later question is answered on its own.
 */
export type QuestionState = "answering" | "failed";
export type FollowupMessage = { id: number; role: "user" | "assistant"; text: string; createdAt: number; state?: QuestionState };

/**
 * No answer takes this long (it's at most four short reviewer turns), so a question still
 * "answering" after it was left by a process that stopped. Its credit is settled at the same age.
 */
export const ANSWER_STALE_MS = 15 * 60 * 1000;

/** app.followups.status (migration 0009): "done" for answers and answered questions, else the question's state. */
type Row = { id: string; role: "user" | "assistant"; content: string; created_at: string; status: string };

function toMessage(r: Row, now: number): FollowupMessage {
  const createdAt = Number(r.created_at);
  const raw = r.status === "answering" || r.status === "failed" ? r.status : undefined;
  const state = raw === "answering" && now - createdAt > ANSWER_STALE_MS ? "failed" : raw;
  return { id: Number(r.id), role: r.role, text: (JSON.parse(r.content) as { text: string }).text, createdAt, ...(state ? { state } : {}) };
}

export async function getThread(reviewId: string, reviewerId: string, now = Date.now()): Promise<FollowupMessage[]> {
  const rows = await q<Row>("SELECT id, role, content, created_at, status FROM app.followups WHERE review_id = $1 AND reviewer_id = $2 ORDER BY id", [reviewId, reviewerId]);
  return rows.map((r) => toMessage(r, now));
}

/** The conversation as the reviewer sees it: answered questions and their answers only. */
export function answeredOnly(thread: FollowupMessage[]): FollowupMessage[] {
  return thread.filter((m) => m.role === "assistant" || !m.state);
}

/** Saves a message. A question starts as "answering"; returns its id. */
export async function addMessage(reviewId: string, reviewerId: string, role: "user" | "assistant", text: string): Promise<number> {
  const now = Date.now();
  const [row] = await q<{ id: string }>(
    "INSERT INTO app.followups (review_id, reviewer_id, role, content, created_at, status, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $5) RETURNING id",
    [reviewId, reviewerId, role, JSON.stringify({ text }), now, role === "user" ? "answering" : "done"],
  );
  return Number(row.id);
}

/** The question was answered ("done") or wasn't ("failed"). */
export async function settleQuestion(id: number, answered: boolean): Promise<void> {
  await q("UPDATE app.followups SET status = $2, updated_at = $3 WHERE id = $1 AND role = 'user'", [id, answered ? "done" : "failed", Date.now()]);
}

/** Questions still "answering" after ANSWER_STALE_MS were left by a stopped process: marks them failed. */
export async function failHangingQuestions(olderThanMs = ANSWER_STALE_MS, now = Date.now()): Promise<number> {
  const rows = await q<{ id: string }>(
    "UPDATE app.followups SET status = 'failed', updated_at = $2 WHERE role = 'user' AND status = 'answering' AND created_at < $1 RETURNING id",
    [now - olderThanMs, now],
  );
  return rows.length;
}
