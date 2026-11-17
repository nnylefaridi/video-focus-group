/**
 * Hosted mode has one public address. The proxy sends page visits at any other address
 * (127.0.0.1 vs localhost, the host's own name) to it with a 307, and leaves everything else
 * alone. The real Next.js adapter, which can rewrite a Location it thinks is "the same host",
 * is covered by tests/e2e/hosted-server.spec.ts; this covers the proxy's own decisions and the
 * config that stops that rewriting.
 */
import fs from "node:fs";
import path from "node:path";
import { NextRequest } from "next/server";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

// With Supabase unset the proxy does nothing but the redirect, so no session code runs here.
delete process.env.NEXT_PUBLIC_SUPABASE_URL;
delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

let proxy: typeof import("@/proxy");

beforeAll(async () => {
  proxy = await import("@/proxy");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

function hosted(publicUrl = "http://localhost:3000") {
  vi.stubEnv("PANEL_MODE", "hosted");
  vi.stubEnv("HOSTED_PUBLIC_URL", publicUrl);
}

const get = (url: string, headers: Record<string, string> = {}, method = "GET") => new NextRequest(url, { method, headers });

describe("sending page visits to the one public address", () => {
  it("redirects 127.0.0.1 to localhost with a 307 that keeps the path and query, uncached", async () => {
    hosted();
    const res = await proxy.proxy(get("http://127.0.0.1:3000/login?next=%2F", { host: "127.0.0.1:3000" }));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("http://localhost:3000/login?next=%2F");
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("redirects the host's own name to the public one", async () => {
    hosted("https://panel.example.com");
    const res = await proxy.proxy(get("https://panel-x1.onrender.com/reviews", { host: "panel-x1.onrender.com" }));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("https://panel.example.com/reviews");
    expect((await proxy.proxy(get("https://panel-x1.onrender.com/", { host: "panel-x1.onrender.com" }, "HEAD"))).status).toBe(307);
  });

  it("doesn't redirect the public address itself, in any letter case", async () => {
    hosted();
    for (const host of ["localhost:3000", "LOCALHOST:3000"]) {
      const res = await proxy.proxy(get("http://localhost:3000/login", { host }));
      expect(res.headers.get("location")).toBeNull();
      expect(res.status).toBe(200);
    }
  });

  it("doesn't redirect when the host's proxy rewrote Host but forwarded the address the visitor used", async () => {
    hosted("https://panel.example.com");
    const res = await proxy.proxy(get("http://10.0.0.5:10000/login", { host: "10.0.0.5:10000", "x-forwarded-host": "panel.example.com" }));
    expect(res.headers.get("location")).toBeNull();
    // ...and a forwarded host that isn't the public one still goes there.
    const other = await proxy.proxy(get("http://10.0.0.5:10000/login", { host: "10.0.0.5:10000", "x-forwarded-host": "panel-x1.onrender.com" }));
    expect(other.status).toBe(307);
  });

  it("leaves API calls (including the health check), other methods and Next's files alone", async () => {
    hosted();
    for (const [url, method] of [
      ["http://127.0.0.1:3000/api/health", "GET"],
      ["http://127.0.0.1:3000/api/reviews", "GET"],
      ["http://127.0.0.1:3000/api/stripe/webhook", "POST"],
      ["http://127.0.0.1:3000/login", "POST"],
      ["http://127.0.0.1:3000/_next/static/chunk.js", "GET"],
    ] as const) {
      const res = await proxy.proxy(get(url, { host: "127.0.0.1:3000" }, method));
      expect(res.headers.get("location"), `${method} ${url}`).toBeNull();
    }
  });

  it("does nothing in local mode, even with HOSTED_PUBLIC_URL set", async () => {
    vi.stubEnv("PANEL_MODE", "");
    vi.stubEnv("HOSTED_PUBLIC_URL", "http://localhost:3000");
    const res = await proxy.proxy(get("http://127.0.0.1:3000/login", { host: "127.0.0.1:3000" }));
    expect(res.headers.get("location")).toBeNull();
  });

  it("doesn't redirect anywhere when HOSTED_PUBLIC_URL isn't a usable address (startup refuses that anyway)", async () => {
    hosted("not a url");
    expect((await proxy.proxy(get("http://127.0.0.1:3000/login", { host: "127.0.0.1:3000" }))).headers.get("location")).toBeNull();
  });

  it("is run for pages but not for the health check or Next's static files", () => {
    const re = new RegExp(`^${proxy.config.matcher[0]}$`);
    expect(re.test("/login")).toBe(true);
    expect(re.test("/api/health")).toBe(false);
    expect(re.test("/_next/static/x.js")).toBe(false);
  });
});

describe("next.config.ts", () => {
  it("has Next send the proxy's redirect as written", () => {
    const config = fs.readFileSync(path.join(process.cwd(), "next.config.ts"), "utf8");
    expect(config).toMatch(/skipProxyUrlNormalize: true/);
  });
});
