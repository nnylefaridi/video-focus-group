import { describe, expect, it } from "vitest";
import { validateNotes } from "./validate";
import type { Ledger } from "@/core/evidence";
import type { ExpertProfile } from "@/core/expert";

const ledger = {
  shots: [{ id: "S01", start: 0, end: 4 }],
  frames: [{ id: "F001", t: 0.5, file: "frames/F001.jpg", shotId: "S01", dense: false }],
  transcript: [{ id: "T01", start: 0, end: 2, text: "Okay, so this is my cat.", words: [], lowConfidence: false }],
  audio: [],
  speechRate: [],
  loudness: [],
  perception: [],
  coverage: { durationSec: 4, width: 720, height: 1280, framesAnalyzed: 1, sampling: "", transcript: "speech", notes: [] },
} as Ledger;

const profile = {
  id: "x",
  name: "X Person",
  principles: [{ id: "x-1", status: "verified", statement: "s", refs: [], confidence: "well_documented", dimensions: ["comedy"], excerpt: "Is this anything at all, really" }],
} as unknown as ExpertProfile;

const rec = (change: string, why = "because") => ({
  id: "r1", change, why, evidenceIds: ["T01"], principleIds: ["x-1"], basis: "application" as const, priority: "high" as const, confidence: "firm" as const,
});
const notes = (recs: ReturnType<typeof rec>[], claim = "Your opening line is a greeting.") => ({
  overall: "ok",
  observations: [{ id: "o1", evidenceIds: ["T01", "F999"], claim, dimension: "comedy", sentiment: "problem" as const, basis: "application" as const, principleIds: ["x-1", "nope"] }],
  recommendations: recs,
  keep: [],
  couldNotAssess: [],
});

describe("validators", () => {
  it("keeps suggested new wording in a recommendation", () => {
    const out = validateNotes(notes([rec('Open with "Every time I cook, Biscuit files a complaint" instead.')]), ledger, profile);
    expect(out.notes.recommendations).toHaveLength(1);
  });
  it("drops quotes framed as the expert's own words", () => {
    const out = validateNotes(notes([rec('As I always say, "the setup is the enemy of the laugh" so cut it.')]), ledger, profile);
    expect(out.notes.recommendations).toHaveLength(0);
  });
  it("drops unverified quotes in observations but allows the video's own words", () => {
    expect(validateNotes(notes([], 'You say "Okay, so this is my cat" first.'), ledger, profile).notes.observations).toHaveLength(1);
    expect(validateNotes(notes([], 'Like I wrote, "funny is always about the words".'), ledger, profile).notes.observations).toHaveLength(0);
  });
  it("drops performance predictions", () => {
    expect(validateNotes(notes([rec("Do this and it will go viral.")]), ledger, profile).notes.recommendations).toHaveLength(0);
  });
  it("strips unknown evidence and principle ids", () => {
    const o = validateNotes(notes([]), ledger, profile).notes.observations[0];
    expect(o.evidenceIds).toEqual(["T01"]);
    expect(o.principleIds).toEqual(["x-1"]);
  });
});
