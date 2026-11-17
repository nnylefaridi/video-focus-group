import { expect, test } from "@playwright/test";

const hasKey = Boolean(process.env.ANTHROPIC_API_KEY);

test("the first screen is only the first question and its answer box", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => sessionStorage.clear());
  await page.reload();
  const main = page.locator("main");
  await expect(main.getByRole("heading", { level: 1 })).toHaveText("What's the video you're making?");
  await expect(main.getByRole("textbox")).toHaveCount(1);
  // The only other control is the answer box's own send button.
  await expect(main.getByRole("button")).toHaveCount(1);
  await expect(main.getByRole("button", { name: "Continue" })).toBeDisabled();
  // No links at all, not even the Buy me a coffee tag, and not in the server's HTML either.
  await expect(page.getByRole("link")).toHaveCount(0);
  await expect(page.locator("header, footer, nav")).toHaveCount(0);
  expect(await (await page.request.get("/")).text()).not.toContain("buymeacoffee.com");
});

test("the Buy me a coffee tag is on every screen after the first", async ({ page }) => {
  await page.goto("/reviews");
  await expect(page.getByRole("link", { name: "Buy me a coffee" })).toHaveAttribute("href", "https://buymeacoffee.com/nylefaridi");
});

test("privacy and terms are plain pages, and local mode has no account page", async ({ page }) => {
  for (const [path, heading] of [["/privacy", "Privacy"], ["/terms", "Terms"]]) {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(heading);
    await expect(page.locator("main")).toContainText("Video Focus Group");
  }
  // No accounts on your own computer: /account goes to the reviews list.
  await page.goto("/account");
  await expect(page).toHaveURL(/\/reviews$/);
  await expect(page.getByRole("link", { name: "Your account" })).toHaveCount(0);
});

test("suggestions appear only once the answer box is clicked", async ({ page, isMobile }) => {
  await page.goto("/");
  await expect(page.getByRole("button", { name: "A comedy skit for TikTok" })).toHaveCount(0);
  if (isMobile) await page.getByRole("textbox").tap();
  else await page.getByRole("textbox").click();
  await page.getByRole("button", { name: "A comedy skit for TikTok" }).click();
  await expect(page.getByRole("textbox")).toHaveValue("A comedy skit for TikTok");
});

test("submitting the first answer either moves on or explains what's missing", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => sessionStorage.clear());
  await page.reload();
  await page.getByRole("textbox").fill("A 40 second comedy skit for TikTok where my cat judges my cooking");
  await page.getByRole("button", { name: "Continue" }).click();
  if (hasKey) {
    await expect(page.getByRole("heading", { level: 1 })).not.toHaveText("What's the video you're making?", { timeout: 30_000 });
  } else {
    await expect(page.locator("main").getByRole("alert")).toContainText("ANTHROPIC_API_KEY is not set");
  }
});

test("every reviewer has a profile page with sourced ideas", async ({ page, request }) => {
  for (const id of ["alex-hormozi", "mrbeast", "jerry-seinfeld", "steve-martin", "casey-neistat", "mark-rober", "dan-harmon", "gary-vaynerchuk", "david-ogilvy", "donald-miller", "simon-sinek", "russell-brunson"]) {
    const res = await request.get(`/reviewers/${id}`);
    expect(res.status(), id).toBe(200);
  }
  await page.goto("/reviewers/jerry-seinfeld");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Jerry Seinfeld");
  await expect(page.getByRole("heading", { name: "Documented ideas they review with" })).toBeVisible();
  expect(await page.locator("section a[href^='http']").count()).toBeGreaterThan(3);
  await page.getByRole("link", { name: "Back" }).click();
  await expect(page).toHaveURL("/");
});

test("the reviews list and unknown pages render", async ({ page }) => {
  await page.goto("/reviews");
  await expect(page.getByRole("heading", { name: "Your reviews" })).toBeVisible();
  await page.getByRole("link", { name: "New review" }).click();
  await expect(page).toHaveURL("/");
  await page.goto("/r/AAAAAAAAAAAAAAAA");
  await expect(page.getByRole("heading", { name: "This review doesn't exist" })).toBeVisible();
  await page.goto("/nope");
  await expect(page.getByRole("heading", { name: "There's nothing here" })).toBeVisible();
});

