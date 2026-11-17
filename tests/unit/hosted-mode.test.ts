/**
 * Hosted mode (PANEL_MODE=hosted): which mode is chosen, what it needs before it starts,
 * where it listens, and how it reads visitors' addresses behind a proxy. Local mode must
 * behave exactly as it always has.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  canonicalLocation,
  checkStartup,
  encryptionSecretOf,
  hostedProblems,
  listenAddress,
  mediaSecretOf,
  parseEnvFile,
  forwardedClient,
  parseMode,
  publicOriginOf,
  readEnvFiles,
  StartupError,
  trustedProxyCount,
} from "@/server/mode.mjs";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "panel-hosted-"));

/** Everything hosted mode needs, as it would be set on Fly. */
const HOSTED = {
  PANEL_MODE: "hosted",
  NEXT_PUBLIC_SUPABASE_URL: "https://abcd.supabase.co",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
  SUPABASE_SECRET_KEY: "sb_secret_test",
  DATABASE_URL: "postgres://u:p@db.example.com:5432/postgres",
  HOSTED_PUBLIC_URL: "https://panel.example.com",
  CLIENT_IP_HEADER: "Fly-Client-IP",
  KEY_ENCRYPTION_SECRET: Buffer.alloc(32, 7).toString("base64"),
  MEDIA_SECRET: Buffer.alloc(32, 9).toString("base64"),
  STRIPE_SECRET_KEY: "sk_test_51abcdefghijklmnop",
  STRIPE_WEBHOOK_SECRET: "whsec_abcdefghijklmnop",
};

const without = (...keys: string[]) => Object.fromEntries(Object.entries(HOSTED).filter(([k]) => !keys.includes(k)));

describe("choosing the mode", () => {
  it("is local when PANEL_MODE is left out or empty", () => {
    expect(parseMode(undefined)).toBe("local");
    expect(parseMode("")).toBe("local");
    expect(parseMode("  ")).toBe("local");
    expect(parseMode("local")).toBe("local");
  });

  it("is hosted only for PANEL_MODE=hosted", () => {
    expect(parseMode("hosted")).toBe("hosted");
    expect(parseMode(" hosted ")).toBe("hosted");
  });

  it("refuses any other value, saying what's allowed", () => {
    for (const v of ["production", "Hosted", "true", "1"]) {
      expect(() => parseMode(v)).toThrow(StartupError);
      expect(() => parseMode(v)).toThrow(`PANEL_MODE is "${v}", but it can only be "local" or "hosted"`);
    }
  });

  it("gives the app the same answer through getMode() and isHosted()", async () => {
    const config = await import("@/server/config");
    const before = process.env.PANEL_MODE;
    try {
      delete process.env.PANEL_MODE;
      expect(config.getMode()).toBe("local");
      expect(config.isHosted()).toBe(false);
      process.env.PANEL_MODE = "hosted";
      expect(config.getMode()).toBe("hosted");
      expect(config.isHosted()).toBe(true);
      process.env.PANEL_MODE = "staging";
      expect(() => config.getMode()).toThrow(/can only be "local" or "hosted"/);
    } finally {
      if (before === undefined) delete process.env.PANEL_MODE;
      else process.env.PANEL_MODE = before;
    }
  });
});

