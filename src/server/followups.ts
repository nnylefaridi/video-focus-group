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

type Row = { id: string; role: "user" | "assistant"; content: string; created_at: string };

function toMessage(r: Row, now: number): FollowupMessage {
  const c = JSON.parse(r.content) as { text: string; state?: QuestionState };
  const createdAt = Number(r.created_at);
  const state = c.state === "answering" && now - createdAt > ANSWER_STALE_MS ? "failed" : c.state;
  return { id: Number(r.id), role: r.role, text: c.text, createdAt, ...(state ? { state } : {}) };
}

export async function getThread(reviewId: string, reviewerId: string, now = Date.now()): Promise<FollowupMessage[]> {
  const rows = await q<Row>("SELECT id, role, content, created_at FROM app.followups WHERE review_id = $1 AND reviewer_id = $2 ORDER BY id", [reviewId, reviewerId]);
  return rows.map((r) => toMessage(r, now));
}

/** The conversation as the reviewer sees it: answered questions and their answers only. */
export function answeredOnly(thread: FollowupMessage[]): FollowupMessage[] {
  return thread.filter((m) => m.role === "assistant" || !m.state);
}

/** Saves a message. A question starts as "answering"; returns its id. */
export async function addMessage(reviewId: string, reviewerId: string, role: "user" | "assistant", text: string): Promise<number> {
  const content = role === "user" ? { text, state: "answering" } : { text };
  const [row] = await q<{ id: string }>("INSERT INTO app.followups (review_id, reviewer_id, role, content, created_at) VALUES ($1, $2, $3, $4, $5) RETURNING id", [
    reviewId,
    reviewerId,
    role,
    JSON.stringify(content),
    Date.now(),
  ]);
  return Number(row.id);
}

/** The question was answered (state cleared) or wasn't ("failed"). */
export async function settleQuestion(id: number, answered: boolean): Promise<void> {
  const [row] = await q<{ content: string }>("SELECT content FROM app.followups WHERE id = $1 AND role = 'user'", [id]);
  if (!row) return;
  const { text } = JSON.parse(row.content) as { text: string };
  await q("UPDATE app.followups SET content = $2 WHERE id = $1", [id, JSON.stringify(answered ? { text } : { text, state: "failed" })]);
}

/** Questions still "answering" after ANSWER_STALE_MS were left by a stopped process: marks them failed. */
export async function failHangingQuestions(olderThanMs = ANSWER_STALE_MS, now = Date.now()): Promise<number> {
  const rows = await q<{ id: string }>(
    `SELECT id FROM app.followups WHERE role = 'user' AND created_at < $1 AND content LIKE '%"state":"answering"%'`,
    [now - olderThanMs],
  );
  for (const r of rows) await settleQuestion(Number(r.id), false);
  return rows.length;
}
