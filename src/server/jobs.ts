import { db } from "./db";

export type JobKind = "process" | "inspect";
export type Job = { id: number; reviewId: string; kind: JobKind; payload: Record<string, unknown>; attempts: number };

export function enqueue(reviewId: string, kind: JobKind, payload: Record<string, unknown> = {}): number {
  const info = db()
    .prepare("INSERT INTO jobs (review_id, kind, payload, created_at) VALUES (?, ?, ?, ?)")
    .run(reviewId, kind, JSON.stringify(payload), Date.now());
  return Number(info.lastInsertRowid);
}

/** Atomically claim the oldest pending job. */
export function claimNext(): Job | null {
  const tx = db().transaction(() => {
    const row = db().prepare("SELECT * FROM jobs WHERE status = 'pending' ORDER BY id LIMIT 1").get() as
      | Record<string, unknown>
      | undefined;
    if (!row) return null;
    db()
      .prepare("UPDATE jobs SET status = 'running', attempts = attempts + 1, started_at = ? WHERE id = ?")
      .run(Date.now(), row.id);
    return {
      id: Number(row.id),
      reviewId: String(row.review_id),
      kind: row.kind as JobKind,
      payload: JSON.parse(String(row.payload)),
      attempts: Number(row.attempts) + 1,
    };
  });
  return tx();
}

export function finishJob(id: number, error?: string) {
  db()
    .prepare("UPDATE jobs SET status = ?, error = ?, finished_at = ? WHERE id = ?")
    .run(error ? "failed" : "done", error ?? null, Date.now(), id);
}

export function jobStatus(id: number): { status: string; error: string | null } | null {
  const row = db().prepare("SELECT status, error FROM jobs WHERE id = ?").get(id) as
    | { status: string; error: string | null }
    | undefined;
  return row ?? null;
}

/** Jobs left 'running' by a crashed worker go back to pending on startup. */
export function requeueStale() {
  db().prepare("UPDATE jobs SET status = 'pending' WHERE status = 'running'").run();
}
