import { one, q } from "./db";

export type JobKind = "process" | "inspect" | "store";
export type Job = { id: number; reviewId: string; kind: JobKind; payload: Record<string, unknown>; attempts: number };

export async function enqueue(reviewId: string, kind: JobKind, payload: Record<string, unknown> = {}): Promise<number> {
  const row = await one<{ id: string }>(
    "INSERT INTO app.jobs (review_id, kind, payload, created_at) VALUES ($1, $2, $3::jsonb, $4) RETURNING id",
    [reviewId, kind, JSON.stringify(payload), Date.now()],
  );
  return Number(row!.id);
}

/** Atomically claim the oldest pending job (safe with several workers). */
export async function claimNext(): Promise<Job | null> {
  const row = await one(
    `UPDATE app.jobs SET status = 'running', attempts = attempts + 1, started_at = $1
     WHERE id = (SELECT id FROM app.jobs WHERE status = 'pending' ORDER BY id LIMIT 1 FOR UPDATE SKIP LOCKED)
     RETURNING *`,
    [Date.now()],
  );
  if (!row) return null;
  return {
    id: Number(row.id),
    reviewId: String(row.review_id),
    kind: row.kind as JobKind,
    payload: (typeof row.payload === "string" ? JSON.parse(row.payload) : row.payload) as Record<string, unknown>,
    attempts: Number(row.attempts),
  };
}

export async function finishJob(id: number, error?: string) {
  await q("UPDATE app.jobs SET status = $1, error = $2, finished_at = $3 WHERE id = $4", [error ? "failed" : "done", error ?? null, Date.now(), id]);
}

export async function jobStatus(id: number): Promise<{ status: string; error: string | null } | null> {
  return one<{ status: string; error: string | null }>("SELECT status, error FROM app.jobs WHERE id = $1", [id]);
}

/** Puts a job back in the queue to be tried again. */
export async function retryJob(id: number, error: string) {
  await q("UPDATE app.jobs SET status = 'pending', error = $1 WHERE id = $2", [error, id]);
}

/** Jobs left 'running' by a crashed worker go back to pending on startup. */
export async function requeueStale() {
  await q("UPDATE app.jobs SET status = 'pending' WHERE status = 'running'");
}
