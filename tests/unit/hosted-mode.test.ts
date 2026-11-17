/**
 * Hosted mode (PANEL_MODE=hosted): which mode is chosen, what it needs before it starts,
 * where it listens, and how it reads visitors' addresses behind a proxy. Local mode must
 * behave exactly as it always has.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import {
  checkStartup,
  hostedProblems,
  listenAddress,
  parseEnvFile,
  parseMode,
  peerAddress,
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
      "CLIENT_IP_HEADER (or TRUSTED_PROXIES)",
    ]);
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
        "Set them in your host's environment (on Fly: fly secrets set NAME=value). The hosted section of .env.example explains each one.",
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
  it("ignores X-Forwarded-For unless proxies are trusted", () => {
    expect(trustedProxyCount({})).toBe(0);
    expect(peerAddress("6.6.6.6", "203.0.113.9", 0)).toBe("203.0.113.9");
    expect(peerAddress(undefined, "203.0.113.9", 0)).toBe("203.0.113.9");
  });

  it("takes the address the nearest trusted proxy saw, never one the visitor wrote", () => {
    // The visitor sent "6.6.6.6"; Fly's proxy appended the real address.
    expect(peerAddress("6.6.6.6, 198.51.100.4", "172.16.0.2", trustedProxyCount({ TRUSTED_PROXIES: "1" }))).toBe("198.51.100.4");
    // More trusted proxies than entries: the leftmost, not something past the end.
    expect(peerAddress("", "172.16.0.2", 3)).toBe("172.16.0.2");
  });

  it("reads Fly-Client-IP when that's the header the host sets", async () => {
    const c = await import("@/server/client");
    process.env.CLIENT_IP_HEADER = "Fly-Client-IP";
    try {
      expect(c.clientIp(new Headers({ "fly-client-ip": "198.51.100.4", "x-forwarded-for": "6.6.6.6" }))).toBe("198.51.100.4");
    } finally {
      delete process.env.CLIENT_IP_HEADER;
    }
  });
});

describe("starting Panel", () => {
  // Run in an empty folder with a bare environment, so no .env file or setting of this computer's is read.
  const run = (args: string[], env: Record<string, string>) => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "panel-start-"));
    return { cwd, ...spawnSync(process.execPath, args, { cwd, env: { PATH: process.env.PATH ?? "", NODE_ENV: "production", ...env }, encoding: "utf8", timeout: 60_000 }) };
  };
  const missingAll = /These settings are missing:\n {2}- NEXT_PUBLIC_SUPABASE_URL\n {2}- NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY\n {2}- SUPABASE_SECRET_KEY\n {2}- DATABASE_URL\n {2}- HOSTED_PUBLIC_URL\n {2}- CLIENT_IP_HEADER \(or TRUSTED_PROXIES\)/;

  it("stops the website, naming what's missing", () => {
    const r = run([path.join(ROOT, "server.mjs")], { PANEL_MODE: "hosted" });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(missingAll);
  });

  it("stops npm start before the built-in database starts", () => {
    const r = run([path.join(ROOT, "scripts", "start.mjs")], { PANEL_MODE: "hosted" });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(missingAll);
    expect(fs.existsSync(path.join(r.cwd, "data", "pg"))).toBe(false);
  });

  it("stops the worker too", () => {
    const tsx = pathToFileURL(path.join(ROOT, "node_modules", "tsx", "dist", "loader.mjs")).href;
    const r = run(["--import", tsx, path.join(ROOT, "worker", "index.mts")], { PANEL_MODE: "hosted", TSX_TSCONFIG_PATH: path.join(ROOT, "tsconfig.json") });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(missingAll);
  });

  it("refuses an unknown mode", () => {
    const r = run([path.join(ROOT, "server.mjs")], { PANEL_MODE: "prod" });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('PANEL_MODE is "prod", but it can only be "local" or "hosted"');
  });
});
