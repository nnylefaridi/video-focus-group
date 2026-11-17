import { z } from "zod";
import type { Coverage, Frame, Ledger } from "@/core/evidence";
import {
  FRAME_TOLERANCE_SEC,
  SPRITE_COLS,
  SPRITE_ROWS,
  SPRITE_TOLERANCE_SEC,
  pad,
  planFrames,
  planSprites,
  r2,
  shotAt,
} from "./framePlan";
import { shotsFromCuts } from "./scenes";
import { buildAudioSpans, buildTranscript, speechRateWindows } from "./speech";

/**
 * What the browser sends when it has prepared a video: measurements and file names, never ids, and
 * never anything the server takes on trust. `parseManifest` is the server's whole check of it
 * (section 4.3 of docs/plan-browser-processing.md): shape, counts, sizes, and that every timestamp
 * sits inside the video, so a hand-made request can't make the prompts huge or point at moments
 * that don't exist. The frame plan is re-derived here, so the browser can't pick which moments
 * the reviewers see.
 */

export const MANIFEST_VERSION = 1;
/** The request body is refused above this before it's parsed. */
export const MANIFEST_MAX_BYTES = 1024 * 1024;

export const MAX_VIDEO_SHORT_SIDE = 720;
export const MAX_VIDEO_LONG_SIDE = 4096;
export const MIN_DURATION_SEC = 1;
export const MAX_DURATION_SEC = 180.5;
export const MAX_CUTS = 300;
export const MAX_FRAMES = 140;
export const MAX_SEGMENTS = 400;
export const MAX_SILENCE_SPANS = 300;
export const FRAME_MAX_BYTES = 300 * 1024;
export const POSTER_MAX_BYTES = 1024 * 1024;
export const SPRITE_MAX_BYTES = 2 * 1024 * 1024;
/** Everything besides the video (poster, frames, sprites) may add up to this much on top of the video cap. */
export const EXTRAS_MAX_BYTES = 30 * 1024 * 1024;
export const LOUDNESS_RANGE: [number, number] = [-70, 10];
/** A word's end may run this far past the end of the video (rounding in the speech model's timings). */
const END_SLACK_SEC = 0.05;
const EDGE_SLACK_SEC = 0.01;

 
const CONTROL = /[\u0000-\u0009\u000B-\u001F\u007F-\u009F]/;
const text = (max: number) => z.string().min(1).max(max).refine((s) => !CONTROL.test(s), "Control characters aren't allowed.");
const num = z.number();
const bytes = z.number().int().min(1).max(Number.MAX_SAFE_INTEGER);

export const FRAME_FILE = /^frames\/F\d{3}\.jpg$/;
export const SPRITE_FILE = /^sprites\/P\d{3}\.jpg$/;

const ManifestShape = z.strictObject({
  v: z.literal(MANIFEST_VERSION),
  originalName: z.string().max(200).refine((s) => !CONTROL.test(s), "Control characters aren't allowed."),
  video: z.strictObject({ durationSec: num, width: z.number().int(), height: z.number().int(), hasAudio: z.boolean(), bytes }),
  cuts: z.array(num).max(MAX_CUTS),
  frames: z.array(z.strictObject({ t: num, plannedT: num, dense: z.boolean(), file: z.string().max(40), bytes })).max(MAX_FRAMES),
  sprites: z
    .array(
      z.strictObject({
        file: z.string().max(40),
        bytes,
        cols: z.literal(SPRITE_COLS),
        rows: z.literal(SPRITE_ROWS),
        tileW: z.number().int(),
        tileH: z.number().int(),
        t: z.array(num).max(SPRITE_COLS * SPRITE_ROWS),
      }),
    )
    .max(19),
  poster: z.strictObject({ bytes }),
  loudness: z.array(num.nullable()).max(181),
  silence: z.array(z.strictObject({ start: num, end: num })).max(MAX_SILENCE_SPANS),
  transcript: z
    .array(
      z.strictObject({
        start: num,
        end: num,
        text: text(500),
        words: z.array(z.strictObject({ w: text(40), start: num, end: num, p: num.nullable() })).max(200),
      }),
    )
    .max(MAX_SEGMENTS),
  tools: z.strictObject({ mediabunny: z.string().max(40), transformers: z.string().max(40), model: z.string().max(200) }),
});

export type Manifest = z.infer<typeof ManifestShape>;
export type ManifestResult = { ok: true; manifest: Manifest } | { ok: false; reason: string };

const fail = (reason: string): { ok: false; reason: string } => ({ ok: false, reason });
const within = (t: number, max: number) => t >= 0 && t <= max;

/**
 * Checks a request body against the shape and every rule in the plan's section 4.3 (steps 2–6).
 * `maxVideoBytes` is the upload cap (MAX_UPLOAD_MB). On failure `reason` is for the server log, not the user.
 */
