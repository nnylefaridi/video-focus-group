// Which way this copy of Panel runs, and what that way needs before it starts.
// Plain JavaScript so server.mjs, the start scripts, the worker and the app share one copy.
//   local   (the default) one person on their own computer, listening on 127.0.0.1
//   hosted  (PANEL_MODE=hosted) a public site behind a host's proxy, with sign-in required
import fs from "node:fs";
import path from "node:path";

/** A setting is missing or wrong, so Panel shouldn't start. The message says which and how to fix it. */
export class StartupError extends Error {}

export function parseMode(value) {
  const v = (value ?? "").trim();
  if (v === "" || v === "local") return "local";
  if (v === "hosted") return "hosted";
  throw new StartupError(
    `PANEL_MODE is "${v}", but it can only be "local" or "hosted". Leave it out to run Panel on this computer (local mode).`,
  );
}

/** Reads one .env file's KEY=value lines. */
export function parseEnvFile(text) {
  const out = {};
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    let v = m[2].trim();
    const quoted = v.match(/^(["'])(.*)\1$/);
    if (quoted) v = quoted[2];
    else v = v.replace(/\s+#.*$/, "");
    out[m[1]] = v;
  }
  return out;
}

/** The .env files Next.js loads, in its order (earlier ones win), read without changing process.env. */
export function readEnvFiles(dir = process.cwd(), nodeEnv = process.env.NODE_ENV || "development") {
  const files = [`.env.${nodeEnv}.local`, ...(nodeEnv === "test" ? [] : [".env.local"]), `.env.${nodeEnv}`, ".env"];
  const out = {};
  for (const name of files.reverse()) {
    // Only the start scripts and the worker read these; the website gets them from Next.js.
    const file = path.join(/* turbopackIgnore: true */ dir, name);
    if (fs.existsSync(/* turbopackIgnore: true */ file)) Object.assign(out, parseEnvFile(fs.readFileSync(/* turbopackIgnore: true */ file, "utf8")));
  }
  return out;
}

/** What the app will see once Next.js has loaded the .env files: the real environment wins. */
export function startupEnv(dir = process.cwd(), nodeEnv) {
  return { ...readEnvFiles(dir, nodeEnv), ...process.env };
}

/** HOSTED_PUBLIC_URL as an origin (https://panel.example.com), or null if it isn't one. */
export function publicOriginOf(value) {
  let url;
  try {
    url = new URL(String(value ?? "").trim());
  } catch {
    return null;
  }
  // http is allowed only on this computer, for trying hosted mode before deploying.
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (url.protocol !== "https:" && !(url.protocol === "http:" && local)) return null;
  if (url.pathname !== "/" || url.search || url.hash || url.username || url.password) return null;
  return url.origin;
}

/**
 * KEY_ENCRYPTION_SECRET as the 32 bytes it encodes (from `openssl rand -base64 32`, or
 * 64 hex characters), or null if it isn't exactly that.
 */
export function encryptionSecretOf(value) {
  const v = String(value ?? "").trim();
  if (/^[0-9a-fA-F]{64}$/.test(v)) return Buffer.from(v, "hex");
  if (!/^[A-Za-z0-9+/]{43}=$/.test(v)) return null;
  const bytes = Buffer.from(v, "base64");
  return bytes.length === 32 && bytes.toString("base64") === v ? bytes : null;
}

const HOSTED_REQUIRED = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  "SUPABASE_SECRET_KEY",
  "DATABASE_URL",
  "HOSTED_PUBLIC_URL",
  "KEY_ENCRYPTION_SECRET",
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
];

const set = (v) => Boolean(v && String(v).trim());

/** What hosted mode is missing, and what's set but wrong. Both empty means it can start. */
export function hostedProblems(env) {
  const missing = HOSTED_REQUIRED.filter((k) => !set(env[k]));
  const invalid = [];
  // Behind the host's proxy every request comes from the proxy, so without one of these
  // every visitor would share one allowance.
  const proxies = String(env.TRUSTED_PROXIES ?? "").trim();
  if (!set(env.CLIENT_IP_HEADER) && (!proxies || proxies === "0")) missing.push("CLIENT_IP_HEADER (or TRUSTED_PROXIES)");
  if (set(env.HOSTED_PUBLIC_URL) && !publicOriginOf(env.HOSTED_PUBLIC_URL))
    invalid.push(`HOSTED_PUBLIC_URL must be the site's public https address with nothing after it, like https://panel.example.com (it's "${String(env.HOSTED_PUBLIC_URL).trim()}")`);
  if (set(env.KEY_ENCRYPTION_SECRET) && !encryptionSecretOf(env.KEY_ENCRYPTION_SECRET))
    invalid.push("KEY_ENCRYPTION_SECRET must be 32 random bytes, written as base64 or hex. Make one with: openssl rand -base64 32");
  // A publishable key (pk_) can't create payments; the secret or restricted key can.
  if (set(env.STRIPE_SECRET_KEY) && !/^(sk|rk)_(live|test)_\S+$/.test(String(env.STRIPE_SECRET_KEY).trim()))
    invalid.push("STRIPE_SECRET_KEY must be the secret key from the Stripe Dashboard (Developers → API keys), starting sk_live_ or sk_test_ (or a restricted key, rk_)");
  if (set(env.STRIPE_WEBHOOK_SECRET) && !/^whsec_\S+$/.test(String(env.STRIPE_WEBHOOK_SECRET).trim()))
    invalid.push("STRIPE_WEBHOOK_SECRET must be the webhook endpoint's signing secret, starting whsec_ (Stripe Dashboard → Developers → Webhooks → your endpoint)");
  if (proxies && !/^\d+$/.test(proxies)) invalid.push(`TRUSTED_PROXIES must be a whole number, the count of proxies in front of Panel (it's "${proxies}")`);
  const port = String(env.PORT ?? "").trim();
  if (port && !(/^\d+$/.test(port) && Number(port) >= 1 && Number(port) <= 65535)) invalid.push(`PORT must be a port number like 3000 (it's "${port}")`);
  return { missing, invalid };
}

/** Checks the settings for the chosen mode. Throws StartupError with a plain explanation if Panel can't start. */
export function checkStartup(env) {
  const mode = parseMode(env.PANEL_MODE);
  if (mode === "local") return { mode };
  const { missing, invalid } = hostedProblems(env);
  if (!missing.length && !invalid.length) return { mode };
  const lines = ["Panel can't start in hosted mode (PANEL_MODE=hosted)."];
  if (missing.length) lines.push("These settings are missing:", ...missing.map((k) => `  - ${k}`));
  if (invalid.length) lines.push("These settings need fixing:", ...invalid.map((k) => `  - ${k}`));
  lines.push("Set them in your host's environment (on Fly: fly secrets set NAME=value). The hosted section of .env.example explains each one.");
  throw new StartupError(lines.join("\n"));
}

/** For the scripts that start Panel: checks the settings, or prints why it can't start and exits. */
export function exitUnlessReady(env) {
  try {
    return checkStartup(env).mode;
  } catch (e) {
    if (!(e instanceof StartupError)) throw e;
    console.error(`\n${e.message}\n`);
    process.exit(1);
  }
}

/**
 * Where the website listens. Local mode: this computer only, unless HOST says otherwise
 * (as it always has). Hosted mode: every interface by default, so the host's proxy can reach it.
 */
export function listenAddress(mode, env) {
  const port = Number(env.PORT || 3000);
  if (mode === "hosted") return { hostname: String(env.HOST ?? "").trim() || "0.0.0.0", port };
  return { hostname: env.HOST || "127.0.0.1", port };
}

export function trustedProxyCount(env) {
  return Math.max(0, Number(env.TRUSTED_PROXIES || 0) || 0);
}

/**
 * The visitor's address: the TCP peer, or with trusted proxies in front, the address the
 * nearest of them saw. Entries further left in X-Forwarded-For were written by whoever
 * sent the request, so they're never used.
 */
export function peerAddress(forwardedFor, socketAddress, trustedProxies) {
  const chain = String(forwardedFor ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  chain.push(socketAddress ?? "unknown");
  return chain[Math.max(0, chain.length - 1 - trustedProxies)];
}