describe("what hosted mode needs before it starts", () => {
  it("needs nothing new in local mode", () => {
    expect(checkStartup({})).toEqual({ mode: "local" });
    expect(checkStartup({ PANEL_MODE: "local" })).toEqual({ mode: "local" });
  });

  it("starts when everything is set", () => {
    expect(checkStartup(HOSTED)).toEqual({ mode: "hosted" });
    expect(checkStartup({ ...without("CLIENT_IP_HEADER"), TRUSTED_PROXIES: "1" })).toEqual({ mode: "hosted" });
  });

  it("lists exactly the settings that are missing", () => {
    expect(hostedProblems(without("SUPABASE_SECRET_KEY", "HOSTED_PUBLIC_URL")).missing).toEqual(["SUPABASE_SECRET_KEY", "HOSTED_PUBLIC_URL"]);
    expect(hostedProblems(without("DATABASE_URL")).missing).toEqual(["DATABASE_URL"]);
    expect(hostedProblems({ ...HOSTED, NEXT_PUBLIC_SUPABASE_URL: "  " }).missing).toEqual(["NEXT_PUBLIC_SUPABASE_URL"]);
    expect(hostedProblems({ PANEL_MODE: "hosted" }).missing).toEqual([
      "NEXT_PUBLIC_SUPABASE_URL",
      "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
      "SUPABASE_SECRET_KEY",
      "DATABASE_URL",
      "HOSTED_PUBLIC_URL",
      "KEY_ENCRYPTION_SECRET",
      "MEDIA_SECRET",
      "STRIPE_SECRET_KEY",
      "STRIPE_WEBHOOK_SECRET",
      "CLIENT_IP_HEADER (or TRUSTED_PROXIES)",
    ]);
  });

  it("needs MEDIA_SECRET to be at least 32 bytes as base64 or hex", () => {
    expect(hostedProblems(without("MEDIA_SECRET")).missing).toEqual(["MEDIA_SECRET"]);
    expect(() => checkStartup(without("MEDIA_SECRET"))).toThrow(/These settings are missing:\n {2}- MEDIA_SECRET/);
    expect(mediaSecretOf(HOSTED.MEDIA_SECRET)).toHaveLength(32);
    expect(mediaSecretOf("ab".repeat(48))).toHaveLength(48);
    for (const bad of ["secret", "ab".repeat(16), Buffer.alloc(16).toString("base64"), "not base64!!"]) {
      expect(mediaSecretOf(bad)).toBeNull();
      const { missing, invalid } = hostedProblems({ ...HOSTED, MEDIA_SECRET: bad });
      expect(missing).toEqual([]);
      expect(invalid).toEqual(["MEDIA_SECRET must be at least 32 random bytes, written as base64 or hex. Make one with: openssl rand -base64 32"]);
    }
  });

  it("signs media links with MEDIA_SECRET in hosted mode, and the data-dir file in local mode", () => {
    const script = `
      const c = await import("./src/server/config.ts");
      const fs = await import("node:fs");
      const file = c.DATA_DIR + "/.media-secret";
      const secret = c.mediaSecret().toString("hex");
      console.log(JSON.stringify({ secret, file: fs.existsSync(file) }));`;
    const run = (env: Record<string, string>) => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "panel-media-"));
      const r = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", script], {
        cwd: ROOT,
        encoding: "utf8",
        env: { PATH: process.env.PATH ?? "", DATA_DIR: dir, ...env } as unknown as NodeJS.ProcessEnv,
      });
      return { ...r, out: r.status === 0 ? JSON.parse(r.stdout.trim().split("\n").pop()!) : null };
    };
    const hosted = run({ PANEL_MODE: "hosted", MEDIA_SECRET: HOSTED.MEDIA_SECRET });
    expect(hosted.out).toEqual({ secret: Buffer.alloc(32, 9).toString("hex"), file: false });
    const missing = run({ PANEL_MODE: "hosted" });
    expect(missing.status).not.toBe(0);
    expect(missing.stderr).toMatch(/MEDIA_SECRET isn't set to at least 32 random bytes.*openssl rand -base64 32/);
    const local = run({});
    expect(local.out.file).toBe(true);
    expect(local.out.secret).toHaveLength(64);
  });

  it("needs Stripe's secret key and webhook signing secret, and says which is wrong", () => {
    expect(hostedProblems(without("STRIPE_SECRET_KEY")).missing).toEqual(["STRIPE_SECRET_KEY"]);
    expect(hostedProblems(without("STRIPE_WEBHOOK_SECRET")).missing).toEqual(["STRIPE_WEBHOOK_SECRET"]);
    for (const ok of ["sk_live_abc123", "sk_test_abc123", "rk_live_abc123"]) expect(hostedProblems({ ...HOSTED, STRIPE_SECRET_KEY: ok }).invalid).toEqual([]);
    // A publishable key can't take payments, and a webhook secret isn't an API key.
    for (const bad of ["pk_live_abc123", "whsec_abc", "sk_abc"]) expect(hostedProblems({ ...HOSTED, STRIPE_SECRET_KEY: bad }).invalid[0]).toMatch(/^STRIPE_SECRET_KEY must be the secret key/);
    expect(hostedProblems({ ...HOSTED, STRIPE_WEBHOOK_SECRET: "sk_test_abc" }).invalid[0]).toMatch(/^STRIPE_WEBHOOK_SECRET must be the webhook endpoint's signing secret, starting whsec_/);
    expect(() => checkStartup(without("STRIPE_WEBHOOK_SECRET"))).toThrow(/These settings are missing:\n {2}- STRIPE_WEBHOOK_SECRET/);
  });

  it("needs KEY_ENCRYPTION_SECRET to be 32 bytes as base64 or hex", () => {
    expect(hostedProblems(without("KEY_ENCRYPTION_SECRET")).missing).toEqual(["KEY_ENCRYPTION_SECRET"]);
    expect(encryptionSecretOf(HOSTED.KEY_ENCRYPTION_SECRET)).toHaveLength(32);
    expect(encryptionSecretOf("ab".repeat(32))).toEqual(Buffer.alloc(32, 0xab));
    for (const bad of ["secret", "ab".repeat(16), "ab".repeat(33), Buffer.alloc(16).toString("base64"), Buffer.alloc(33).toString("base64"), `${HOSTED.KEY_ENCRYPTION_SECRET.slice(0, -1)}`]) {
      expect(encryptionSecretOf(bad)).toBeNull();
      const { missing, invalid } = hostedProblems({ ...HOSTED, KEY_ENCRYPTION_SECRET: bad });
      expect(missing).toEqual([]);
      expect(invalid).toEqual(["KEY_ENCRYPTION_SECRET must be 32 random bytes, written as base64 or hex. Make one with: openssl rand -base64 32"]);
    }
    expect(() => checkStartup({ ...HOSTED, KEY_ENCRYPTION_SECRET: "secret" })).toThrow(/KEY_ENCRYPTION_SECRET must be 32 random bytes/);
  });

  it("puts the missing settings in a plain message", () => {
    const e = (() => {
      try {
        checkStartup(without("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "DATABASE_URL"));
      } catch (x) {
        return x as Error;
      }
    })();
    expect(e).toBeInstanceOf(StartupError);
    expect(e!.message).toBe(
      [
        "Panel can't start in hosted mode (PANEL_MODE=hosted).",
        "These settings are missing:",
        "  - NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
        "  - DATABASE_URL",
        "Set them in your host's environment (on Render: the service's Environment tab; on Fly: fly secrets set NAME=value). The hosted section of .env.example explains each one.",
      ].join("\n"),
    );
  });

  it("needs a way to tell visitors apart behind the proxy", () => {
    expect(hostedProblems(without("CLIENT_IP_HEADER")).missing).toEqual(["CLIENT_IP_HEADER (or TRUSTED_PROXIES)"]);
    expect(hostedProblems({ ...without("CLIENT_IP_HEADER"), TRUSTED_PROXIES: "0" }).missing).toEqual(["CLIENT_IP_HEADER (or TRUSTED_PROXIES)"]);
    expect(hostedProblems({ ...without("CLIENT_IP_HEADER"), TRUSTED_PROXIES: "one" }).invalid[0]).toMatch(/TRUSTED_PROXIES must be a whole number/);
  });

  it("needs HOSTED_PUBLIC_URL to be a public https origin", () => {
    expect(publicOriginOf("https://panel.example.com")).toBe("https://panel.example.com");
    expect(publicOriginOf("https://panel.example.com/")).toBe("https://panel.example.com");
    // Plain http only on this computer, for trying hosted mode out.
    expect(publicOriginOf("http://127.0.0.1:3000")).toBe("http://127.0.0.1:3000");
    expect(publicOriginOf("http://localhost:3000")).toBe("http://localhost:3000");
    for (const bad of ["http://panel.example.com", "panel.example.com", "https://panel.example.com/app", "https://panel.example.com/?x=1", "ftp://x.com", ""]) {
      expect(publicOriginOf(bad)).toBeNull();
    }
    const { missing, invalid } = hostedProblems({ ...HOSTED, HOSTED_PUBLIC_URL: "http://panel.example.com" });
    expect(missing).toEqual([]);
    expect(invalid[0]).toMatch(/HOSTED_PUBLIC_URL must be the site's public https address/);
    expect(() => checkStartup({ ...HOSTED, HOSTED_PUBLIC_URL: "http://panel.example.com" })).toThrow(/These settings need fixing:/);
  });

  it("checks PORT is a port", () => {
    expect(hostedProblems({ ...HOSTED, PORT: "8080" }).invalid).toEqual([]);
    expect(hostedProblems({ ...HOSTED, PORT: "eighty" }).invalid[0]).toMatch(/PORT must be a port number/);
  });

  it("reads hosted settings from the .env files Next.js loads, without changing the environment", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "panel-envfiles-"));
    fs.writeFileSync(path.join(dir, ".env"), "PANEL_MODE=local\nHOST=1.1.1.1\n");
    fs.writeFileSync(path.join(dir, ".env.local"), '# a comment\nPANEL_MODE=hosted\nexport HOSTED_PUBLIC_URL="https://panel.example.com"\nPORT=8080 # inline note\n');
    const env = readEnvFiles(dir, "production");
    expect(env).toEqual({ PANEL_MODE: "hosted", HOST: "1.1.1.1", HOSTED_PUBLIC_URL: "https://panel.example.com", PORT: "8080" });
    expect(process.env.HOSTED_PUBLIC_URL).toBeUndefined();
    expect(parseEnvFile("A='x y'\nB=\n#C=1\n")).toEqual({ A: "x y", B: "" });
  });
});

