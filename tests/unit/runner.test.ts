/**
 * The in-process review runner (src/server/runner.ts) and its job queue (src/server/jobs.ts),
 * against a real in-process Postgres. What a job does is replaced by a test double, so nothing
 * here touches ffmpeg, Anthropic or Supabase. Covers the lease (one claimer at a time, a dead
 * runner's job is taken over, heartbeats extend it, shutdown lets go), the concurrency cap,
 * retry policy, and the opportunistic cleanup.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "panel-runner-"));

let jobs: typeof import("@/server/jobs");
let runnerMod: typeof import("@/server/runner");
let reviews: typeof import("@/server/reviews");
let db: typeof import("@/server/db");

beforeAll(async () => {
  jobs = await import("@/server/jobs");
  runnerMod = await import("@/server/runner");
  reviews = await import("@/server/reviews");
  db = await import("@/server/db");
});

beforeEach(async () => {
  await db.q("DELETE FROM app.jobs");
});

async function newJob(kind: "process" | "store" = "process") {
  const reviewId = reviews.newReviewId();
  await reviews.createReview({ id: reviewId, answers: [], intent: { category: "creator" }, board: ["mrbeast"], title: "t" });
  const jobId = await jobs.enqueue(reviewId, kind, { name: "x.mp4" });
  return { reviewId, jobId };
}

const deferred = () => {
  let resolve!: () => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<void>((res, rej) => ((resolve = res), (reject = rej)));
  return { promise, resolve, reject };
};

const lease = (id: number) => db.one<{ status: string; lease_owner: string | null; lease_until: string | null; attempts: number }>("SELECT status, lease_owner, lease_until, attempts FROM app.jobs WHERE id = $1", [id]);

function makeRunner(opts: import("@/server/runner").RunnerOptions = {}) {
  return new runnerMod.Runner({ retryDelayMs: () => 0, maintain: async () => {}, ...opts });
}

describe("claiming with a lease", () => {
  it("takes the oldest waiting job and marks it as the claimer's, for the lease's length", async () => {
    const a = await newJob();
    const b = await newJob();
    const job = await jobs.claimNext("me", 120_000, 1_000_000);
    expect(job).toMatchObject({ id: a.jobId, reviewId: a.reviewId, kind: "process", attempts: 1, payload: { name: "x.mp4" } });
    expect(await lease(a.jobId)).toMatchObject({ status: "running", lease_owner: "me", attempts: 1 });
    expect(Number((await lease(a.jobId))!.lease_until)).toBe(1_120_000);
    // The next claim gets the other job, not the first again.
    expect((await jobs.claimNext("me", 120_000, 1_000_001))?.id).toBe(b.jobId);
    expect(await jobs.claimNext("me", 120_000, 1_000_002)).toBeNull();
  });

  it("won't give a second claimer a job whose lease is live, but will once it has run out", async () => {
    const { jobId } = await newJob();
    await jobs.claimNext("first", 120_000, 1_000_000);
    expect(await jobs.claimNext("second", 120_000, 1_100_000)).toBeNull();
    expect(await jobs.hasClaimableWork(1_100_000)).toBe(false);
    // Its runner went quiet (the host slept or restarted): after the lease, the job is up for grabs.
    expect(await jobs.hasClaimableWork(1_120_001)).toBe(true);
    const taken = await jobs.claimNext("second", 120_000, 1_120_001);
    expect(taken).toMatchObject({ id: jobId, attempts: 2 });
    expect((await lease(jobId))!.lease_owner).toBe("second");
  });

  it("lets two claimers racing for one job produce exactly one winner", async () => {
    await newJob();
    const results = await Promise.all([jobs.claimNext("a", 120_000), jobs.claimNext("b", 120_000), jobs.claimNext("c", 120_000)]);
    expect(results.filter(Boolean)).toHaveLength(1);
  });

  it("picks up a job left 'running' with no lease by the old worker", async () => {
    const { jobId } = await newJob();
    await db.q("UPDATE app.jobs SET status = 'running', started_at = 5 WHERE id = $1", [jobId]);
    expect((await jobs.claimNext("me", 120_000))?.id).toBe(jobId);
  });

  it("extends the lease on a heartbeat, but only for its owner", async () => {
    const { jobId } = await newJob();
    await jobs.claimNext("me", 120_000, 1_000_000);
    expect(await jobs.heartbeat(jobId, "me", 120_000, 1_090_000)).toBe(true);
    expect(Number((await lease(jobId))!.lease_until)).toBe(1_210_000);
    expect(await jobs.heartbeat(jobId, "someone-else", 120_000, 1_090_000)).toBe(false);
    // So a second claimer still can't take it at what would have been the old expiry.
    expect(await jobs.claimNext("other", 120_000, 1_150_000)).toBeNull();
  });

  it("lets go of its jobs on shutdown so the next process takes them at once", async () => {
    const { jobId } = await newJob();
    await jobs.claimNext("me", 120_000);
    expect(await jobs.claimNext("next", 120_000)).toBeNull();
    expect(await jobs.releaseJobs("someone-else")).toBe(0);
    expect(await jobs.releaseJobs("me")).toBe(1);
    expect(Number((await lease(jobId))!.lease_until)).toBe(0);
    expect((await jobs.claimNext("next", 120_000))?.id).toBe(jobId);
  });

  it("clears the lease when a job finishes or goes back in the queue", async () => {
    const a = await newJob();
    const b = await newJob();
    await jobs.claimNext("me", 120_000);
    await jobs.claimNext("me", 120_000);
    await jobs.finishJob(a.jobId);
    await jobs.retryJob(b.jobId, "boom");
    expect(await lease(a.jobId)).toMatchObject({ status: "done", lease_owner: null, lease_until: null });
    expect(await lease(b.jobId)).toMatchObject({ status: "pending", lease_owner: null, lease_until: null });
  });
});

describe("running jobs", () => {
  it("runs a kicked job, finishes it, and says whether it's running meanwhile", async () => {
    const { reviewId, jobId } = await newJob();
    const gate = deferred();
    const seen: string[] = [];
    const runner = makeRunner({
      work: async (job) => {
        seen.push(job.reviewId);
        await gate.promise;
      },
    });
    expect(runner.isRunning(reviewId)).toBe(false);
    await runner.kick();
    // kick() returns once the run has started; it doesn't wait for it.
    expect(runner.isRunning(reviewId)).toBe(true);
    expect(await lease(jobId)).toMatchObject({ status: "running", lease_owner: runner.owner });
    gate.resolve();
    await runner.idle();
    expect(seen).toEqual([reviewId]);
    expect(runner.isRunning(reviewId)).toBe(false);
    expect(await lease(jobId)).toMatchObject({ status: "done", lease_owner: null });
  });

  it("runs at most two jobs at once and starts the rest as slots free up", async () => {
    const all = [await newJob(), await newJob(), await newJob()];
    const gates = all.map(() => deferred());
    const started: string[] = [];
    const runner = makeRunner({
      work: async (job) => {
        started.push(job.reviewId);
        await gates[all.findIndex((j) => j.reviewId === job.reviewId)].promise;
      },
    });
    // Several kicks at once (an upload, a poll and a health check landing together) can't pass the limit.
    await Promise.all([runner.kick(), runner.kick(), runner.kick(), runner.kick()]);
    expect(started).toEqual([all[0].reviewId, all[1].reviewId]);
    expect(runner.activeCount).toBe(2);
    expect((await lease(all[2].jobId))!.status).toBe("pending");
    gates[0].resolve();
    await vi.waitFor(() => expect(started).toHaveLength(3));
    expect(started[2]).toBe(all[2].reviewId);
    gates[1].resolve();
    gates[2].resolve();
    await runner.idle();
    for (const j of all) expect((await lease(j.jobId))!.status).toBe("done");
  });

  it("keeps the lease alive with a heartbeat while a job runs long", async () => {
    const { jobId } = await newJob();
    const gate = deferred();
    const runner = makeRunner({ leaseMs: 1000, heartbeatMs: 20, work: () => gate.promise });
    await runner.kick();
    const first = Number((await lease(jobId))!.lease_until);
    await vi.waitFor(async () => expect(Number((await lease(jobId))!.lease_until)).toBeGreaterThan(first), { timeout: 2000 });
    gate.resolve();
    await runner.idle();
  });

  it("picks up a job whose runner died, and resumes it as another attempt", async () => {
    const { jobId } = await newJob();
    // A previous process claimed it long ago and never finished.
    await jobs.claimNext("dead-process", 120_000, Date.now() - 10 * 60_000);
    const attempts: number[] = [];
    const runner = makeRunner({ work: async (job) => void attempts.push(job.attempts) });
    await runner.resumeOnBoot();
    await runner.idle();
    expect(attempts).toEqual([2]);
    expect((await lease(jobId))!.status).toBe("done");
  });

  it("leaves a job another live process is running alone", async () => {
    const { jobId } = await newJob();
    await jobs.claimNext("other-process", 120_000);
    const work = vi.fn(async () => {});
    const runner = makeRunner({ work });
    await runner.kick();
    await runner.idle();
    expect(work).not.toHaveBeenCalled();
    expect((await lease(jobId))!.lease_owner).toBe("other-process");
  });

  it("stops claiming on shutdown and hands its running jobs back", async () => {
    const running = await newJob();
    const waiting = await newJob();
    const gate = deferred();
    const runner = makeRunner({ maxConcurrent: 1, work: () => gate.promise });
    await runner.kick();
    await runner.stop();
    expect(Number((await lease(running.jobId))!.lease_until)).toBe(0);
    await runner.kick();
    expect((await lease(waiting.jobId))!.status).toBe("pending");
    // Another process takes over the one that was running.
    expect((await jobs.claimNext("next", 120_000))?.id).toBe(running.jobId);
    gate.resolve();
    await runner.idle();
  });
});

describe("when a job fails", () => {
  it("sends trouble reaching a service back to the queue, up to 4 attempts in all, then fails the review", async () => {
    const { reviewId, jobId } = await newJob();
    const tries: number[] = [];
    const gaveUp: string[] = [];
    const runner = makeRunner({
      work: async (job) => {
        tries.push(job.attempts);
        throw new Error("connect ECONNRESET 10.0.0.1:5432");
      },
      onGiveUp: async (job) => void gaveUp.push(job.reviewId),
    });
    await runner.kick();
    await runner.idle();
    expect(tries).toEqual([1, 2, 3, 4]);
    expect(gaveUp).toEqual([reviewId]);
    expect(await lease(jobId)).toMatchObject({ status: "failed", attempts: 4 });
  });

  it("recovers when a retry works", async () => {
    const { jobId } = await newJob();
    const gaveUp = vi.fn(async () => {});
    let calls = 0;
    const runner = makeRunner({
      work: async () => {
        if (++calls < 3) throw Object.assign(new Error("fetch failed"), { code: "ECONNRESET" });
      },
      onGiveUp: gaveUp,
    });
    await runner.kick();
    await runner.idle();
    expect(calls).toBe(3);
    expect(gaveUp).not.toHaveBeenCalled();
    expect((await lease(jobId))!.status).toBe("done");
  });

  it("fails at once for anything that isn't trouble reaching a service, and tells the person why", async () => {
    const { reviewId, jobId } = await newJob();
    const runner = makeRunner({
      work: async () => {
        throw new Error("That video has no picture.");
      },
    });
    await runner.kick();
    await runner.idle();
    expect(await lease(jobId)).toMatchObject({ status: "failed", attempts: 1 });
    const review = (await reviews.getReview(reviewId))!;
    expect(review.stage).toBe("failed");
    expect(review.error).toBe("That video has no picture.");
  });

  it("says an overloaded AI service is busy, in plain words", async () => {
    const { reviewId } = await newJob();
    const runner = makeRunner({
      work: async () => {
        throw new Error("529 overloaded_error");
      },
    });
    await runner.kick();
    await runner.idle();
    expect((await reviews.getReview(reviewId))!.error).toBe("The AI service is busy right now. Try again in a minute.");
  });

  it("retries copying media to storage a few times, and never fails the review over it", async () => {
    const { reviewId, jobId } = await newJob("store");
    await reviews.updateReview(reviewId, { stage: "done" });
    const runner = makeRunner({
      work: async () => {
        throw new Error("storage said no");
      },
    });
    await runner.kick();
    await runner.idle();
    expect(await lease(jobId)).toMatchObject({ status: "failed", attempts: 4 });
    expect((await reviews.getReview(reviewId))!.stage).toBe("done");
  });

  it("tells transient trouble apart from the rest", () => {
    const { isTransient } = runnerMod;
    for (const e of [new Error("connect ECONNREFUSED 127.0.0.1:5432"), new Error("fetch failed"), Object.assign(new Error("x"), { code: "ETIMEDOUT" }), new Error("Connection terminated unexpectedly")])
      expect(isTransient(e)).toBe(true);
    for (const e of [new Error("That video has no picture."), new Error("overloaded"), "plain text"]) expect(isTransient(e)).toBe(false);
  });
});

describe("cleanup that rides along with kicks", () => {
  it("runs at most once every 10 minutes per process", async () => {
    let t = 1_000_000;
    const maintain = vi.fn(async () => {});
    const runner = makeRunner({ maintain, now: () => t });
    await runner.kick();
    await runner.kick();
    t += 9 * 60_000;
    await runner.kick();
    expect(maintain).toHaveBeenCalledTimes(1);
    t += 61_000;
    await runner.kick();
    expect(maintain).toHaveBeenCalledTimes(2);
  });

  it("removes uploads left unfinished (the default cleanup), sparing fresh ones", async () => {
    const stale = reviews.newReviewId();
    const fresh = reviews.newReviewId();
    for (const id of [stale, fresh]) await reviews.createReview({ id, answers: [], intent: { category: "creator" }, board: ["mrbeast"], title: "t" });
    await db.q("UPDATE app.reviews SET created_at = $1 WHERE id = $2", [Date.now() - 2 * 3600_000, stale]);
    const runner = new runnerMod.Runner({ retryDelayMs: () => 0 });
    await runner.kick();
    await vi.waitFor(async () => expect(await reviews.getReview(stale)).toBeNull());
    expect(await reviews.getReview(fresh)).not.toBeNull();
  });
});

describe("the shared runner", () => {
  it("is one per process", () => {
    expect(runnerMod.getRunner()).toBe(runnerMod.getRunner());
  });
});
