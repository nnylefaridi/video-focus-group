/**
 * Deploy config: the health check answers without settings or a database, the proxy leaves it
 * alone, and the Dockerfile / fly.toml / .dockerignore keep the promises docs/hosting.md makes.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/server", async (importOriginal) => ({ ...(await importOriginal<typeof import("next/server")>()), connection: async () => {} }));

const read = (f: string) => fs.readFileSync(path.join(process.cwd(), f), "utf8");

describe("GET /api/health", () => {
  it("says ok, uncached, with nothing configured", async () => {
    const { GET } = await import("@/app/api/health/route");
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("isn't run through the sign-in proxy", async () => {
    const { config } = await import("@/proxy");
    const re = new RegExp(`^${config.matcher[0]}$`);
    expect(re.test("/api/health")).toBe(false);
    expect(re.test("/account")).toBe(true);
  });
});

describe("Dockerfile, fly.toml and .dockerignore", () => {
  const docker = read("Dockerfile");
  const fly = read("fly.toml");
  const ignore = read(".dockerignore").split("\n");

  it("builds whisper.cpp from a pinned tag and checks the model's checksum", () => {
    expect(docker).toMatch(/ARG WHISPER_CPP_TAG=v\d+\.\d+\.\d+/);
    expect(docker).toMatch(/ARG WHISPER_MODEL_SHA1=[0-9a-f]{40}/);
    expect(docker).toContain("huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin");
    expect(docker).toContain("sha1sum -c -");
  });

  it("runs as a non-root user in hosted mode on 0.0.0.0:8080", () => {
    expect(docker).toMatch(/^USER node$/m);
    expect(docker).toContain("PANEL_MODE=hosted");
    expect(docker).toContain("HOST=0.0.0.0");
    expect(docker).toContain("PORT=8080");
  });

  it("passes only the public Supabase settings as build arguments", () => {
    const args = [...docker.matchAll(/^ARG (\w+)/gm)].map((m) => m[1]);
    expect(args.filter((a) => !a.startsWith("WHISPER_"))).toEqual(["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"]);
  });

  it("gives the website a public, health-checked service and the worker none", () => {
    expect(fly).toMatch(/internal_port = 8080/);
    expect(fly).toMatch(/force_https = true/);
    expect(fly).toMatch(/path = "\/api\/health"/);
    expect(fly).toMatch(/CLIENT_IP_HEADER = "Fly-Client-IP"/);
    expect(fly).toMatch(/app = "node server\.mjs"/);
    expect(fly).toMatch(/worker = "node --import tsx worker\/index\.mts"/);
    expect(fly).toMatch(/processes = \["app"\]\n\s+internal_port/);
    expect(fly.match(/^\[http_service\]/gm)).toHaveLength(1);
  });

  it("keeps secrets and local data out of the image, and public/ in", () => {
    for (const x of [".env", ".env.*", "data/", "node_modules", "*.mp4"]) expect(ignore).toContain(x);
    expect(ignore).not.toContain("public");
    expect(ignore).not.toContain("src");
  });
});
