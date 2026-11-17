// Starts Panel's website with Next.js's own server: `next dev` or `next start`. There's no
// separate worker: reviews are made inside the website's process (src/server/runner.ts).
// Shared by `npm run dev` (scripts/dev.mjs) and `npm start` (scripts/start.mjs).
//
// Local mode (the default) listens on 127.0.0.1 only, so nobody else on your network can use
// your API key, and runs the built-in database unless DATABASE_URL points elsewhere.
// Hosted mode (PANEL_MODE=hosted) checks its settings first, then listens where the host says.
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import net from "node:net";
import { LocalDatabaseError, startLocalDatabase, wantsLocalDatabase } from "./local-db.mjs";
import { exitUnlessReady, listenAddress, startupEnv } from "../src/server/mode.mjs";

/** Resolves when something is already listening where we're about to, so we can say so plainly. */
function portTaken(hostname, port) {
  return new Promise((resolve) => {
    const probe = net.createServer();
    probe.once("error", (e) => resolve(e.code === "EADDRINUSE"));
    probe.once("listening", () => probe.close(() => resolve(false)));
    probe.listen(port, hostname);
  });
}

export async function serve({ dev }) {
  const nodeEnv = dev ? "development" : "production";
  // Hosted mode needs its settings first, and its own database.
  const env = startupEnv(process.cwd(), nodeEnv);
  const mode = exitUnlessReady(env);
  // Local mode reads HOST and PORT from the shell only, as it always has; hosted mode also reads the .env files.
  const { hostname, port } = listenAddress(mode, mode === "hosted" ? env : process.env);

  const db = mode === "local" && wantsLocalDatabase()
    ? await startLocalDatabase().catch((e) => {
        console.error(`\n${e instanceof LocalDatabaseError ? e.message : e}\n`);
        process.exit(1);
      })
    : null;
  if (db) process.env.DATABASE_URL = db.url;
  process.env.NODE_ENV = nodeEnv;

  if (await portTaken(hostname, port)) {
    console.error(`\nPort ${port} is already in use (is Panel already running in another window?). Stop that, or run on another port: PORT=${port + 1} npm ${dev ? "run dev" : "start"}\n`);
    await db?.stop().catch(() => {});
    process.exit(1);
  }

  const next = createRequire(import.meta.url).resolve("next/dist/bin/next");
  const child = spawn(process.execPath, [next, dev ? "dev" : "start", "--hostname", hostname, "--port", String(port)], { stdio: "inherit", env: process.env });

  let stopping = false;
  async function stop(code = 0) {
    if (stopping) return;
    stopping = true;
    if (child.exitCode === null) {
      child.kill(dev ? "SIGINT" : "SIGTERM");
      await new Promise((r) => child.once("exit", r));
    }
    await db?.stop().catch(() => {});
    process.exit(code);
  }
  process.on("SIGINT", () => stop());
  process.on("SIGTERM", () => stop());
  child.on("exit", (code, signal) => stop(code ?? (signal ? 1 : 0)));
}
