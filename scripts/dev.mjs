// Starts the web app and the background worker together; Ctrl+C stops both.
// Without DATABASE_URL in .env.local, it also runs the built-in local database.
import { spawn } from "node:child_process";
import { startLocalDatabase, wantsLocalDatabase } from "./local-db.mjs";

const db = wantsLocalDatabase() ? await startLocalDatabase() : null;
if (db) process.env.DATABASE_URL = db.url;

const procs = [
  // Bound to this computer only (see server.mjs), so nobody else on your network can use your API key.
  spawn("node", ["server.mjs", "--dev"], { stdio: "inherit" }),
  spawn("npx", ["tsx", "watch", "--env-file-if-exists=.env.local", "worker/index.mts"], { stdio: "inherit" }),
];
let stopping = false;
async function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  procs.forEach((p) => p.kill("SIGINT"));
  await Promise.all(procs.map((p) => (p.exitCode === null ? new Promise((r) => p.once("exit", r)) : null)));
  await db?.stop().catch(() => {});
  process.exit(code);
}
process.on("SIGINT", () => stop());
process.on("SIGTERM", () => stop());
procs.forEach((p) => p.on("exit", (code) => code && code !== 0 && stop(code)));
