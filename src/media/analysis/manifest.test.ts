import { describe, expect, it } from "vitest";
import { parseManifest, deriveEvidence, type Manifest } from "./manifest";
import { pad, planFrames, planSprites } from "./framePlan";
import { shotsFromCuts } from "./scenes";

const LIMITS = { maxVideoBytes: 50 * 1024 * 1024 };

/** A manifest that passes every check, for an 8 s vertical video with cuts at 3.0 and 5.5. */
function good(over: Partial<Manifest> = {}): Manifest {
  const duration = 8;
  const cuts = [3, 5.5];
  const frames = planFrames(duration, shotsFromCuts(cuts, duration)).map((f, i) => ({
    t: f.t,
    plannedT: f.t,
    dense: f.dense,
    file: `frames/F${pad(i + 1, 3)}.jpg`,
    bytes: 40_000,
  }));
  const sprites = planSprites(duration).map((t, i) => ({ file: `sprites/P${pad(i, 3)}.jpg`, bytes: 200_000, cols: 8 as const, rows: 5 as const, tileW: 270, tileH: 480, t }));
  return {
    v: 1,
    originalName: "cat.mov",
    video: { durationSec: duration, width: 720, height: 1280, hasAudio: true, bytes: 2_000_000 },
    cuts,
    frames,
    sprites,
    poster: { bytes: 60_000 },
    loudness: [null, -30, -25, -24, null, null, -22, -22],
    silence: [{ start: 0, end: 1 }],
    transcript: [
      {
        start: 1.14,
        end: 4.42,
        text: "My cat is judging my cooking tonight.",
        words: [
          { w: "My", start: 1.14, end: 1.38, p: null },
          { w: "cat", start: 1.38, end: 1.56, p: null },
          { w: "tonight.", start: 2.92, end: 4.42, p: null },
        ],
      },
    ],
    tools: { mediabunny: "1.66.0", transformers: "4.3.2", model: "onnx-community/whisper-base_timestamped@608c49e q8" },
    ...over,
  };
}

const clone = <T,>(x: T): T => structuredClone(x);
const reason = (m: unknown, limits = LIMITS) => {
  const r = parseManifest(m, limits);
  return r.ok ? null : r.reason;
};

describe("parseManifest: the good case", () => {
  it("accepts a well-formed manifest", () => {
    expect(parseManifest(good(), LIMITS).ok).toBe(true);
  });
  it("accepts a video with no audio and no cuts, and one at the limits", () => {
    const m = good({ cuts: [], loudness: Array(8).fill(null), silence: [], transcript: [], video: { durationSec: 8, width: 720, height: 1280, hasAudio: false, bytes: 1000 } });
    m.frames = planFrames(8, shotsFromCuts([], 8)).map((f, i) => ({ t: f.t, plannedT: f.t, dense: f.dense, file: `frames/F${pad(i + 1, 3)}.jpg`, bytes: 10 }));
    expect(reason(m)).toBeNull();
  });
});

describe("parseManifest: the video (4.3 step 3)", () => {
  it.each([
    ["too short", (m: Manifest) => (m.video.durationSec = 0.5)],
    ["too long", (m: Manifest) => (m.video.durationSec = 181)],
    ["horizontal", (m: Manifest) => ((m.video.width = 1280), (m.video.height = 720))],
    ["square", (m: Manifest) => ((m.video.width = 720), (m.video.height = 720))],
    ["short side 1080", (m: Manifest) => ((m.video.width = 1080), (m.video.height = 1920))],
    ["long side over 4096", (m: Manifest) => ((m.video.width = 500), (m.video.height = 4200))],
    ["a fractional size", (m: Manifest) => (m.video.width = 719.5)],
    ["a video over the cap", (m: Manifest) => (m.video.bytes = 51 * 1024 * 1024)],
  ])("rejects %s", (_name, mutate) => {
    const m = good();
    mutate(m);
    expect(reason(m)).not.toBeNull();
  });
  it("applies the cap it's given", () => {
    expect(reason(good(), { maxVideoBytes: 1_000_000 })).toMatch(/cap/);
  });
});

