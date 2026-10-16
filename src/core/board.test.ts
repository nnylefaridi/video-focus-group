import { describe, expect, it } from "vitest";
import { recommendBoard, type BoardCandidate } from "./board";

const c = (id: string, categories: BoardCandidate["categories"], appliesTo: Record<string, number>, covers: BoardCandidate["covers"], tensions: string[] = []): BoardCandidate => ({
  id,
  name: id,
  categories,
  appliesTo,
  covers,
  tensions: tensions.map((w) => ({ with: w })),
});

const roster = [
  c("comic", ["creator"], { comedy: 3, "format:skit": 2, "reaction:laugh": 2 }, ["comedy", "clarity"], ["absurdist"]),
  c("absurdist", ["creator"], { comedy: 3, "reaction:laugh": 1 }, ["comedy", "story"]),
  c("retention", ["creator"], { "platform:shorts": 2, "reaction:follow": 2 }, ["hook", "retention", "payoff"]),
  c("teacher", ["creator"], { "format:explainer": 3, "reaction:learn": 3 }, ["teaching", "clarity"]),
  c("offer", ["ad", "creator"], { "category:ad": 3, "goal:conversion": 3 }, ["offer", "cta", "hook"], ["purpose"]),
  c("purpose", ["ad"], { "category:ad": 2, "goal:awareness": 3 }, ["brand", "story"]),
  c("classic", ["ad"], { "category:ad": 2, "placement:paid_feed": 2 }, ["brand", "visuals"]),
];

describe("board recommender", () => {
  it("picks comedy reviewers for a comedy skit, with reasons", () => {
    const picks = recommendBoard(roster, { category: "creator", isComedy: true, format: "skit", reactions: ["laugh"] });
    expect(picks.map((p) => p.id)).toContain("comic");
    expect(picks.find((p) => p.id === "comic")!.reasons.length).toBeGreaterThan(0);
    expect(picks.map((p) => p.id)).not.toContain("purpose");
  });

  it("gives a different board for a conversion ad", () => {
    const picks = recommendBoard(roster, { category: "ad", goal: "conversion", placement: "paid_feed" }).map((p) => p.id);
    expect(picks[0]).toBe("offer");
    expect(picks).not.toContain("comic");
  });

  it("prefers a documented tension pair so the board can disagree", () => {
    const picks = recommendBoard(roster, { category: "creator", isComedy: true }).map((p) => p.id);
    expect(picks).toContain("comic");
    expect(picks).toContain("absurdist");
  });

  it("returns nothing until the category is known", () => {
    expect(recommendBoard(roster, {})).toEqual([]);
  });
});
