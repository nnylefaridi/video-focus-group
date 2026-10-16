import { describe, expect, it } from "vitest";
import { deriveSpan, evidenceSpan, type Ledger } from "./evidence";

const ledger: Ledger = {
  shots: [{ id: "S01", start: 0, end: 4 }],
  frames: [
    { id: "F001", t: 0.5, file: "frames/F001.jpg", shotId: "S01", dense: false },
    { id: "F002", t: 3.2, file: "frames/F002.jpg", shotId: "S01", dense: false },
  ],
  transcript: [{ id: "T01", start: 1, end: 2.5, text: "hello there", words: [], lowConfidence: false }],
  audio: [{ id: "A01", start: 2.5, end: 3, kind: "silence" }],
  speechRate: [],
  loudness: [],
  perception: [],
  coverage: { durationSec: 4, width: 720, height: 1280, framesAnalyzed: 2, sampling: "", transcript: "speech", notes: [] },
};

describe("evidence spans", () => {
  it("derives spans from ids, never from model-written times", () => {
    expect(deriveSpan(ledger, ["F001", "T01"])).toEqual({ start: 0.5, end: 2.5 });
    expect(deriveSpan(ledger, ["F002", "A01"])).toEqual({ start: 2.5, end: 3.2 });
  });
  it("ignores unknown ids and returns null when none are real", () => {
    expect(evidenceSpan(ledger, "F999")).toBeNull();
    expect(deriveSpan(ledger, ["F999", "X1"])).toBeNull();
    expect(deriveSpan(ledger, ["F999", "F001"])).toEqual({ start: 0.5, end: 0.5 });
  });
});