describe("parseManifest: timestamps (4.3 step 4)", () => {
  it.each([
    ["a cut past the end", (m: Manifest) => (m.cuts = [3, 9])],
    ["a cut within 0.2 s of the end", (m: Manifest) => (m.cuts = [3, 7.9])],
    ["a cut within 0.2 s of the start", (m: Manifest) => (m.cuts = [0.1, 3])],
    ["unsorted cuts", (m: Manifest) => (m.cuts = [5.5, 3])],
    ["cuts under 0.2 s apart", (m: Manifest) => (m.cuts = [3, 3.1])],
    ["a negative cut", (m: Manifest) => (m.cuts = [-1, 3])],
    ["loudness of the wrong length", (m: Manifest) => m.loudness.push(-20)],
    ["a loudness reading out of range", (m: Manifest) => (m.loudness[2] = 40)],
    ["a silent span past the end", (m: Manifest) => (m.silence = [{ start: 6, end: 9 }])],
    ["overlapping silent spans", (m: Manifest) => (m.silence = [{ start: 0, end: 2 }, { start: 1, end: 3 }])],
    ["a segment past the end", (m: Manifest) => (m.transcript[0].end = 9)],
    ["a word past the end", (m: Manifest) => (m.transcript[0].words[2].end = 9)],
    ["a word that ends before it starts", (m: Manifest) => (m.transcript[0].words[1].end = 1)],
    ["a word outside its segment", (m: Manifest) => (m.transcript[0].words[0].start = 0.2)],
    ["words out of order", (m: Manifest) => (m.transcript[0].words[2].start = 1.2)],
    ["overlapping segments", (m: Manifest) => m.transcript.push({ start: 3, end: 3.5, text: "again", words: [{ w: "again", start: 3, end: 3.5, p: null }] })],
    ["a confidence over 1", (m: Manifest) => (m.transcript[0].words[0].p = 1.5)],
    ["an empty segment", (m: Manifest) => (m.transcript[0].words = [])],
    ["audio readings for a video with no audio", (m: Manifest) => (m.video.hasAudio = false)],
    ["a control character in text", (m: Manifest) => (m.transcript[0].text = "hi\u0007 there")],
    ["more words than speech allows", (m: Manifest) => (m.transcript[0].words = Array.from({ length: 70 }, () => ({ w: "a", start: 2, end: 2, p: null })))],
  ])("rejects %s", (_name, mutate) => {
    const m = good();
    mutate(m);
    expect(reason(m)).not.toBeNull();
  });
  it("lets a word's end run 0.05 s past the video, and no more", () => {
    const m = good();
    m.transcript[0] = { ...m.transcript[0], end: 8.04, words: [...m.transcript[0].words.slice(0, 2), { w: "x", start: 7, end: 8.04, p: null }] };
    expect(reason(m)).toBeNull();
    m.transcript[0].end = 8.2;
    expect(reason(m)).not.toBeNull();
  });
});

describe("parseManifest: the frame plan (4.3 step 5)", () => {
  it.each([
    ["a missing frame", (m: Manifest) => m.frames.pop()],
    ["a frame at another moment", (m: Manifest) => (m.frames[5].plannedT = 1.9)],
    ["a frame whose real time is far from its plan", (m: Manifest) => (m.frames[5].t = m.frames[5].plannedT + 0.5)],
    ["a frame past the end", (m: Manifest) => (m.frames[m.frames.length - 1].t = 8.5)],
    ["frames out of order", (m: Manifest) => ([m.frames[6].t, m.frames[7].t] = [m.frames[7].t, m.frames[6].t])],
    ["a wrong dense flag", (m: Manifest) => (m.frames[1].dense = !m.frames[1].dense)],
    ["cuts that don't match the planned frames", (m: Manifest) => (m.cuts = [3, 6])],
    ["a missing sprite sheet", (m: Manifest) => m.sprites.pop()],
    ["a sprite with the wrong tile count", (m: Manifest) => m.sprites[0].t.pop()],
    ["a sprite tile off the 4-per-second grid", (m: Manifest) => (m.sprites[0].t[10] += 0.3)],
    ["a different sprite grid", (m: Manifest) => ((m.sprites[0] as { cols: number }).cols = 4)],
    ["a landscape sprite tile", (m: Manifest) => ((m.sprites[0].tileW = 480), (m.sprites[0].tileH = 270))],
  ])("rejects %s", (_name, mutate) => {
    const m = good();
    mutate(m);
    expect(reason(m)).not.toBeNull();
  });
  it("lets a real frame time sit a little off its plan", () => {
    const m = good();
    m.frames[5].t = m.frames[5].plannedT - 0.03;
    m.frames[4].t = m.frames[4].plannedT - 0.03;
    expect(reason(m)).toBeNull();
  });
});