describe("where the website listens", () => {
  it("binds to this computer only in local mode, as before", () => {
    expect(listenAddress("local", {})).toEqual({ hostname: "127.0.0.1", port: 3000 });
    expect(listenAddress("local", { PORT: "3001" })).toEqual({ hostname: "127.0.0.1", port: 3001 });
    // A HOST override still works the way it always has.
    expect(listenAddress("local", { HOST: "0.0.0.0" })).toEqual({ hostname: "0.0.0.0", port: 3000 });
  });

  it("binds where the host says in hosted mode, every interface by default", () => {
    expect(listenAddress("hosted", {})).toEqual({ hostname: "0.0.0.0", port: 3000 });
    expect(listenAddress("hosted", { HOST: "::", PORT: "8080" })).toEqual({ hostname: "::", port: 8080 });
  });
});

describe("visitors' addresses behind a proxy", () => {
  it("counts the trusted proxies from TRUSTED_PROXIES", () => {
    expect(trustedProxyCount({})).toBe(0);
    expect(trustedProxyCount({ TRUSTED_PROXIES: "2" })).toBe(2);
  });

  it("never uses X-Forwarded-For when no proxy is trusted", () => {
    expect(forwardedClient("6.6.6.6", 0)).toBe("unknown");
    expect(forwardedClient(undefined, 0)).toBe("unknown");
    expect(forwardedClient(null, 1)).toBe("unknown");
  });

  it("takes the Nth entry from the right, the address the outermost trusted proxy saw, never one the visitor wrote", () => {
    // The visitor sent "6.6.6.6"; the host's proxy appended the real address.
    expect(forwardedClient("6.6.6.6, 198.51.100.4", trustedProxyCount({ TRUSTED_PROXIES: "1" }))).toBe("198.51.100.4");
    expect(forwardedClient("6.6.6.6, 198.51.100.4, 10.0.0.9", 2)).toBe("198.51.100.4");
    // More trusted proxies than entries: the setting doesn't match the host, so there's no safe answer.
    expect(forwardedClient("6.6.6.6", 2)).toBe("unknown");
    expect(forwardedClient("", 3)).toBe("unknown");
  });

  it("reads Fly-Client-IP when that's the header the host sets (hosted mode)", async () => {
    const c = await import("@/server/client");
    process.env.PANEL_MODE = "hosted";
    process.env.CLIENT_IP_HEADER = "Fly-Client-IP";
    try {
      expect(c.clientIp(new Headers({ "fly-client-ip": "198.51.100.4", "x-forwarded-for": "6.6.6.6" }))).toBe("198.51.100.4");
    } finally {
      delete process.env.CLIENT_IP_HEADER;
      delete process.env.PANEL_MODE;
    }
  });
});

