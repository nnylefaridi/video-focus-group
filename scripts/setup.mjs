// One-time setup for running Panel on your own computer:  npm run setup
// Checks the tools, downloads the speech-to-text model, asks for your Anthropic API
// key (and checks it works), and prepares the built-in database. Safe to run again.
//
//   npm run setup -- --skip-key
//     Finish everything except the API key, so you can paste it into .env.local later.
//     A non-interactive run with no key does the same, and says so.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { spawnSync } from "node:child_process";
import { localDatabaseRunning, startLocalDatabase, wantsLocalDatabase } from "./local-db.mjs";
import { commandPath, findWhisper, installPlan, readOsRelease } from "./prereqs.mjs";

const ROOT = process.cwd();
const skipKey = process.argv.includes("--skip-key");
const ok = (msg) => console.log(`  ✓ ${msg}`);
const fail = (msg) => {
  console.error(`\n  ✗ ${msg}\n`);
  process.exit(1);
};

function loadRelease() {
  try {
    return readOsRelease(fs.readFileSync("/etc/os-release", "utf8"));
  } catch {
    return { id: "", versionId: "", idLike: "", pretty: "" };
  }
}

/** Run whisper's help and check for the flags the media pipeline passes. Help is printed on stderr. */
function inspectWhisper(bin) {
  const result = spawnSync(bin, ["-h"], { encoding: "utf8" });
  const text = `${result.stdout ?? ""}\n${result.stderr ?? ""}\n${result.error?.message ?? ""}`;
  const libraries = /shared librar|cannot open shared object|error while loading/i.test(text);
  const missing = ["-m", "-f", "-ojf", "-of", "-np", "-l"].filter((flag) => !text.includes(flag));
  if (result.status === 0 && missing.length === 0) return { ok: true, libraries: false, detail: "" };
  const detail = text.trim().split("\n").filter(Boolean).slice(0, 6).join("\n");
  return { ok: false, libraries, detail };
}

console.log("\nSetting up Panel\n");

const release = loadRelease();
const whisper = findWhisper();
const whisperHelp = whisper ? inspectWhisper(whisper.path) : null;
const plan = installPlan({
  platform: process.platform,
  release,
  arch: os.arch(),
  nodeVersion: process.versions.node,
  has: (cmd) => Boolean(commandPath(cmd)),
  whisper,
  whisperHelp: whisperHelp && !whisperHelp.ok ? whisperHelp : null,
});
if (!plan.ok) {
  console.error("\n  ✗ Setup can't continue yet.\n");
  for (const problem of plan.problems) {
    console.error(`  ${problem.title}\n`);
    for (const line of problem.lines) console.error(line ? `      ${line}` : "");
    console.error("");
  }
  console.error("  Fix those, then run npm run setup again.\n");
  process.exit(1);
}
ok(`Node.js, ffmpeg and ${whisper.name} are installed`);

// Speech-to-text model (about 148 MB). A partial download is replaced on the next run.
const model = path.join(ROOT, "data", "models", "ggml-base.en.bin");
const modelUrl = "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin";
if (fs.existsSync(model) && fs.statSync(model).size > 100_000_000) ok("Speech-to-text model is downloaded");
else {
  fs.mkdirSync(path.dirname(model), { recursive: true });
  const tmp = `${model}.part`;
  let res;
  try {
    res = await fetch(modelUrl);
  } catch (e) {
    fs.rmSync(tmp, { force: true });
    const why = e instanceof Error ? e.message : String(e);
    fail(`Couldn't download the speech-to-text model from huggingface.co (${why}). Check your connection and run npm run setup again.`);
  }
  if (!res.ok || !res.body) {
    fs.rmSync(tmp, { force: true });
    fail(`Couldn't download the speech-to-text model (HTTP ${res.status} from huggingface.co). Check your connection and run npm run setup again.`);
  }
  const total = Number(res.headers.get("content-length") ?? 0);
  const out = fs.createWriteStream(tmp);
  let got = 0;
  let shown = -1;
  try {
    for await (const chunk of res.body) {
      out.write(chunk);
      got += chunk.length;
      const pct = total ? Math.floor((got / total) * 100) : 0;
      if (pct !== shown && pct % 5 === 0) {
        process.stdout.write(`\r  Downloading the speech-to-text model… ${pct}%`);
        shown = pct;
      }
    }
    await new Promise((resolve, reject) => {
      out.once("error", reject);
      out.end(resolve);
    });
  } catch (e) {
    out.destroy();
    fs.rmSync(tmp, { force: true });
    const why = e instanceof Error ? e.message : String(e);
    fail(`The speech-to-text model download stopped (${why}). Run npm run setup again. A partial file is not kept.`);
  }
  if (total && got < total) {
    fs.rmSync(tmp, { force: true });
    fail(`The speech-to-text model download stopped early (${got} of ${total} bytes). Run npm run setup again.`);
  }
  fs.renameSync(tmp, model);
  if (!fs.existsSync(model) || fs.statSync(model).size <= 100_000_000) {
    fs.rmSync(model, { force: true });
    fail("The speech-to-text model download finished, but the file is too small. Run npm run setup again.");
  }
  process.stdout.write("\r");
  ok("Speech-to-text model downloaded                    ");
}