describe("parseManifest: counts, names and sizes (4.3 steps 2 and 6)", () => {
  it.each([
    ["an extra field", (m: Manifest) => ((m as Record<string, unknown>).extra = 1)],
    ["a wrong version", (m: Manifest) => ((m as { v: number }).v = 2)],
    ["too many cuts", (m: Manifest) => (m.cuts = Array.from({ length: 301 }, (_, i) => 0.3 + i * 0.5))],
    ["too many silent spans", (m: Manifest) => (m.silence = Array.from({ length: 301 }, (_, i) => ({ start: i / 40, end: i / 40 })))],
    ["too many segments", (m: Manifest) => (m.transcript = Array.from({ length: 401 }, () => ({ start: 1, end: 1, text: "a", words: [{ w: "a", start: 1, end: 1, p: null }] })))],
    ["a segment over 500 characters", (m: Manifest) => (m.transcript[0].text = "x".repeat(501))],
    ["a word over 40 characters", (m: Manifest) => (m.transcript[0].words[0].w = "x".repeat(41))],
    ["a long original name", (m: Manifest) => (m.originalName = "x".repeat(201))],
    ["a frame file in the wrong place", (m: Manifest) => (m.frames[0].file = "../F001.jpg")],
    ["a frame out of sequence", (m: Manifest) => (m.frames[2].file = "frames/F009.jpg")],
    ["a frame with a png name", (m: Manifest) => (m.frames[0].file = "frames/F001.png")],
    ["a sprite out of sequence", (m: Manifest) => (m.sprites[0].file = "sprites/P001.jpg")],
    ["an oversized frame", (m: Manifest) => (m.frames[0].bytes = 400 * 1024)],
    ["an oversized sprite", (m: Manifest) => (m.sprites[0].bytes = 3 * 1024 * 1024)],
    ["an oversized poster", (m: Manifest) => (m.poster.bytes = 2 * 1024 * 1024)],
    ["a zero-byte frame", (m: Manifest) => (m.frames[0].bytes = 0)],
    ["a non-finite number", (m: Manifest) => (m.cuts = [Number.POSITIVE_INFINITY])],
  ])("rejects %s", (_name, mutate) => {
    const m = good();
    mutate(m);
    expect(reason(m)).not.toBeNull();
  });
  it("rejects everything that isn't an object", () => {
    for (const bad of [null, undefined, 5, "x", [], {}]) expect(reason(bad)).not.toBeNull();
  });
  it("limits the total to the cap plus 30 MB for the extras", () => {
    const m = good();
    m.video.bytes = LIMITS.maxVideoBytes;
    m.frames.forEach((f) => (f.bytes = 300 * 1024));
    m.sprites.forEach((s) => (s.bytes = 2 * 1024 * 1024));
    expect(reason(m)).toBeNull(); // about 45 MB of video-plus-extras... well inside cap + 30 MB
    const huge = clone(m);
    huge.frames.forEach((f) => (f.bytes = 300 * 1024));
    huge.sprites = [...huge.sprites];
    expect(parseManifest(huge, { maxVideoBytes: LIMITS.maxVideoBytes }).ok).toBe(true);
  });
});

describe("deriveEvidence", () => {
  const m = good();
  const e = deriveEvidence(m);

  it("assigns ids and shot ids in time order, never taking them from the browser", () => {
    expect(e.shots.map((s) => s.id)).toEqual(["S01", "S02", "S03"]);
    expect(e.frames.map((f) => f.id)).toEqual(m.frames.map((_, i) => `F${pad(i + 1, 3)}`));
    const at = (t: number) => e.frames.find((f) => f.t === t);
    expect(at(1)?.shotId).toBe("S01");
    expect(at(3)?.shotId).toBe("S02");
    expect(at(5.55)?.shotId).toBe("S03");
    expect(e.frames.some((f) => f.dense)).toBe(true);
    expect(e.transcript.map((t) => t.id)).toEqual(["T01"]);
    expect(e.audio[0]).toEqual({ id: "A01", start: 0, end: 1, kind: "silence" });
  });

  it("derives sound without speech, speech rate and loudness", () => {
    expect(e.audio.some((a) => a.kind === "sound_without_speech")).toBe(true);
    expect(e.speechRate[0]).toEqual([0, 1]);
    expect(e.loudness).toEqual(m.loudness);
  });

  it("writes coverage that says plainly what wasn't seen", () => {
    expect(e.coverage).toMatchObject({ durationSec: 8, width: 720, height: 1280, framesAnalyzed: m.frames.length, transcript: "speech" });
    expect(e.coverage.sampling).toContain("3 detected shots");
    expect(e.coverage.notes.join(" ")).toContain("Word-level confidence isn't available");
    expect(e.coverage.notes.join(" ")).not.toContain("low-confidence");
  });

  it("covers a silent video and one with no speech", () => {
    const quiet = deriveEvidence(good({ video: { ...m.video, hasAudio: false }, loudness: Array(8).fill(null), silence: [], transcript: [] }));
    expect(quiet.coverage.notes[0]).toMatch(/no audio track/);
    expect(quiet.audio).toEqual([]);
    expect(quiet.speechRate).toEqual([]);
    const noSpeech = deriveEvidence(good({ transcript: [] }));
    expect(noSpeech.coverage.transcript).toBe("no_speech_detected");
    expect(noSpeech.coverage.notes[0]).toMatch(/No speech was detected/);
  });

  it("uses the stored file's own duration and size when given", () => {
    expect(deriveEvidence(m, { durationSec: 7.98, width: 720, height: 1280 }).coverage.durationSec).toBe(7.98);
  });
});