describe("starting Panel", () => {
  // Run in an empty folder with a bare environment, so no .env file or setting of this computer's is read.
  const run = (args: string[], env: Record<string, string>) => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "panel-start-"));
    return { cwd, ...spawnSync(process.execPath, args, { cwd, env: { PATH: process.env.PATH ?? "", NODE_ENV: "production", ...env }, encoding: "utf8", timeout: 60_000 }) };
  };
  const missingAll = /These settings are missing:\n {2}- NEXT_PUBLIC_SUPABASE_URL\n {2}- NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY\n {2}- SUPABASE_SECRET_KEY\n {2}- DATABASE_URL\n {2}- HOSTED_PUBLIC_URL\n {2}- KEY_ENCRYPTION_SECRET\n {2}- MEDIA_SECRET\n {2}- STRIPE_SECRET_KEY\n {2}- STRIPE_WEBHOOK_SECRET\n {2}- CLIENT_IP_HEADER \(or TRUSTED_PROXIES\)/;

  it("stops npm start before the built-in database starts, naming what's missing", () => {
    const r = run([path.join(ROOT, "scripts", "start.mjs")], { PANEL_MODE: "hosted" });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(missingAll);
    expect(fs.existsSync(path.join(r.cwd, "data", "pg"))).toBe(false);
  });

  it("stops npm run dev the same way", () => {
    const r = run([path.join(ROOT, "scripts", "dev.mjs")], { PANEL_MODE: "hosted", NODE_ENV: "development" });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(missingAll);
    expect(fs.existsSync(path.join(r.cwd, "data", "pg"))).toBe(false);
  });

  it("refuses an unknown mode", () => {
    const r = run([path.join(ROOT, "scripts", "start.mjs")], { PANEL_MODE: "prod" });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('PANEL_MODE is "prod", but it can only be "local" or "hosted"');
  });

  it("starts nothing without Node's own server: no server.mjs or worker is left to run", () => {
    expect(fs.existsSync(path.join(ROOT, "server.mjs"))).toBe(false);
    expect(fs.existsSync(path.join(ROOT, "worker"))).toBe(false);
    const scripts = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")).scripts as Record<string, string>;
    expect(Object.values(scripts).join("\n")).not.toMatch(/server\.mjs|worker/);
    expect(scripts.dev).toBe("node scripts/dev.mjs");
    expect(scripts.start).toBe("node scripts/start.mjs");
    expect(scripts.build).toBe("next build");
  });
});

