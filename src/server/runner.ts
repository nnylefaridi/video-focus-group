import crypto from "node:crypto";
import { AiUnavailable, BudgetExceeded, checkReviewKey } from "@/ai/client";
import { isHosted } from "./config";
import { NotEnoughCredits, settleStaleFollowups } from "./credits";
import { failHangingQuestions } from "./followups";
import { verifyUpload } from "./intake";
import { claimNext, finishJob, heartbeat, releaseJobs, retryJob, type Job } from "./jobs";
import { runReview } from "./process";
import { cleanupAbandonedUploads, getReview, updateReview } from "./reviews";
import { storeReviewMedia } from "./storage";

/**
 * Makes the reviews. It runs inside the website's own process (there's no separate worker):
 * uploads, retries, page polls and the host's health check all "kick" it, and it claims jobs
 * from Postgres with a lease, so a process that dies or sleeps mid-review hands the job to
 * whichever process wakes next. See docs/plan-browser-processing.md, section 5.
 */

/** How many reviews one process runs at once, to keep memory bounded on a small host. */
export const MAX_CONCURRENT = 2;
/** A claim is good for this long unless its runner keeps extending it. */
export const LEASE_MS = 120_000;
export const HEARTBEAT_MS = 30_000;
/** Network trouble is retried this many times in all (first try included), then the review fails. */
export const MAX_ATTEMPTS = 4;
export const MAINTENANCE_EVERY_MS = 10 * 60 * 1000;

export type Work = (job: Job) => Promise<void>;

export type RunnerOptions = {
  owner?: string;
  maxConcurrent?: number;
  leaseMs?: number;
  heartbeatMs?: number;
  maintenanceEveryMs?: number;
  /** What a job does. Tests pass their own; the default is processJob. */
  work?: Work;
  /** Abandoned-upload and stale follow-up cleanup. Tests pass their own. */
  maintain?: () => Promise<void>;
  /** A review whose job gave up: tell the person why. */
  onGiveUp?: (job: Job, error: unknown) => Promise<void>;
  retryDelayMs?: (attempt: number) => number;
  now?: () => number;
};

/** Words for what went wrong, for the person waiting on the review. */
export function friendly(e: unknown): string {
  if (e instanceof AiUnavailable || e instanceof BudgetExceeded || e instanceof NotEnoughCredits) return e.message;
  const msg = e instanceof Error ? e.message : String(e);
  if (/overloaded|529|rate.?limit|429/i.test(msg)) return "The AI service is busy right now. Try again in a minute.";
  return msg.length > 300 ? `${msg.slice(0, 300)}…` : msg;
}

/** Trouble reaching a service (Postgres, storage, Anthropic), as opposed to something wrong with the review itself. */
export function isTransient(e: unknown): boolean {
  if (e instanceof AiUnavailable || e instanceof BudgetExceeded || e instanceof NotEnoughCredits) return false;
  const code = (e as { code?: unknown } | null)?.code;
  const text = `${typeof code === "string" ? code : ""} ${e instanceof Error ? `${e.message} ${String((e as { cause?: unknown }).cause ?? "")}` : String(e)}`;
  return /ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|ENOTFOUND|EPIPE|UND_ERR|CONNECT_TIMEOUT|fetch failed|socket hang up|connection terminated|Connection terminated|network/i.test(text);
}

/** What one job does: the review's whole run, or copying its media to storage. */
export async function processJob(job: Job): Promise<void> {
  if (job.kind === "store") return storeReviewMedia(job.reviewId);
  if (job.kind !== "process") throw new Error(`Don't know how to run a "${job.kind}" job.`);
  // Hosted mode never runs a paid review for someone who isn't signed in (the website refuses
  // to make one; this also covers reviews left from before the switch to hosted mode).
  if (isHosted() && !(await getReview(job.reviewId))?.userId) throw new Error("Log in to run this review.");
  // The browser prepared the files and sent them; check them first. Files that fail end the
  // review with its reason, and nothing paid runs.
  if ((await verifyUpload(job.reviewId)) === "rejected") return;
  // A review on its owner's own key needs that key saved and usable now; each paid call looks it up again.
  await checkReviewKey(job.reviewId);
  await runReview(job.reviewId);
}

async function giveUp(job: Job, error: unknown) {
  if (job.kind === "process") await updateReview(job.reviewId, { stage: "failed", error: friendly(error) });
}

