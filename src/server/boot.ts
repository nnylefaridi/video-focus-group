import { exitUnlessReady, startupEnv, type Env } from "./mode.mjs";

declare global {
  var __panelBooted: boolean | undefined;
}

/**
 * Runs once when the server starts (src/instrumentation.ts), whichever way it was started:
 * `next start`, the standalone server.js, or `next dev`. Hosted mode with a missing or wrong
 * setting prints what's wrong and exits before the server takes a single request. Then it
 * picks up any reviews a previous process left unfinished.
 */
export async function bootServer(env: Env = startupEnv()): Promise<void> {
  exitUnlessReady(env);
  if (globalThis.__panelBooted) return;
  globalThis.__panelBooted = true;
  const { getRunner } = await import("./runner");
  const runner = getRunner();
  // On shutdown, let go of the reviews this process is running so the next one resumes them
  // at once rather than when their lease runs out. Next.js does the actual exiting.
  for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, () => void runner.stop());
  void runner.resumeOnBoot();
}
