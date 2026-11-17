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

test("signed out, the first screen asks how to pay, with the launch video playing and a Log in button", async ({ page }) => {
  await page.goto(`http://localhost:${PORT}/`);
  await expect(page.getByRole("heading", { name: "Make your videos WORK" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Pay as you go/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /Use your own Anthropic key/ })).toBeVisible();
  // No questions yet: the server checks answers only on the visitor's own key or credits.
  await expect(page.locator("main").getByRole("textbox")).toHaveCount(0);
  const video = page.locator("main video");
  await expect(video).toHaveAttribute("src", "/demo.mp4");
  expect(await video.evaluate((v: HTMLVideoElement) => v.muted && v.loop && v.autoplay && v.playsInline)).toBe(true);
  // It fits: nothing to scroll.
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollHeight <= window.innerHeight + 1)).toBe(true);
  const login = page.getByRole("link", { name: "Log in", exact: true });
  await expect(login).toHaveAttribute("href", "/login?next=/");
  await expect(login).toBeVisible();
  // The sound starts off (only silent video autoplays); one button turns it on.
  await page.getByRole("button", { name: "Sound on" }).click();
  expect(await video.evaluate((v: HTMLVideoElement) => v.muted)).toBe(false);
  await expect(page.getByRole("link")).toHaveCount(1);
  // Picking a way to pay signed out goes to log in first, and comes back here.
  await page.getByRole("button", { name: /Use your own Anthropic key/ }).click();
  await expect(page).toHaveURL(/\/login\?next=(%2F|\/)$/);
  expect(await page.evaluate(() => localStorage.getItem("panel.pay.intent.v1"))).toBe("own_key");
});

test("signed out, an answer check is refused without touching any key", async () => {
  const res = await new Promise<{ status: number; body: string }>((resolve, reject) => {
    const body = JSON.stringify({ questionId: "what", raw: "A skit about my cat", answers: [] });
    const r = http.request(
      { host: "127.0.0.1", port: PORT, path: "/api/interpret", method: "POST", headers: { host: `localhost:${PORT}`, "content-type": "application/json", "content-length": Buffer.byteLength(body) } },
      (res) => {
        let b = "";
        res.on("data", (c) => (b += c));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body: b }));
      },
    );
    r.on("error", reject);
    r.end(body);
  });
  expect(res.status).toBe(401);
  expect(JSON.parse(res.body)).toMatchObject({ payment: "choose" });
});
