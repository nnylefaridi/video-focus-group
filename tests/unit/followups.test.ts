/**
 * Follow-up questions whose answer never came: a failed reviewer call marks the question failed
 * at once; a server that stopped mid-answer leaves it "answering", which reads as failed after
 * ANSWER_STALE_MS and is marked failed by the runner's maintenance. Failed questions are left out
 * of what the reviewer is shown next time. Runs the real chat route against an in-process
 * Postgres with the reviewer's model call replaced (nothing is sent anywhere).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const ANON = "b".repeat(32);
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => (name === "panel_anon" ? { value: ANON } : undefined), getAll: () => [], set: () => {} }),
}));
vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), connection: async () => {} }));
const model = vi.hoisted(() => ({ fail: false, seen: [] as unknown[] }));
vi.mock("@/ai/followup", async (orig) => ({
  ...(await orig<typeof import("@/ai/followup")>()),
  async *streamText(opts: { messages: unknown[] }) {
    model.seen.push(structuredClone(opts.messages));
    if (model.fail) throw new Error("model call failed (test)");
    yield { type: "text", text: "Tighten the opening." };
    yield { type: "final", message: { stop_reason: "end_turn", content: [] } };
  },
}));

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "panel-followups-"));
process.env.ANTHROPIC_API_KEY = "sk-ant-test-not-a-real-key";
process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_test";

let chat: typeof import("@/app/api/reviews/[id]/chat/route");
let followups: typeof import("@/server/followups");
let reviews: typeof import("@/server/reviews");
let db: typeof import("@/server/db");
let id: string;

const ledger = {
  shots: [],
  frames: [],
  transcript: [],
  audio: [],
  speechRate: [],
  loudness: [],
  perception: [],
  coverage: { durationSec: 8, width: 720, height: 1280, framesAnalyzed: 0, sampling: "", transcript: "no_speech_detected", notes: [] },
};

beforeAll(async () => {
  chat = await import("@/app/api/reviews/[id]/chat/route");
  followups = await import("@/server/followups");
  reviews = await import("@/server/reviews");
  db = await import("@/server/db");
});

beforeEach(async () => {
  model.fail = false;
  model.seen.length = 0;
  id = reviews.newReviewId();
  await reviews.createReview({ id, answers: [], intent: { category: "creator" }, board: ["jerry-seinfeld"], title: "test", anonId: ANON });
  await reviews.updateReview(id, { stage: "done", ledger: ledger as never });
});

async function ask(message: string) {
  const res = await chat.POST(new Request(`http://localhost/api/reviews/${id}/chat`, { method: "POST", body: JSON.stringify({ reviewerId: "jerry-seinfeld", message }) }), {
    params: Promise.resolve({ id }),
  } as never);
  expect(res.status).toBe(200);
  return (await res.text()).trim().split("\n").map((l) => JSON.parse(l));
}
const thread = () => followups.getThread(id, "jerry-seinfeld");

describe("follow-up questions that never got an answer", () => {
  it("an answered question has no state", async () => {
    const events = await ask("Is the opening too slow?");
    expect(events.at(-1)).toMatchObject({ type: "done", text: "Tighten the opening." });
    expect((await thread()).map((m) => [m.role, m.state ?? null])).toEqual([["user", null], ["assistant", null]]);
  });

  it("a failed reviewer call marks the question failed, and it's left out next time", async () => {
    model.fail = true;
    expect((await ask("First question")).at(-1)).toMatchObject({ type: "error" });
    expect((await thread())[0]).toMatchObject({ role: "user", text: "First question", state: "failed" });
    model.fail = false;
    await ask("Second question");
    // The reviewer sees only the new question, not the unanswered one before it.
    expect(model.seen.at(-1)).toEqual([{ role: "user", content: "Second question" }]);
  });

  it("a question left by a stopped server reads as failed after the cut-off, and maintenance marks it", async () => {
    await followups.addMessage(id, "jerry-seinfeld", "user", "Asked just before a restart");
    const [fresh] = await thread();
    expect(fresh.state).toBe("answering");
    // Still within the time an answer can take: left alone.
    expect(await followups.failHangingQuestions()).toBe(0);
    const later = Date.now() + followups.ANSWER_STALE_MS + 1000;
    expect((await followups.getThread(id, "jerry-seinfeld", later))[0].state).toBe("failed");
    expect(await followups.failHangingQuestions(followups.ANSWER_STALE_MS, later)).toBe(1);
    const [row] = await db.q<{ content: string; status: string }>("SELECT content, status FROM app.followups WHERE review_id = $1", [id]);
    expect(row.status).toBe("failed");
    expect(JSON.parse(row.content)).toEqual({ text: "Asked just before a restart" });
    expect(followups.answeredOnly(await thread())).toEqual([]);
  });
});