export function parseManifest(raw: unknown, limits: { maxVideoBytes: number }): ManifestResult {
  const shape = ManifestShape.safeParse(raw);
  if (!shape.success) {
    const i = shape.error.issues[0];
    return fail(`Shape: ${i?.path.join(".") || "(body)"}: ${i?.message ?? "invalid"}`);
  }
  const m = shape.data;
  const { video } = m;
  const dur = video.durationSec;

  // 3. The video.
  if (!(dur >= MIN_DURATION_SEC && dur <= MAX_DURATION_SEC)) return fail(`Duration ${dur} is outside ${MIN_DURATION_SEC}–${MAX_DURATION_SEC} s.`);
  if (video.width < 16 || video.height < 16) return fail("The video is too small.");
  if (video.height <= video.width) return fail("The video isn't vertical.");
  if (Math.min(video.width, video.height) > MAX_VIDEO_SHORT_SIDE) return fail(`The short side ${Math.min(video.width, video.height)} is over ${MAX_VIDEO_SHORT_SIDE}.`);
  if (Math.max(video.width, video.height) > MAX_VIDEO_LONG_SIDE) return fail("The long side is over 4096.");
  if (video.bytes > limits.maxVideoBytes) return fail(`The video is ${video.bytes} bytes, over the ${limits.maxVideoBytes} cap.`);

  // 4. Every timestamp is inside the video.
  const end = dur + END_SLACK_SEC;
  for (let i = 0; i < m.cuts.length; i++) {
    const c = m.cuts[i];
    if (!(c >= 0.2 && c <= dur - 0.2)) return fail(`Cut ${i} (${c}) is within 0.2 s of an end or outside the video.`);
    if (i > 0 && !(c - m.cuts[i - 1] >= 0.2 - 1e-6)) return fail(`Cuts ${i - 1} and ${i} aren't in order or are under 0.2 s apart.`);
  }
  if (m.loudness.length !== Math.ceil(dur)) return fail(`Loudness has ${m.loudness.length} readings for ${Math.ceil(dur)} seconds.`);
  for (const v of m.loudness) if (v !== null && !(v >= LOUDNESS_RANGE[0] && v <= LOUDNESS_RANGE[1])) return fail(`A loudness reading (${v}) is out of range.`);
  let prevEnd = 0;
  for (const s of m.silence) {
    if (!(within(s.start, end) && within(s.end, end) && s.start <= s.end)) return fail("A silent span sits outside the video.");
    if (s.start < prevEnd - EDGE_SLACK_SEC) return fail("Silent spans overlap or aren't in order.");
    prevEnd = s.end;
  }
  const maxWords = Math.ceil(6 * dur) + 20;
  let wordCount = 0;
  prevEnd = 0;
  for (const seg of m.transcript) {
    if (!(within(seg.start, end) && within(seg.end, end) && seg.start <= seg.end)) return fail("A transcript segment sits outside the video.");
    if (seg.start < prevEnd - EDGE_SLACK_SEC) return fail("Transcript segments overlap or aren't in order.");
    prevEnd = seg.end;
    if (seg.words.length === 0) return fail("A transcript segment has no words.");
    let prevStart = seg.start;
    for (const w of seg.words) {
      wordCount++;
      if (!(w.start <= w.end && within(w.start, end) && within(w.end, end))) return fail("A word's time sits outside the video.");
      if (w.start < seg.start - EDGE_SLACK_SEC || w.end > seg.end + EDGE_SLACK_SEC) return fail("A word sits outside its segment.");
      if (w.start < prevStart - EDGE_SLACK_SEC) return fail("Words aren't in order.");
      prevStart = w.start;
      if (w.p !== null && !(w.p >= 0 && w.p <= 1)) return fail("A word's confidence is out of range.");
    }
  }
  if (wordCount > maxWords) return fail(`${wordCount} words is more than ${maxWords} for a ${dur} s video.`);
  if (!video.hasAudio && (m.transcript.length > 0 || m.silence.length > 0 || m.loudness.some((v) => v !== null)))
    return fail("The video has no audio but audio readings were sent.");

  // 5. The frame plan is the server's, not the browser's.
  const planned = planFrames(dur, shotsFromCuts(m.cuts, dur));
  if (m.frames.length !== planned.length) return fail(`${m.frames.length} frames sent; the plan has ${planned.length}.`);
  let lastT = 0;
  for (let i = 0; i < planned.length; i++) {
    const f = m.frames[i];
    if (Math.abs(f.plannedT - planned[i].t) > 1e-6 || f.dense !== planned[i].dense) return fail(`Frame ${i} isn't the planned moment.`);
    if (!within(f.t, dur) || Math.abs(f.t - f.plannedT) > FRAME_TOLERANCE_SEC) return fail(`Frame ${i}'s time is far from its planned moment.`);
    if (f.t < lastT) return fail("Frames aren't in time order.");
    lastT = f.t;
  }
  const sheets = planSprites(dur);
  if (m.sprites.length !== sheets.length) return fail(`${m.sprites.length} sprite sheets sent; expected ${sheets.length}.`);
  for (let i = 0; i < sheets.length; i++) {
    const s = m.sprites[i];
    if (s.t.length !== sheets[i].length) return fail(`Sprite sheet ${i} has ${s.t.length} tiles; expected ${sheets[i].length}.`);
    for (let j = 0; j < s.t.length; j++) if (Math.abs(s.t[j] - sheets[i][j]) > SPRITE_TOLERANCE_SEC) return fail(`Sprite ${i} tile ${j} isn't on the 4-per-second grid.`);
    if (!(s.tileW >= 16 && s.tileW <= 360 && s.tileH >= s.tileW && s.tileH <= 640)) return fail(`Sprite ${i} has odd tile sizes.`);
  }

  // 6. File names and sizes.
  let total = video.bytes + m.poster.bytes;
  if (m.poster.bytes > POSTER_MAX_BYTES) return fail("The poster is too big.");
  for (let i = 0; i < m.frames.length; i++) {
    if (m.frames[i].file !== `frames/F${pad(i + 1, 3)}.jpg`) return fail(`Frame ${i} has the file name ${m.frames[i].file}.`);
    if (m.frames[i].bytes > FRAME_MAX_BYTES) return fail(`Frame ${i} is too big.`);
    total += m.frames[i].bytes;
  }
  for (let i = 0; i < m.sprites.length; i++) {
    if (m.sprites[i].file !== `sprites/P${pad(i, 3)}.jpg`) return fail(`Sprite ${i} has the file name ${m.sprites[i].file}.`);
    if (m.sprites[i].bytes > SPRITE_MAX_BYTES) return fail(`Sprite ${i} is too big.`);
    total += m.sprites[i].bytes;
  }
  if (total > limits.maxVideoBytes + EXTRAS_MAX_BYTES) return fail("The files add up to more than the limit.");
  return { ok: true, manifest: m };
}