// Anthropic API key, kept in .env.local (never committed, never printed).
const envFile = path.join(ROOT, ".env.local");
if (!fs.existsSync(envFile)) fs.copyFileSync(path.join(ROOT, ".env.example"), envFile);
let env = fs.readFileSync(envFile, "utf8");
const current = env.match(/^ANTHROPIC_API_KEY=(.*)$/m)?.[1]?.trim() ?? "";

async function keyWorks(key) {
  const res = await fetch("https://api.anthropic.com/v1/models?limit=1", {
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01" },
  }).catch(() => null);
  if (!res) return "offline";
  return res.ok ? "ok" : res.status === 401 || res.status === 403 ? "rejected" : "offline";
}

let key = current;
let keyStatus = "ok";
if (key && (await keyWorks(key)) === "rejected") {
  console.log("  The Anthropic API key in .env.local was rejected by Anthropic.");
  if (process.stdin.isTTY && !skipKey) key = "";
  else keyStatus = "rejected";
}
if (!key && keyStatus !== "rejected") {
  if (skipKey || !process.stdin.isTTY) {
    keyStatus = "skipped";
    console.log("  No Anthropic API key yet, so this step was skipped.");
    if (!process.stdin.isTTY && !skipKey) console.log("  This isn't an interactive terminal, so Panel can't ask you to paste one.");
    console.log("  Reviews won't run until .env.local contains a working ANTHROPIC_API_KEY.");
    console.log("  Run npm run setup again in a terminal and paste the key, or add the line yourself.");
  } else {
    console.log("\n  Panel needs an Anthropic API key. Create one at https://console.anthropic.com");
    console.log("  (Settings → API Keys; add billing first). It stays in .env.local on this computer.");
    console.log("  To finish without a key, press Ctrl+C and run: npm run setup -- --skip-key\n");
    // Lines are read through an iterator so nothing typed is lost while a key is being checked.
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    const lines = rl[Symbol.asyncIterator]();
    for (;;) {
      process.stdout.write("  Paste your API key: ");
      const next = await lines.next();
      if (next.done) fail("No API key was entered. Run npm run setup again when you have one, or run npm run setup -- --skip-key and add it to .env.local later.");
      key = next.value.trim();
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
    const line = () => `ANTHROPIC_API_KEY=${key}`;
    env = /^ANTHROPIC_API_KEY=.*$/m.test(env) ? env.replace(/^ANTHROPIC_API_KEY=.*$/m, line) : `${line()}\n${env}`;
    fs.writeFileSync(envFile, env);
  }
}
try {
  fs.chmodSync(envFile, 0o600);
} catch {
  // The key file is still only on this computer. A permission tweak failing isn't worth stopping setup.
}
if (keyStatus === "ok") ok("Anthropic API key is saved in .env.local");
else if (keyStatus === "skipped") console.log("  ! Anthropic API key was not set");

// Database
if (wantsLocalDatabase()) {
  if (await localDatabaseRunning()) ok("Built-in database is ready (Panel is running)");
  else {
    const db = await startLocalDatabase().catch((e) => fail(e instanceof Error ? e.message : String(e)));
    await db.stop();
    ok("Built-in database is ready (in data/pg)");
  }
} else ok("Using the database set in DATABASE_URL");

if (keyStatus === "rejected") {
  console.error("\nThe tools and the built-in database are ready, but Anthropic rejected the API key in .env.local.");
  console.error("The key was not printed. Replace ANTHROPIC_API_KEY in .env.local, or run npm run setup in a terminal and paste a new one.");
  console.error("Then start Panel with:\n\n    npm run dev\n");
  process.exit(1);
}
if (keyStatus === "skipped") {
  console.log("\nAlmost set. The tools and the built-in database are ready, but there is no API key yet.");
  console.log("Add one line to .env.local (it stays on this computer):\n");
  console.log("    ANTHROPIC_API_KEY=sk-ant-...\n");
  console.log("Or run npm run setup again in a terminal and paste the key.");
  console.log("Panel will open without a key, and a review will not run until the key is there.\n");
  console.log("    npm run dev\n");
  console.log("then open http://127.0.0.1:3000\n");
  process.exit(0);
}

console.log("\nAll set. Start Panel with:\n\n    npm run dev\n\nthen open http://127.0.0.1:3000\n");
process.exit(0);