async function defaultMaintain() {
  const n = await cleanupAbandonedUploads().catch((e) => (console.error("[runner] cleaning up abandoned uploads failed:", e), 0));
  if (n) console.log(`[runner] removed ${n} abandoned upload(s)`);
  const f = await settleStaleFollowups().catch((e) => (console.error("[runner] settling old follow-up credit failed:", e), 0));
  if (f) console.log(`[runner] settled ${f} follow-up answer(s) that never finished`);
  const h = await failHangingQuestions().catch((e) => (console.error("[runner] marking unanswered follow-up questions failed:", e), 0));
  if (h) console.log(`[runner] marked ${h} follow-up question(s) left unanswered by a stopped server as failed`);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class Runner {
  readonly owner: string;
  private readonly max: number;
  private readonly leaseMs: number;
  private readonly heartbeatMs: number;
  private readonly maintenanceEveryMs: number;
  private readonly work: Work;
  private readonly maintain: () => Promise<void>;
  private readonly onGiveUp: (job: Job, error: unknown) => Promise<void>;
  private readonly retryDelayMs: (attempt: number) => number;
  private readonly now: () => number;
  /** Slots in use, counted before the claim query returns so two kicks at once can't pass the limit. */
  private active = 0;
  /** Kicks still looking for work, so `idle` doesn't return between one job ending and the next being claimed. */
  private kicks = 0;
  private readonly running = new Map<number, { reviewId: string; done: Promise<void> }>();
  private stopping = false;
  private lastMaintenance = 0;
  private lastWarning = 0;

  constructor(opts: RunnerOptions = {}) {
    this.owner = opts.owner ?? crypto.randomBytes(8).toString("hex");
    this.max = opts.maxConcurrent ?? MAX_CONCURRENT;
    this.leaseMs = opts.leaseMs ?? LEASE_MS;
    this.heartbeatMs = opts.heartbeatMs ?? HEARTBEAT_MS;
    this.maintenanceEveryMs = opts.maintenanceEveryMs ?? MAINTENANCE_EVERY_MS;
    this.work = opts.work ?? processJob;
    this.maintain = opts.maintain ?? defaultMaintain;
    this.onGiveUp = opts.onGiveUp ?? giveUp;
    this.retryDelayMs = opts.retryDelayMs ?? ((attempt) => Math.min(30_000, 2000 * 2 ** (attempt - 1)));
    this.now = opts.now ?? Date.now;
  }

  /** Whether this process is running a job for the review right now. */
  isRunning(reviewId: string): boolean {
    for (const j of this.running.values()) if (j.reviewId === reviewId) return true;
    return false;
  }

  get activeCount(): number {
    return this.running.size;
  }

  /**
   * Claims waiting jobs up to the concurrency limit and starts them. Returns as soon as they
   * are started (each run is detached), and never throws: trouble reaching the database is
   * logged (at most once a minute) and the next kick tries again.
   */
  async kick(): Promise<void> {
    this.kicks++;
    try {
      await this.claimAndStart();
    } finally {
      this.kicks--;
    }
  }

  private async claimAndStart(): Promise<void> {
    if (this.stopping) return;
    this.maintainSoon();
    try {
      while (!this.stopping && this.active < this.max) {
        this.active++;
        let job: Job | null;
        try {
          job = await claimNext(this.owner, this.leaseMs, this.now());
        } catch (e) {
          this.active--;
          throw e;
        }
        if (!job) {
          this.active--;
          break;
        }
        if (this.stopping) {
          // Shutting down between the claim and the start: give it straight back.
          this.active--;
          await retryJob(job.id, "Runner stopped before it started.").catch(() => {});
          break;
        }
        this.start(job);
      }
    } catch (e) {
      this.warn("can't reach the database", e);
    }
  }

  /** Called when the server boots: picks up anything a previous process left unfinished. */
  resumeOnBoot(): Promise<void> {
    return this.kick();
  }

  /** Resolves when nothing is running (and nothing more was claimed meanwhile). For tests and scripts. */
  async idle(): Promise<void> {
    while (this.running.size || this.kicks) {
      if (this.running.size) await Promise.allSettled([...this.running.values()].map((j) => j.done));
      else await sleep(5);
    }
  }

  /** Stops claiming and lets go of the jobs it holds so the next process resumes them at once. */
  async stop(): Promise<void> {
    this.stopping = true;
    await releaseJobs(this.owner).catch((e) => console.error("[runner] letting go of running jobs failed:", e));
  }

  private start(job: Job) {
    console.log(`[runner] job ${job.id} ${job.kind} for ${job.reviewId}${job.attempts > 1 ? ` (attempt ${job.attempts})` : ""}`);
    const done = this.execute(job)
      .catch((e) => console.error(`[runner] job ${job.id} crashed:`, e))
      .finally(() => {
        this.running.delete(job.id);
        this.active--;
        void this.kick();
      });
    this.running.set(job.id, { reviewId: job.reviewId, done });
  }

  private async execute(job: Job) {
    const started = this.now();
    const beat = setInterval(() => {
      heartbeat(job.id, this.owner, this.leaseMs, this.now()).catch((e) => this.warn("can't extend a job's lease", e));
    }, this.heartbeatMs);
    beat.unref?.();
    try {
      await this.work(job);
      await finishJob(job.id);
      console.log(`[runner] job ${job.id} done in ${((this.now() - started) / 1000).toFixed(0)}s`);
    } catch (e) {
      console.error(`[runner] job ${job.id} failed:`, e);
      // Copying to storage is retried a few times; a failure there never spoils the review itself.
      // Trouble reaching a service is retried too, and every step resumes where it left off.
      const retry = job.attempts < MAX_ATTEMPTS && (job.kind === "store" || (job.kind === "process" && isTransient(e)));
      if (retry) {
        if (!this.stopping) await sleep(this.retryDelayMs(job.attempts));
        await retryJob(job.id, String(e)).catch((err) => console.error(`[runner] couldn't requeue job ${job.id}:`, err));
      } else {
        await finishJob(job.id, String(e)).catch((err) => console.error(`[runner] couldn't record job ${job.id}'s failure:`, err));
        await this.onGiveUp(job, e).catch((err) => console.error(`[runner] couldn't mark review ${job.reviewId} failed:`, err));
      }
    } finally {
      clearInterval(beat);
    }
  }

  /** Cleanup of abandoned uploads and old follow-up credit, at most once per interval per process. */
  private maintainSoon() {
    const t = this.now();
    if (t - this.lastMaintenance < this.maintenanceEveryMs) return;
    this.lastMaintenance = t;
    void this.maintain().catch((e) => this.warn("maintenance failed", e));
  }

  private warn(what: string, e: unknown) {
    const t = Date.now();
    if (t - this.lastWarning < 60_000) return;
    this.lastWarning = t;
    console.error(`[runner] ${what}:`, e instanceof Error ? e.message : e);
  }
}

declare global {
  var __panelRunner: Runner | undefined;
}

/** One runner per process, shared by the routes, instrumentation and scripts (survives dev reloads). */
export function getRunner(): Runner {
  return (globalThis.__panelRunner ??= new Runner());
}