describe("the startup check inside the server (src/instrumentation.ts)", () => {
  /** Runs bootServer(env) with a process.exit that throws instead of exiting, and reports what it printed. */
  async function boot(env: Record<string, string>) {
    const exit = vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Error(`exit ${code}`);
    }) as never);
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const { bootServer } = await import("@/server/boot");
      const result = await bootServer(env).then(() => "started", (e: Error) => e.message);
      return { result, printed: err.mock.calls.map((c) => String(c[0])).join("\n"), exited: exit.mock.calls.map((c) => c[0]) };
    } finally {
      exit.mockRestore();
      err.mockRestore();
    }
  }

  it("exits with the list of what's missing when hosted mode isn't set up", async () => {
    const r = await boot({ PANEL_MODE: "hosted" });
    expect(r.result).toBe("exit 1");
    expect(r.exited).toEqual([1]);
    expect(r.printed).toMatch(/Panel can't start in hosted mode/);
    expect(r.printed).toMatch(/- MEDIA_SECRET/);
    expect(r.printed).toMatch(/- CLIENT_IP_HEADER \(or TRUSTED_PROXIES\)/);
  });

  it("exits on an unknown mode, and when hosted mode has neither CLIENT_IP_HEADER nor TRUSTED_PROXIES", async () => {
    expect((await boot({ PANEL_MODE: "prod" })).printed).toContain('PANEL_MODE is "prod"');
    const r = await boot(without("CLIENT_IP_HEADER") as Record<string, string>);
    expect(r.exited).toEqual([1]);
    expect(r.printed).toMatch(/These settings are missing:\n {2}- CLIENT_IP_HEADER \(or TRUSTED_PROXIES\)/);
  });

  it("is run by register() in the server, but not during `next build` (which has no secrets) or in the edge runtime", async () => {
    const saved = { ...process.env };
    const exit = vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Error(`exit ${code}`);
    }) as never);
    try {
      const { register } = await import("@/instrumentation");
      Object.assign(process.env, { PANEL_MODE: "hosted", NEXT_RUNTIME: "nodejs", NEXT_PHASE: "phase-production-build" });
      await expect(register()).resolves.toBeUndefined();
      Object.assign(process.env, { NEXT_RUNTIME: "edge", NEXT_PHASE: "phase-production-server" });
      await expect(register()).resolves.toBeUndefined();
      expect(exit).not.toHaveBeenCalled();
      // In the server it checks: hosted mode with nothing set stops the server.
      Object.assign(process.env, { NEXT_RUNTIME: "nodejs" });
      for (const k of Object.keys(HOSTED)) if (k !== "PANEL_MODE") delete process.env[k];
      vi.spyOn(console, "error").mockImplementation(() => {});
      await expect(register()).rejects.toThrow("exit 1");
    } finally {
      vi.restoreAllMocks();
      for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
      Object.assign(process.env, saved);
    }
  });
});

