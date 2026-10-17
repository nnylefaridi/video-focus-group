// Production: starts the website and the background worker together (the Dockerfile's command).
// If either stops, both stop, so the host restarts the container cleanly.
import { spawn } from "node:child_process";

const procs = [
  spawn("node", ["server.mjs"], { stdio: "inherit" }),
  spawn("node", ["--import", "tsx", "worker/index.mts"], { stdio: "inherit" }),
];
const stop = () => procs.forEach((p) => p.kill("SIGTERM"));
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
procs.forEach((p) => p.on("exit", (code) => {
  stop();
  process.exitCode = code ?? 1;
}));
