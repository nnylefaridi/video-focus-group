/**
 * Deploy config: the health check answers without settings or a database, the proxy leaves it
 * alone, and the Dockerfile / fly.toml / .dockerignore keep the promises docs/hosting.md makes.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/server", async (importOriginal) => ({ ...(await importOriginal<typeof import("next/server")>()), connection: async () => {} }));
// Waking the runner is covered in runner.test.ts; here it must only be asked for, after the answer.
const kick = vi.hoisted(() => vi.fn());
vi.mock("@/server/kick", () => ({ kickAfterResponse: kick }));

const read = (f: string) => fs.readFileSync(path.join(process.cwd(), f), "utf8");

describe("GET /api/health", () => {
  it("says ok, uncached, with nothing configured", async () => {
    const { GET } = await import("@/app/api/health/route");
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("wakes the review runner once it has answered, so a host that slept resumes unfinished reviews", async () => {
    kick.mockClear();
    const { GET } = await import("@/app/api/health/route");
    await GET();
    expect(kick).toHaveBeenCalledTimes(1);
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
    // Docker sets HOSTNAME to the container's id, which server.js would listen on, so it's set explicitly.
    expect(docker).toMatch(/HOSTNAME=0\.0\.0\.0/);
    expect(docker).toContain("PORT=8080");
  });

  it("builds and runs Next.js's standalone server.js, with no separate worker or custom server", () => {
    expect(docker).toMatch(/PANEL_STANDALONE=1/);
    expect(docker).toContain("/app/.next/standalone");
    expect(docker).toContain("/app/.next/static");
    expect(docker).toMatch(/^CMD \["node", "server\.js"\]$/m);
    expect(docker).not.toMatch(/server\.mjs|worker\/index|--import tsx/);
    expect(fs.existsSync(path.join(process.cwd(), "server.mjs"))).toBe(false);
  });

  it("sets output: standalone only for that build, and keeps what is read with fs in the trace", () => {
    const config = read("next.config.ts");
    expect(config).toMatch(/output: process\.env\.PANEL_STANDALONE === "1" \? "standalone" : undefined/);
    expect(config).toContain("./src/experts/profiles/**");
    expect(config).toContain("./supabase/migrations/**");
    expect(config).toMatch(/skipProxyUrlNormalize: true/);
  });

  it("passes only the public Supabase settings as build arguments", () => {
    const args = [...docker.matchAll(/^ARG (\w+)/gm)].map((m) => m[1]);
    expect(args.filter((a) => !a.startsWith("WHISPER_"))).toEqual(["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"]);
  });

  it("gives the one process a public, health-checked service, with no worker process group", () => {
    expect(fly).toMatch(/internal_port = 8080/);
    expect(fly).toMatch(/force_https = true/);
    expect(fly).toMatch(/path = "\/api\/health"/);
    expect(fly).toMatch(/CLIENT_IP_HEADER = "Fly-Client-IP"/);
    expect(fly).not.toMatch(/^\[processes\]/m);
    expect(fly.replace(/^\s*#.*$/gm, "")).not.toMatch(/worker/);
    expect(fly.match(/^\[http_service\]/gm)).toHaveLength(1);
    expect(fly.match(/^\[\[vm\]\]/gm)).toHaveLength(1);
  });

  it("keeps the machine on while a review runs inside it with nobody visiting", () => {
    expect(fly).toMatch(/auto_stop_machines = "off"/);
    expect(fly).toMatch(/min_machines_running = 1/);
  });

  it("keeps secrets and local data out of the image, and public/ in", () => {
    for (const x of [".env", ".env.*", "data/", "node_modules", "*.mp4"]) expect(ignore).toContain(x);
    expect(ignore).not.toContain("public");
    expect(ignore).not.toContain("src");
  });
});
