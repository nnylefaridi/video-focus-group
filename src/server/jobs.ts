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

/**
 * Atomically claims the oldest job that needs running: one that's pending, or one marked
 * running whose lease has run out (its runner died or the host restarted). The claim is
 * good until `leaseMs` from now; the owner extends it with `heartbeat`. Safe with any
 * number of processes: a job another process holds a live lease on is skipped.
 */
export async function claimNext(owner: string, leaseMs: number, now = Date.now()): Promise<Job | null> {
  const row = await one(
    `UPDATE app.jobs SET status = 'running', attempts = attempts + 1, started_at = COALESCE(started_at, $1), lease_owner = $2, lease_until = $1 + $3::bigint
     WHERE id = (SELECT id FROM app.jobs WHERE status = 'pending' OR (status = 'running' AND (lease_until IS NULL OR lease_until < $1)) ORDER BY id LIMIT 1 FOR UPDATE SKIP LOCKED)
     RETURNING *`,
    [now, owner, leaseMs],
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

/** Pushes the lease forward. False means it's no longer this owner's (it ran out and someone else took it). */
export async function heartbeat(id: number, owner: string, leaseMs: number, now = Date.now()): Promise<boolean> {
  const row = await one("UPDATE app.jobs SET lease_until = $3::bigint + $4::bigint WHERE id = $1 AND lease_owner = $2 AND status = 'running' RETURNING id", [id, owner, now, leaseMs]);
  return row !== null;
}

/** True when some job is waiting to run or its runner has gone quiet. A cheap read, no claiming. */
export async function hasClaimableWork(now = Date.now()): Promise<boolean> {
  return (await one("SELECT 1 AS x FROM app.jobs WHERE status = 'pending' OR (status = 'running' AND (lease_until IS NULL OR lease_until < $1)) LIMIT 1", [now])) !== null;
}

export async function finishJob(id: number, error?: string) {
  await q("UPDATE app.jobs SET status = $1, error = $2, finished_at = $3, lease_until = NULL, lease_owner = NULL WHERE id = $4", [error ? "failed" : "done", error ?? null, Date.now(), id]);
}

export async function jobStatus(id: number): Promise<{ status: string; error: string | null } | null> {
  return one<{ status: string; error: string | null }>("SELECT status, error FROM app.jobs WHERE id = $1", [id]);
}

/** Puts a job back in the queue to be tried again. */
export async function retryJob(id: number, error: string) {
  await q("UPDATE app.jobs SET status = 'pending', error = $1, lease_until = NULL, lease_owner = NULL WHERE id = $2", [error, id]);
}

/**
 * On shutdown: lets go of the jobs this owner holds, so the next process takes them
 * straight away instead of waiting for the lease to run out.
 */
export async function releaseJobs(owner: string): Promise<number> {
  const rows = await q("UPDATE app.jobs SET lease_until = 0 WHERE lease_owner = $1 AND status = 'running' RETURNING id", [owner]);
  return rows.length;
}
