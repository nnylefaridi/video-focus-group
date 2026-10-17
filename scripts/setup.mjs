// One-time setup for running Panel on your own computer:  npm run setup
// Checks the tools, downloads the speech-to-text model, asks for your Anthropic API
// key (and checks it works), and prepares the built-in database. Safe to run again.
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline/promises";
import { execFileSync } from "node:child_process";
import { startLocalDatabase, wantsLocalDatabase } from "./local-db.mjs";

const ROOT = process.cwd();
const ok = (msg) => console.log(`  ✓ ${msg}`);
const fail = (msg) => {
  console.error(`\n  ✗ ${msg}\n`);
  process.exit(1);
};

console.log("\nSetting up Panel\n");

// 1. Tools
const [major, minor] = process.versions.node.split(".").map(Number);
if (major < 20 || (major === 20 && minor < 9)) fail(`Node.js 20.9 or newer is needed (you have ${process.versions.node}). Run: brew upgrade node`);
const has = (cmd) => {
  try {
    execFileSync("which", [cmd], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
};
const missing = ["ffmpeg", "ffprobe", "whisper-cli"].filter((c) => !has(c));
if (missing.length) fail(`Missing: ${missing.join(", ")}. Install them with:\n\n      brew install ffmpeg whisper-cpp\n\n    then run npm run setup again.`);
ok("Node.js, ffmpeg and whisper are installed");

// 2. Speech-to-text model (about 150 MB)
const model = path.join(ROOT, "data", "models", "ggml-base.en.bin");
if (fs.existsSync(model) && fs.statSync(model).size > 100_000_000) ok("Speech-to-text model is downloaded");
else {
  fs.mkdirSync(path.dirname(model), { recursive: true });
  const res = await fetch("https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin");
  if (!res.ok || !res.body) fail(`Couldn't download the speech-to-text model (HTTP ${res.status}). Check your internet connection and run npm run setup again.`);
  const total = Number(res.headers.get("content-length") ?? 0);
  const tmp = `${model}.part`;
  const out = fs.createWriteStream(tmp);
  let got = 0;
  let shown = -1;
  for await (const chunk of res.body) {
    out.write(chunk);
    got += chunk.length;
    const pct = total ? Math.floor((got / total) * 100) : 0;
    if (pct !== shown && pct % 5 === 0) {
      process.stdout.write(`\r  Downloading the speech-to-text model… ${pct}%`);
      shown = pct;
    }
  }
  await new Promise((r) => out.end(r));
  fs.renameSync(tmp, model);
  process.stdout.write("\r");
  ok("Speech-to-text model downloaded                    ");
}

// 3. Anthropic API key, kept in .env.local (never committed)
const envFile = path.join(ROOT, ".env.local");
if (!fs.existsSync(envFile)) fs.copyFileSync(path.join(ROOT, ".env.example"), envFile);
let env = fs.readFileSync(envFile, "utf8");
const current = env.match(/^ANTHROPIC_API_KEY=(.*)$/m)?.[1]?.trim() ?? "";

async function keyWorks(key) {
  const res = await fetch("https://api.anthropic.com/v1/models?limit=1", { headers: { "x-api-key": key, "anthropic-version": "2023-06-01" } }).catch(() => null);
  if (!res) return "offline";
  return res.ok ? "ok" : res.status === 401 || res.status === 403 ? "rejected" : "offline";
}

let key = current;
if (key && (await keyWorks(key)) === "rejected") {
  console.log("  The Anthropic API key in .env.local was rejected by Anthropic.");
  key = "";
}
if (!key) {
  console.log("\n  Panel needs an Anthropic API key. Create one at https://console.anthropic.com");
  console.log("  (Settings → API Keys; add billing first). It stays in .env.local on this computer.\n");
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  for (;;) {
    key = (await rl.question("  Paste your API key: ")).trim();
    if (!key) continue;
    const check = await keyWorks(key);
    if (check === "ok") break;
    if (check === "offline") {
      console.log("  Couldn't reach Anthropic to check it, so it's saved as is.");
      break;
    }
    console.log("  Anthropic rejected that key. Check you copied all of it (it starts with sk-ant-) and try again.");
  }
  rl.close();
  env = /^ANTHROPIC_API_KEY=.*$/m.test(env) ? env.replace(/^ANTHROPIC_API_KEY=.*$/m, `ANTHROPIC_API_KEY=${key}`) : `ANTHROPIC_API_KEY=${key}\n${env}`;
  fs.writeFileSync(envFile, env, { mode: 0o600 });
}
ok("Anthropic API key is saved in .env.local");

// 4. Database
if (wantsLocalDatabase()) {
  const db = await startLocalDatabase().catch((e) => fail(e.message));
  await db.stop();
  ok("Built-in database is ready (in data/pg)");
} else ok("Using the database set in DATABASE_URL");

console.log("\nAll set. Start Panel with:\n\n    npm run dev\n\nthen open http://127.0.0.1:3000\n");
process.exit(0);
