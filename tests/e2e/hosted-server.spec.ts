import http from "node:http";
import { expect, test } from "@playwright/test";

/**
 * Hosted mode on Next.js's real server, started by playwright.hosted.config.ts
 * (`npm run e2e:hosted`). It checks what only the real adapter does: a page visit at another
 * address is redirected to HOSTED_PUBLIC_URL, with the Location as written. Next's adapter
 * rewrites a Location it considers "the same host" into a relative one, and counts 127.0.0.1 as
 * localhost, so without `skipProxyUrlNormalize` this redirect looped.
 */
const PORT = 3100;

/** A plain HTTP request with any Host header (fetch and the browser won't let a test choose it). */
function request(path: string, host: string, method = "GET", headers: Record<string, string> = {}) {
  return new Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }>((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port: PORT, path, method, headers: { host, ...headers } }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (c) => (body += c));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }));
    });
    req.on("error", reject);
    req.end();
  });
}

test("a page visit at 127.0.0.1 is sent to the public address, as an absolute 307", async () => {
  const res = await request("/login?next=%2F", `127.0.0.1:${PORT}`);
  expect(res.status).toBe(307);
  expect(res.headers.location).toBe(`http://localhost:${PORT}/login?next=%2F`);
  expect(res.headers["cache-control"]).toBe("no-store");
});

test("the public address itself isn't redirected", async () => {
  const res = await request("/login", `localhost:${PORT}`);
  expect(res.status).not.toBe(307);
  expect(res.headers.location).toBeUndefined();
  // Same for the address with the letters in another case.
  expect((await request("/login", `LOCALHOST:${PORT}`)).headers.location).toBeUndefined();
});

test("a proxy that forwards the public host isn't sent in circles", async () => {
  const res = await request("/login", `10.0.0.5:${PORT}`, "GET", { "x-forwarded-host": `localhost:${PORT}` });
  expect(res.headers.location).toBeUndefined();
});

test("the health check answers at any address, with nothing redirected", async () => {
  for (const host of [`127.0.0.1:${PORT}`, `localhost:${PORT}`, `panel-x1.onrender.com`]) {
    const res = await request("/api/health", host);
    expect(res.status, host).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ ok: true });
    expect(res.headers.location).toBeUndefined();
  }
});

test("other API calls and non-GET requests aren't redirected either", async () => {
  const api = await request("/api/reviews", `127.0.0.1:${PORT}`);
  expect(api.headers.location).toBeUndefined();
  const post = await request("/login", `127.0.0.1:${PORT}`, "POST");
  expect(post.headers.location).toBeUndefined();
});
