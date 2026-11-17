import { describe, expect, it } from "vitest";
import {
  NON_SPEECH,
  buildAudioSpans,
  buildTranscript,
  captionsVtt,
  segmentWords,
  soundWithoutSpeech,
  speechRateWindows,
  type RawWord,
} from "./speech";

const w = (text: string, start: number, end: number | null): RawWord => ({ text, start, end });

// What the Whisper word-timestamp run gave for the fixture's "My cat is judging my cooking tonight" (see docs/plan-browser-processing.md).
const CAT: RawWord[] = [
  w(" My", 1.14, 1.38),
  w(" cat", 1.38, 1.56),
  w(" is", 1.56, 1.88),
  w(" judging", 1.88, 2.12),
  w(" my", 2.12, 2.42),
  w(" cooking", 2.42, 2.92),
  w(" tonight.", 2.92, 5.26),
];

describe("segmentWords", () => {
  it("groups the fixture's words into one segment, keeping the model's times", () => {
    const [seg, ...rest] = segmentWords(CAT, 8);
    expect(rest).toEqual([]);
    expect(seg.text).toBe("My cat is judging my cooking tonight.");
    expect(seg.start).toBe(1.14);
    expect(seg.words.map((x) => x.w)).toEqual(["My", "cat", "is", "judging", "my", "cooking", "tonight."]);
    expect(seg.words.every((x) => x.p === null)).toBe(true);
  });

  it("stops a word being stretched over a pause", () => {
    const [seg] = segmentWords(CAT, 8);
    expect(seg.words.at(-1)).toMatchObject({ w: "tonight.", start: 2.92, end: 4.42 });
    expect(seg.end).toBe(4.42);
  });

  it("starts a new segment after a sentence, or a pause of 0.8 s", () => {
    const segs = segmentWords([w("Hi.", 0, 0.3), w("Look", 0.4, 0.7), w("here", 0.7, 1), w("now", 2, 2.3)], 5);
    expect(segs.map((s) => s.text)).toEqual(["Hi.", "Look here", "now"]);
  });

  it("splits a long monologue at 40 words and 12 s", () => {
    const many = Array.from({ length: 100 }, (_, i) => w(`word${i}`, i * 0.3, i * 0.3 + 0.2));
    const segs = segmentWords(many, 40);
    expect(segs.length).toBeGreaterThan(1);
    for (const s of segs) {
      expect(s.words.length).toBeLessThanOrEqual(40);
      expect(s.end - s.start).toBeLessThanOrEqual(12);
      expect(s.text.length).toBeLessThanOrEqual(500);
    }
    expect(segs.flatMap((s) => s.words)).toHaveLength(100);
  });

  it("drops the model's non-speech markers", () => {
    expect(segmentWords([w("[BLANK_AUDIO]", 0, 3)], 5)).toEqual([]);
    expect(segmentWords([w("(music)", 0, 1), w("hello", 1, 1.4)], 5).map((s) => s.text)).toEqual(["hello"]);
    expect(NON_SPEECH.test("♪ la la ♪")).toBe(true);
    expect(NON_SPEECH.test("hello there")).toBe(false);
  });

  it("keeps times in order and inside the video, and gives a missing end no length", () => {
    const words = segmentWords([w("a", 0.5, 0.9), w("b", 0.2, 0.4), w("c", 1, null), w("d", 6, 7)], 5).flatMap((s) => s.words);
    expect(words.map((x) => x.start)).toEqual([0.5, 0.5, 1, 5]);
    expect(words.every((x) => x.end >= x.start && x.end <= 5)).toBe(true);
    expect(words[2].end).toBe(1);
  });

  it("returns nothing for no words", () => {
    expect(segmentWords([], 5)).toEqual([]);
    expect(segmentWords([w("  ", 0, 1), { text: "x", start: Number.NaN, end: 1 }], 5)).toEqual([]);
  });
});

describe("buildTranscript", () => {
  it("numbers segments T01… and flags nothing as low confidence", () => {
    const t = buildTranscript(segmentWords([w("Hi.", 0, 0.3), w("Bye.", 3, 3.4)], 5));
    expect(t.map((s) => s.id)).toEqual(["T01", "T02"]);
    expect(t.every((s) => s.lowConfidence === false)).toBe(true);
    expect(t[1].words[0]).toEqual({ w: "Bye.", start: 3, end: 3.4, p: null });
  });
});

describe("speech rate and sound without speech", () => {
  const words = [{ start: 0.5, end: 0.8 }, { start: 1, end: 1.2 }, { start: 1.5, end: 1.7 }, { start: 2.1, end: 2.4 }];
  it("counts words per second in 2 s windows", () => {
    expect(speechRateWindows(words, 5)).toEqual([[0, 1.5], [2, 0.5], [4, 0]]);
  });

  it("finds loud runs of 1.5 s or more with no words, and keeps them out of speech", () => {
    const loud = [-20, -20, -20, -20, -30, -60, -20, -20, null];
    expect(soundWithoutSpeech(loud, [], 9)).toEqual([
      { start: 0, end: 5, kind: "sound_without_speech" },
      { start: 6, end: 8, kind: "sound_without_speech" },
    ]);
    expect(soundWithoutSpeech(loud, [{ start: 0, end: 5 }], 9)).toEqual([{ start: 6, end: 8, kind: "sound_without_speech" }]);
    expect(soundWithoutSpeech([-20, -20, -60], [], 3)).toEqual([{ start: 0, end: 2, kind: "sound_without_speech" }]);
    expect(soundWithoutSpeech([-20, -60], [], 2)).toEqual([]);
  });

  it("merges silence and sound spans in time order with ids A01…", () => {
    const loud: (number | null)[] = [null, -30, -30, -30, null, null, -20, -20, -20, -20];
    const spans = buildAudioSpans([{ start: 4, end: 5.99 }, { start: 0, end: 1 }], loud, [], 10);
    expect(spans).toEqual([
      { id: "A01", start: 0, end: 1, kind: "silence" },
      { id: "A02", start: 1, end: 4, kind: "sound_without_speech" },
      { id: "A03", start: 4, end: 5.99, kind: "silence" },
      { id: "A04", start: 6, end: 10, kind: "sound_without_speech" },
    ]);
  });
});

describe("captionsVtt", () => {
  it("writes WebVTT cues, at least half a second long", () => {
    expect(captionsVtt([{ start: 1.14, end: 4.42, text: "My cat." }, { start: 62.5, end: 62.6, text: "Hi." }])).toBe(
      "WEBVTT\n\n1\n00:00:01.140 --> 00:00:04.420\nMy cat.\n\n2\n00:01:02.500 --> 00:01:03.000\nHi.\n",
    );
  });
});