test("APIs refuse bad input and unsigned media", async ({ request }) => {
  expect((await request.get("/api/media/AAAAAAAAAAAAAAAA/video.mp4")).status()).toBe(403);
  expect((await request.get("/api/reviews/AAAAAAAAAAAAAAAA")).status()).toBe(404);
  expect((await request.put("/api/reviews/AAAAAAAAAAAAAAAA/video", { data: "x" })).status()).toBe(404);
  expect((await request.post("/api/interpret", { data: { nope: 1 } })).status()).toBe(400);
  const board = await request.post("/api/board", { data: { category: "creator", isComedy: true, format: "skit", reactions: ["laugh"] } });
  const { picks } = await board.json();
  expect(picks.map((p: { id: string }) => p.id)).toContain("jerry-seinfeld");
  const ad = await (await request.post("/api/board", { data: { category: "ad", goal: "conversion", offerType: "course_or_coaching" } })).json();
  expect(ad.picks.map((p: { id: string }) => p.id)).toContain("alex-hormozi");
  const create = await request.post("/api/reviews", { data: { answers: [], board: ["mrbeast"] } });
  expect(create.status()).toBe(hasKey ? 400 : 503);
});

test("a finished review opens as a paper puppet boardroom", async ({ page, request }) => {
  const list = await request.get("/api/reviews");
  // With accounts on, the list needs a signed-in browser; in local mode it lists everything.
  test.skip(list.status() === 401, "Accounts are on and this test browser isn't signed in");
  const { reviews } = await list.json();
  const done = (reviews as { id: string; stage: string; board: string[] }[]).find((r) => r.stage === "done");
  test.skip(!done, "No finished review in this install yet");
  await page.goto(`/r/${done!.id}`);
  // One puppet per board member, each a separate cutout on a stick, plus a flat video player.
  await expect(page.locator(`button[aria-label^="Ask "]`).first()).toBeVisible();
  await expect(page.locator("button[aria-label^='Ask ']")).toHaveCount(done!.board.length);
  const video = page.locator("video");
  await expect(video).toBeVisible();
  const transform = await video.evaluate((v) => getComputedStyle(v.parentElement!.parentElement!).transform);
  expect(transform === "none" || transform === "matrix(1, 0, 0, 1, 0, 0)").toBe(true);
  await expect(page.getByRole("button", { name: /discussion/i }).first()).toBeVisible();
  // Every section opens.
  for (const name of ["Video Analysis", "Discussion", "Revision Plan", "The Board"]) {
    await page.getByRole("button", { name, exact: true }).first().click();
  }
  await page.getByRole("button", { name: "Revision Plan", exact: true }).first().click();
  await expect(page.getByRole("heading", { name: "Revision plan" })).toBeVisible();
});

test("a large prepared video reaches the server whole (not cut off at 10 MB)", async ({ request }) => {
  test.skip(!hasKey, "Starting a review needs ANTHROPIC_API_KEY");
  // Sends 20 MB to this computer's upload address and checks every byte arrived. Nothing is
  // processed or spent: the review never gets its manifest.
  const answers = [
    { questionId: "what", display: "A comedy skit", fields: { category: "creator", format: "skit", isComedy: true, summary: "A comedy skit", platforms: ["tiktok"], reactions: ["laugh"], niche: "comedy", audience: "students" } },
    { questionId: "punchline", display: "Skipped", fields: {}, skipped: true },
    { questionId: "unsure", display: "Skipped", fields: {}, skipped: true },
    { questionId: "stage", display: "Growing", fields: { accountStage: "growing" } },
  ];
  const created = await request.post("/api/reviews", { data: { answers, board: ["jerry-seinfeld"] } });
  test.skip(created.status() === 401, "Accounts are on and this test browser isn't signed in");
  expect(created.status()).toBe(200);
  const { id } = await created.json();
  const size = 20 * 1024 * 1024;
  const up = await request.put(`/api/reviews/${id}/files/video.mp4`, { data: Buffer.alloc(size, 7), headers: { "content-type": "video/mp4" } });
  expect(await up.json()).toEqual({ ok: true, bytes: size });
  await request.delete(`/api/reviews/${id}`);
});
