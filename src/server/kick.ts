import { after } from "next/server";

/**
 * Call from a route that just queued work (or that notices unfinished work): once the
 * response has gone out, wakes the in-process runner. The runner starts each run detached,
 * so this finishes at once and doesn't depend on how long the route may run.
 */
export function kickAfterResponse() {
  after(async () => {
    const { getRunner } = await import("./runner");
    await getRunner().kick();
  });
}

/**
 * Wakes the runner right now, with no response to wait for. For code that has no request scope
 * to hand to `after` (the middle of a streamed answer). Detached: never throws, never waits.
 */
export function kickNow() {
  void import("./runner").then((m) => m.getRunner().kick()).catch((e) => console.error("[runner] couldn't start:", e));
}

/** Same, for a poll of one review: only when that review is mid-run and this process isn't the one running it. */
export function kickIfUnattended(reviewId: string, stage: string) {
  if (stage === "uploading" || stage === "done" || stage === "failed") return;
  after(async () => {
    const { getRunner } = await import("./runner");
    const runner = getRunner();
    if (!runner.isRunning(reviewId)) await runner.kick();
  });
}
