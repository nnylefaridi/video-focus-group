import { describe, expect, it } from "vitest";
import {
  basisSummary,
  describeProcessingTime,
  documentedGapNote,
  evalRows,
  parseJobStamp,
  schemaBasisValues,
  scoreNotes,
  type JobStamp,
  type ReviewerScore,
} from "../../scripts/eval-metrics";

/** A finished review in the shape `npm run eval` scores: principle-backed notes about the video, almost never basis "documented". */
const fixtureReview = {
  id: "abcd12xxxxxxxxxxxx",
  title: "Hook test",
  notes: {
    "sam-a": {
      overall: "The first line sells before the viewer knows what this is.",
      observations: [
        { id: "o1", basis: "application", principleIds: ["p-1"], claim: "The opening asks for the click before the stakes." },
        { id: "o2", basis: "application", principleIds: ["p-2"], claim: "The second shot repeats the same offer." },
        { id: "o3", basis: "application", principleIds: ["p-1"], claim: "The caption restates the spoken offer." },
        { id: "o4", basis: "application", principleIds: ["p-3"], claim: "The face stays in frame for the whole hook." },
      ],
      recommendations: [
        { id: "r1", basis: "application", principleIds: ["p-1"], change: "Open on the problem.", why: "The viewer has no reason to stay yet." },
        { id: "r2", basis: "application", principleIds: ["p-2"], change: "Show the result before the ask.", why: "The offer lands with nothing behind it." },
      ],
    },
    "sam-b": {
      overall: "The joke is in the cut, then the caption explains it.",
      observations: [
        { id: "o1", basis: "application", principleIds: ["q-1"], claim: "The punchline is spoken and then written out." },
        { id: "o2", basis: "application", principleIds: ["q-1"], claim: "The reaction shot holds after the laugh." },
        { id: "o3", basis: "application", principleIds: ["q-2"], claim: "The setup is one clean line." },
        { id: "o4", basis: "general", principleIds: [], claim: "The room tone dips under the last word." },
      ],
      recommendations: [
        { id: "r1", basis: "application", principleIds: ["q-1"], change: "Cut the caption that repeats the punchline.", why: "The laugh already landed." },
        { id: "r2", basis: "application", principleIds: ["q-2"], change: "Leave the setup as the first line.", why: "It already does the work." },
      ],
    },
  },
};

function scoreFixture(): ReviewerScore[] {
  return Object.entries(fixtureReview.notes).map(([rid, notes]) => {
    const scored = scoreNotes(notes);
    return {
      review: fixtureReview.id.slice(0, 6),
      reviewer: rid,
      ...scored,
      dropped: 0,
      generic: 0,
      aiisms: 0,
      predictions: 0,
    };
  });
}

describe("eval basis breakdown", () => {
  it("counts the schema's basis values, including documented at zero", () => {
    expect([...schemaBasisValues()]).toEqual(["documented", "application", "general"]);
    const scores = scoreFixture();
    const rows = evalRows(scores);

    expect(Object.keys(rows[0])).toEqual([
      "review",
      "reviewer",
      "obs",
      "recs",
      "cited",
      "documented",
      "application",
      "general",
      "dropped",
      "generic",
      "aiisms",
      "predictions",
    ]);
    expect(rows[0]).toMatchObject({ reviewer: "sam-a", cited: "100%", documented: "0%", application: "100%", general: "0%" });
    expect(rows[1]).toMatchObject({ reviewer: "sam-b", cited: "100%", documented: "0%", application: "83%", general: "17%" });
    expect(basisSummary(scores)).toBe("Basis: documented 0% (0), application 92% (11), general 8% (1)");
    expect(documentedGapNote(scores)).toMatch(/not stored on any item/);
  });

  it("keeps an unexpected basis value visible instead of folding it into a hard-coded column", () => {
    const scored = scoreNotes({
      observations: [{ basis: "well_documented", principleIds: ["p-1"] }],
      recommendations: [{ basis: "application", principleIds: ["p-1"] }],
    });
    const [row] = evalRows([
      { review: "abcd12", reviewer: "sam", ...scored, dropped: 0, generic: 0, aiisms: 0, predictions: 0 },
    ]);
    expect(row).toMatchObject({ documented: "0%", application: "50%", general: "0%", well_documented: "50%", cited: "100%" });
    expect(basisSummary([{ review: "abcd12", reviewer: "sam", ...scored, dropped: 0, generic: 0, aiisms: 0, predictions: 0 }])).toBe(
      "Basis: documented 0% (0), application 50% (1), general 0% (0), well_documented 50% (1)",
    );
  });

  it("does not count general items in the cited rate, and does not crash on a missing basis", () => {
    const scored = scoreNotes({
      observations: [
        { basis: "application", principleIds: [] },
        { basis: "general", principleIds: ["p-1"] },
        { principleIds: ["p-1"] },
      ],
      recommendations: [],
    });
    expect(scored.cited).toBe("50%");
    expect(scored.basisCounts).toEqual({ application: 1, general: 1, "(blank)": 1 });
  });

  it("drops the documented note once a review actually stored that basis", () => {
    const scored = scoreNotes({ observations: [{ basis: "documented", principleIds: ["p-1"] }], recommendations: [] });
    const scores: ReviewerScore[] = [
      { review: "abcd12", reviewer: "sam", ...scored, dropped: 0, generic: 0, aiisms: 0, predictions: 0 },
    ];
    expect(documentedGapNote(scores)).toBeNull();
    expect(evalRows(scores)[0]).toMatchObject({ documented: "100%", application: "0%", general: "0%" });
  });
});

