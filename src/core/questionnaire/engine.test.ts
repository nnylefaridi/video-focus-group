import { describe, expect, it } from "vitest";
import { isComplete, nextQuestion, resolve, upsertAnswer, visibleQuestions, type Answer } from "./engine";

const a = (questionId: string, fields: Answer["fields"], display = "x"): Answer => ({ questionId, display, fields });

/** Answer every question the engine asks with the first option / a stock text, collecting ids. */
function walk(start: Answer[], pick: (qid: string) => Answer | null = () => null): { answers: Answer[]; asked: string[] } {
  let answers = start;
  const asked: string[] = [];
  for (let i = 0; i < 40; i++) {
    const q = nextQuestion(answers);
    if (!q) break;
    asked.push(q.id);
    const chosen =
      pick(q.id) ??
      (q.answer.kind === "choice" ? a(q.id, q.answer.options[0].set, q.answer.options[0].label) : a(q.id, Object.fromEntries(q.fills.map((k) => [k, "text"]))));
    answers = upsertAnswer(answers, chosen);
  }
  return { answers, asked };
}

describe("questionnaire engine", () => {
  it("starts with the open question and nothing else", () => {
    expect(nextQuestion([])?.id).toBe("what");
  });

  it("asks for the category only when the first answer didn't settle it", () => {
    expect(nextQuestion([a("what", { summary: "a video" })])?.id).toBe("category");
    expect(nextQuestion([a("what", { summary: "a skit", category: "creator" })])?.id).not.toBe("category");
  });

  it("never asks a comedy creator about offers, price, CTA or placement", () => {
    const { asked } = walk([a("what", { summary: "30s comedy skit about my cat for TikTok", category: "creator", isComedy: true, format: "skit" })]);
    for (const id of ["product", "offer", "price", "goal", "action", "placement", "brand", "constraints"]) expect(asked).not.toContain(id);
    expect(asked).toContain("punchline");
  });

  it("never shows more than five questions, whatever the answers", () => {
    for (const first of [
      { summary: "a video" },
      { summary: "skit", category: "creator" as const },
      { summary: "ad", category: "ad" as const },
      { summary: "vlog", category: "creator" as const, format: "vlog" as const },
      { summary: "brand film", category: "ad" as const, goal: "awareness" as const },
    ]) {
      const { answers, asked } = walk([a("what", first)]);
      expect(asked.length + 1).toBeLessThanOrEqual(5);
      expect(answers.length).toBeLessThanOrEqual(5);
      expect(isComplete(answers)).toBe(true);
    }
  });

  it("picks different questions for different goals", () => {
    const conversion = walk([a("what", { summary: "ad", category: "ad", goal: "conversion", product: "serum", offerType: "physical_product" })]).asked;
    const awareness = walk([a("what", { summary: "ad", category: "ad", goal: "awareness", product: "serum", offerType: "physical_product" })]).asked;
    expect(conversion).toContain("offer");
    expect(awareness).toContain("brand");
    expect(conversion).not.toEqual(awareness);
  });

  it("takes a sales ad through product, offer, goal and desired action", () => {
    const { asked } = walk([a("what", { summary: "Meta ad for my skincare serum", category: "ad" })], (qid) =>
      qid === "goal" ? a("goal", { goal: "conversion" }, "Get sales or sign-ups now") : null,
    );
    for (const id of ["product", "offer", "goal", "action"]) expect(asked).toContain(id);
    expect(asked).not.toContain("punchline");
    expect(asked).not.toContain("format");
  });

  it("skips questions already answered by an earlier free-text answer", () => {
    const { asked } = walk([a("what", { summary: "TikTok skit", category: "creator", format: "skit", platforms: ["tiktok"] })]);
    expect(asked).not.toContain("format");
    expect(asked).not.toContain("platform");
  });

  it("prunes answers that no longer apply when an earlier answer changes", () => {
    let { answers } = walk([a("what", { summary: "skit", category: "creator", isComedy: true })]);
    expect(resolve(answers).fields.isComedy).toBe(true);
    answers = upsertAnswer(answers, a("what", { summary: "an ad", category: "ad" }));
    const { fields, active } = resolve(answers);
    expect(fields.category).toBe("ad");
    expect(active.find((x) => x.questionId === "funny")).toBeUndefined();
    expect(nextQuestion(answers)?.id).toBe("product");
  });

  it("is complete once the most useful questions are answered", () => {
    const { answers } = walk([a("what", { summary: "vlog", category: "creator", format: "vlog" })]);
    expect(isComplete(answers)).toBe(true);
    expect(isComplete([a("what", { summary: "vlog", category: "creator" })])).toBe(false);
  });

  it("asks the comedy punchline before lower-value questions", () => {
    const { asked } = walk([a("what", { summary: "skit", category: "creator", format: "skit", isComedy: true })]);
    expect(asked[0]).toBe("punchline");
  });

  it("shows explainer-only questions only for explainers", () => {
    expect(visibleQuestions({ category: "creator", format: "explainer" }).map((q) => q.id)).toContain("takeaway");
    expect(visibleQuestions({ category: "creator", format: "skit" }).map((q) => q.id)).not.toContain("takeaway");
  });
});