describe("one public address in hosted mode", () => {
  const origin = "http://localhost:3000";
  it("sends page visits at another address for the same server to the public one", () => {
    expect(canonicalLocation("GET", "/login?next=%2F", "127.0.0.1:3000", origin)).toBe("http://localhost:3000/login?next=%2F");
    expect(canonicalLocation("GET", "/auth/callback?code=x", "127.0.0.1:3000", origin)).toBe("http://localhost:3000/auth/callback?code=x");
    expect(canonicalLocation("HEAD", "/", "panel.fly.dev", "https://panel.example.com")).toBe("https://panel.example.com/");
  });
  it("leaves the public address, API calls, the health check, Next's files and local mode alone", () => {
    expect(canonicalLocation("GET", "/", "localhost:3000", origin)).toBeNull();
    expect(canonicalLocation("GET", "/", "LOCALHOST:3000", origin)).toBeNull();
    expect(canonicalLocation("GET", "/api/health", "10.0.0.5:3000", origin)).toBeNull();
    expect(canonicalLocation("POST", "/login", "127.0.0.1:3000", origin)).toBeNull();
    expect(canonicalLocation("GET", "/_next/static/x.js", "127.0.0.1:3000", origin)).toBeNull();
    expect(canonicalLocation("GET", "//evil.example/", "127.0.0.1:3000", origin)).toBeNull();
    expect(canonicalLocation("GET", "/", "127.0.0.1:3000", null)).toBeNull();
  });
});