describe("eval processing time", () => {
  const t0 = 1_700_000_000_000;

  it("uses the completed process job and ignores later store jobs and follow-up span", () => {
    // updated_at would be t0 + 5 hours after chat. The process job is 12 minutes.
    const jobs: JobStamp[] = [
      { reviewId: "a", kind: "process", status: "done", startedAt: t0, finishedAt: t0 + 12 * 60_000 },
      { reviewId: "a", kind: "store", status: "done", startedAt: t0 + 13 * 60_000, finishedAt: t0 + 5 * 60 * 60_000 },
    ];
    expect(describeProcessingTime(["a"], jobs)).toBe(
      "Time per review: avg 12.0 min, max 12.0 min (process job started_at to finished_at, when the review reached stage done)",
    );
  });

  it("reads bigint timestamps the way Postgres returns them", () => {
    const stamp = parseJobStamp({
      review_id: "a",
      kind: "process",
      status: "done",
      started_at: "1700000000000",
      finished_at: "1700000720000",
    });
    expect(stamp).toEqual({ reviewId: "a", kind: "process", status: "done", startedAt: t0, finishedAt: t0 + 12 * 60_000 });
    expect(parseJobStamp({ review_id: "a", kind: "process", status: "done", started_at: null, finished_at: "" }).startedAt).toBeNull();
  });

  it("counts only the run that reached done, and says when a review has no usable timestamps", () => {
    const jobs: JobStamp[] = [
      { reviewId: "a", kind: "process", status: "done", startedAt: t0, finishedAt: t0 + 12 * 60_000 },
      { reviewId: "b", kind: "process", status: "failed", startedAt: t0, finishedAt: t0 + 40 * 60_000 },
      { reviewId: "b", kind: "process", status: "done", startedAt: t0 + 50 * 60_000, finishedAt: t0 + 65 * 60_000 },
      { reviewId: "c", kind: "process", status: "done", startedAt: null, finishedAt: t0 + 10 * 60_000 },
      { reviewId: "d", kind: "process", status: "done", startedAt: t0 + 10_000, finishedAt: t0 },
    ];
    expect(describeProcessingTime(["a", "b", "c", "d"], jobs)).toBe(
      "Time per review: avg 13.5 min, max 15.0 min across 2 of 4 reviews (process job started_at to finished_at, when the review reached stage done). 2 reviews have no completed process job with started_at and finished_at and are omitted from the average. Earlier failed process attempts on 1 review are not included",
    );
  });

  it("uses the latest completed process job when a review was processed twice", () => {
    const jobs: JobStamp[] = [
      { reviewId: "a", kind: "process", status: "done", startedAt: t0, finishedAt: t0 + 30 * 60_000 },
      { reviewId: "a", kind: "process", status: "done", startedAt: t0 + 90 * 60_000, finishedAt: t0 + 100 * 60_000 },
    ];
    expect(describeProcessingTime(["a"], jobs)).toBe(
      "Time per review: avg 10.0 min, max 10.0 min (process job started_at to finished_at, when the review reached stage done). Where a review has more than one completed process job, the latest finished_at is used",
    );
  });

  it("does not print a duration when no process job records one", () => {
    const text = describeProcessingTime(["a"], []);
    expect(text).toMatch(/^Time per review: unknown\./);
    expect(text).not.toMatch(/\d+\.\d+ min/);
    expect(text).toMatch(/updated_at - created_at is not used/);
  });
});
