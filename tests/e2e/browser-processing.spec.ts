/**
 * A real vertical video (tests/fixtures/vertical-8s.mov: 1080×1920 H.264/AAC, 8 s, cuts at 3.0
 * and 5.5 s, speech from 1 to 3.5 s) is picked in the upload step. The browser makes the 720p
 * copy, poster, frames, sprite sheets and transcript, sends them, and the server checks them and
 * builds the evidence. The test stops at the first Claude call, which a local stand-in answers
 * with "overloaded", so nothing is paid for. Run with `npm run e2e:browser`.
 */
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { inspectMp4, mp4Problems } from "../../src/media/mp4";

const FAKE_CLAUDE_PORT = 3299;
const VIDEO = path.resolve("tests/fixtures/vertical-8s.mov");
const calls: string[] = [];
let fake: http.Server;

test.beforeAll(async () => {
  fake = http.createServer((req, res) => {
    calls.push(`${req.method} ${req.url}`);
    req.resume();
    res.writeHead(529, { "content-type": "application/json" });
    res.end(JSON.stringify({ type: "error", error: { type: "overloaded_error", message: "Overloaded (test stand-in)" } }));
  });
  await new Promise<void>((r) => fake.listen(FAKE_CLAUDE_PORT, "127.0.0.1", r));
});
test.afterAll(() => new Promise<void>((r) => fake.close(() => r())));

const answers = [
  { questionId: "what", display: "A comedy skit", fields: { category: "creator", format: "skit", isComedy: true, summary: "A comedy skit", platforms: ["tiktok"], reactions: ["laugh"], niche: "comedy", audience: "students" } },
  { questionId: "punchline", display: "Skipped", fields: {}, skipped: true },
  { questionId: "unsure", display: "Skipped", fields: {}, skipped: true },
  { questionId: "stage", display: "Growing", fields: { accountStage: "growing" } },
];

test("the browser prepares a real video and the server accepts it, up to the first Claude call", async ({ page }) => {
  const dataDir = path.join(os.tmpdir(), "panel-e2e-browser");
  await page.addInitScript((saved) => {
    if (!sessionStorage.getItem("panel.flow.v1")) sessionStorage.setItem("panel.flow.v1", saved);
  }, JSON.stringify({ answers, step: "upload", board: ["jerry-seinfeld"], editing: null }));
  const phases: string[] = [];
  page.on("console", (m) => m.type() === "error" && console.log("[browser]", m.text()));
  page.on("requestfailed", (r) => console.log("[failed]", r.method(), r.url().slice(0, 120), r.failure()?.errorText));
  page.on("response", async (r) => {
    if (r.status() >= 400) console.log("[http]", r.status(), r.request().method(), r.url().slice(0, 120), (await r.text().catch(() => "")).slice(0, 200));
  });
  await page.goto("/");
  const input = page.locator('input[type="file"]');
  await expect(input).toBeAttached();
  await input.setInputFiles(VIDEO);

  // Each phase the person sees, in order, until the review page opens.
  for (const text of [/Preparing your video on this device/, /Finding cuts and pulling frames/, /Listening for speech|speech reader/, /Sending it/]) {
    await expect(page.getByText(text).first()).toBeVisible({ timeout: 300_000 });
    phases.push(String(text));
  }
  await page.waitForURL(/\/r\/[A-Za-z0-9_-]+$/, { timeout: 300_000 });
  const id = page.url().split("/r/")[1];

  // The server checked the files and built the evidence, then made its first Claude call.
  await expect.poll(() => calls.some((c) => c.startsWith("POST /v1/messages")), { timeout: 240_000, intervals: [1000] }).toBe(true);

  const dir = path.join(dataDir, "media", id);
  const files = fs.readdirSync(dir);
  expect(files).toEqual(expect.arrayContaining(["video.mp4", "poster.jpg", "captions.vtt", "frames"]));
  const mp4 = inspectMp4(new Uint8Array(fs.readFileSync(path.join(dir, "video.mp4"))));
  if (!mp4.ok) throw new Error(mp4.reason);
  expect(mp4.info).toMatchObject({ width: 720, height: 1280 });
  expect(mp4.info.durationSec).toBeGreaterThan(7.5);
  expect(mp4.info.durationSec).toBeLessThan(8.5);
  expect(mp4Problems(mp4.info)).toEqual([]);
  expect(fs.readdirSync(path.join(dir, "frames")).filter((f) => f.endsWith(".jpg")).length).toBeGreaterThan(5);

  const res = await page.request.get(`/api/reviews/${id}`);
  expect(res.status()).toBe(200);
  const review = await res.json();
  expect(review.video).toMatchObject({ width: 720, height: 1280, hasAudio: true });
  // The words come from the speech model, whatever it heard; at least one is there, with its time.
  const vtt = fs.readFileSync(path.join(dir, "captions.vtt"), "utf8");
  console.log("captions:", vtt.replace(/\s+/g, " ").slice(0, 300));
  console.log("Claude calls:", calls.length, "phases:", phases.length);
  expect(vtt).toMatch(/\d\d:\d\d\.\d{3} --> /);
});
