// Production build on your computer (`npm run build`, then `npm start`): the website
// and the background worker together, plus the local database when DATABASE_URL isn't set.
import { spawn } from "node:child_process";
import { LocalDatabaseError, startLocalDatabase, wantsLocalDatabase } from "./local-db.mjs";

const db = wantsLocalDatabase()
  ? await startLocalDatabase().catch((e) => {
      console.error(`\n${e instanceof LocalDatabaseError ? e.message : e}\n`);
      process.exit(1);
    })
  : null;
if (db) process.env.DATABASE_URL = db.url;
process.env.NODE_ENV = "production";

const procs = [
  spawn("node", ["server.mjs"], { stdio: "inherit" }),
  spawn("node", ["--env-file-if-exists=.env.local", "--import", "tsx", "worker/index.mts"], { stdio: "inherit" }),
];
let stopping = false;
async function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  procs.forEach((p) => p.kill("SIGTERM"));
  await Promise.all(procs.map((p) => (p.exitCode === null ? new Promise((r) => p.once("exit", r)) : null)));
  await db?.stop().catch(() => {});
  process.exit(code);
}
process.on("SIGINT", () => stop());
process.on("SIGTERM", () => stop());
procs.forEach((p) => p.on("exit", (code) => stop(code ?? 1)));
