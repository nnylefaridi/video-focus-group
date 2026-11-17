-- The in-process runner (src/server/runner.ts) replaces the separate worker.
-- Additive only: nothing is dropped or renamed, and every statement is safe to run twice.

-- A job is claimed with a lease. While its runner is alive it keeps pushing lease_until
-- forward; if the process dies (or the host restarts), the lease runs out and any other
-- process (or the same one after it boots) picks the job up again.
alter table app.jobs add column if not exists lease_until bigint;
alter table app.jobs add column if not exists lease_owner text;
create index if not exists jobs_lease on app.jobs (status, lease_until);

-- Work in progress that a restart shouldn't repeat (for example, perception batches already paid for).
-- Cleared by the code once the stage it belongs to is saved for good.
alter table app.reviews add column if not exists draft jsonb;

-- A follow-up answer being written ('streaming') is told apart from a finished one ('done'),
-- so an answer cut short by a restart is never shown as if it were final.
alter table app.followups add column if not exists status text not null default 'done';
alter table app.followups add column if not exists updated_at bigint;
