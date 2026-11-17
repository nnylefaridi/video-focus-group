/**
 * Runs once when the server starts, before it takes requests. Checks hosted mode's settings
 * (and stops the server if they're wrong), then resumes unfinished reviews. The work is in
 * server/boot.ts so the edge runtime never loads it, and so a build (which has no secrets) skips it.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.NEXT_PHASE === "phase-production-build") return;
  const { bootServer } = await import("./server/boot");
  await bootServer();
}