/** What the evidence ledger holds once a manifest is accepted: everything but the perception, which needs Claude. */
export type ManifestEvidence = Omit<Ledger, "perception">;

/** Shots, frames, transcript, audio spans, speech rate and coverage, with ids assigned here in time order. */
export function deriveEvidence(m: Manifest, video?: { durationSec: number; width: number; height: number }): ManifestEvidence {
  const v = video ?? m.video;
  const shots = shotsFromCuts(m.cuts, v.durationSec);
  const frames: Frame[] = m.frames.map((f, i) => ({
    id: `F${pad(i + 1, 3)}`,
    t: r2(f.t),
    file: f.file,
    shotId: shotAt(shots, f.t),
    dense: f.dense,
  }));
  const transcript = buildTranscript(m.transcript);
  const words = transcript.flatMap((s) => s.words);
  const audio = m.video.hasAudio ? buildAudioSpans(m.silence, m.loudness, words, v.durationSec) : [];
  const speechRate = m.video.hasAudio ? speechRateWindows(words, v.durationSec) : [];
  const partial = { shots, frames, transcript, audio, speechRate, loudness: m.loudness };
  const sprites = m.sprites.map(({ file, cols, rows, tileW, tileH, t }) => ({ file, cols, rows, tileW, tileH, t: t.map(r2) }));
  return { ...partial, sprites, coverage: coverageOf({ ...v, hasAudio: m.video.hasAudio }, partial) };
}

export function coverageOf(
  p: { durationSec: number; width: number; height: number; hasAudio: boolean },
  ledger: Pick<Ledger, "shots" | "frames" | "transcript" | "audio">,
): Coverage {
  const notes: string[] = [];
  if (!p.hasAudio) notes.push("The video has no audio track, so nothing about sound or speech can be judged.");
  else if (ledger.transcript.length === 0) notes.push("No speech was detected in the audio.");
  else notes.push("Word-level confidence isn't available for this transcript, so no part of it is marked as likely misheard.");
  if (ledger.transcript.some((s) => s.lowConfidence)) notes.push("Some transcript segments are low-confidence and may be misheard.");
  if (ledger.audio.some((a) => a.kind === "sound_without_speech"))
    notes.push("Music and sound effects are detected only as 'sound without speech'; their identity, mood and mix are not analyzed.");
  notes.push("Motion, gestures and timing between sampled frames were not seen; claims about them rely on shot boundaries and speech timing only.");
  notes.push("Frame colors and composition were judged from downscaled stills, not full-resolution video.");
  return {
    durationSec: p.durationSec,
    width: p.width,
    height: p.height,
    framesAnalyzed: ledger.frames.length,
    sampling: `Frames sampled every 0.25s for the first 3 seconds, about every 1–2s after that, plus the first and middle frame of each of the ${ledger.shots.length} detected shots (${ledger.frames.length} frames total).`,
    transcript: ledger.transcript.length ? "speech" : "no_speech_detected",
    notes,
  };
}
