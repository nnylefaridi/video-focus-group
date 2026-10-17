// Starts the web app and the background worker together; Ctrl+C stops both.
import { spawn } from "node:child_process";

const procs = [
  // Bound to this computer only (see server.mjs), so nobody else on your network can use your API key.
  spawn("node", ["server.mjs", "--dev"], { stdio: "inherit" }),
  spawn("npx", ["tsx", "watch", "--env-file-if-exists=.env.local", "worker/index.mts"], { stdio: "inherit" }),
];
const stop = () => procs.forEach((p) => p.kill("SIGINT"));
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
procs.forEach((p) => p.on("exit", (code) => code && code !== 0 && stop()));
