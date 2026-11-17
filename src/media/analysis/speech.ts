import type { AudioSpan, TranscriptSegment } from "@/core/evidence";
import { pad, r2 } from "./framePlan";

/**
 * Everything derived from a word-timed transcript plus the loudness and silence readings:
 * segments, ids, speech rate, "sound without speech", captions. Pure, shared by the browser
 * (which groups words into segments) and the server (which derives the rest).
 */

/** Whisper's markers for things that aren't speech: [BLANK_AUDIO], (music), *applause*, ♪. */
export const NON_SPEECH = /^\s*[[(*♪].*[\])*♪]?\s*$/;

/** A word as the speech model gives it: text, start, and an end that may be missing for the last token. */
export type RawWord = { text: string; start: number; end: number | null };
export type SegmentWord = { w: string; start: number; end: number; p: number | null };
export type SegmentDraft = { start: number; end: number; text: string; words: SegmentWord[] };

/** No spoken word lasts longer than this; a longer alignment is the model stretching the last word into a pause. */
export const MAX_WORD_SEC = 1.5;
/** A pause this long starts a new caption. */
export const SEGMENT_GAP_SEC = 0.8;
export const SEGMENT_MAX_SEC = 12;
export const SEGMENT_MAX_WORDS = 40;
export const SEGMENT_MAX_CHARS = 400;

/**
 * Groups the model's words into caption-sized segments: a new one after sentence-ending punctuation,
 * a pause of 0.8 s or more, or 12 s / 40 words / 400 characters. Times are kept as the model gave
 * them, only forced to be in order, inside the video, and no word longer than 1.5 s.
 * Words the model marks as non-speech are dropped.
 */
export function segmentWords(raw: RawWord[], durationSec: number): SegmentDraft[] {
  const words: SegmentWord[] = [];
  for (const r of raw) {
    const w = r.text.trim().slice(0, 40);
    if (!w || NON_SPEECH.test(w) || !Number.isFinite(r.start)) continue;
    const start = Math.min(durationSec, Math.max(words.at(-1)?.start ?? 0, r.start, 0));
    const end = Math.min(durationSec, start + MAX_WORD_SEC, Math.max(start, r.end !== null && Number.isFinite(r.end) ? r.end : start));
    words.push({ w, start: r2(start), end: r2(end), p: null });
  }
  // A word may not run past the next one's start.
  for (let i = 0; i + 1 < words.length; i++) words[i].end = Math.min(words[i].end, words[i + 1].start);

  const segments: SegmentDraft[] = [];
  let cur: SegmentWord[] = [];
  const flush = () => {
    if (cur.length) {
      segments.push({ start: cur[0].start, end: cur.at(-1)!.end, text: cur.map((x) => x.w).join(" "), words: cur });
      cur = [];
    }
  };
  for (const word of words) {
    const prev = cur.at(-1);
    if (prev) {
      const chars = cur.reduce((n, x) => n + x.w.length + 1, 0) + word.w.length;
      if (
        /[.!?…]["')\]]*$/.test(prev.w) ||
        word.start - prev.end >= SEGMENT_GAP_SEC ||
        word.end - cur[0].start > SEGMENT_MAX_SEC ||
        cur.length >= SEGMENT_MAX_WORDS ||
        chars > SEGMENT_MAX_CHARS
      ) {
        flush();
      }
    }
    cur.push(word);
  }
  flush();
  return segments.filter((s) => !NON_SPEECH.test(s.text));
}

/** The transcript the ledger keeps: ids T01…, times to hundredths. `lowConfidence` is false because the in-browser engine reports no confidence, so nothing is flagged. */
export function buildTranscript(segments: SegmentDraft[]): TranscriptSegment[] {
  return segments.map((s, i) => ({
    id: `T${pad(i + 1, 2)}`,
    start: r2(s.start),
    end: r2(s.end),
    text: s.text,
    words: s.words.map((w) => ({ w: w.w, start: r2(w.start), end: r2(w.end), p: w.p === null ? null : r2(w.p) })),
    lowConfidence: false,
  }));
}

type Timed = { start: number; end: number };

/** Words per second in 2-second windows: [windowStart, wps]. */
export function speechRateWindows(words: Timed[], durationSec: number): [number, number][] {
  const out: [number, number][] = [];
  for (let t = 0; t < durationSec; t += 2) {
    const n = words.filter((w) => w.start >= t && w.start < t + 2).length;
    out.push([t, Math.round((n / Math.min(2, durationSec - t)) * 10) / 10]);
  }
  return out;
}

/** Runs of 1.5 s or more with sound above −50 LUFS and no transcribed word: likely music or effects (not identified). */
export function soundWithoutSpeech(loudness: (number | null)[], words: Timed[], durationSec: number): Omit<AudioSpan, "id">[] {
  const seconds = loudness.length;
  const hasWord = (sec: number) => words.some((w) => w.start < sec + 1 && w.end > sec);
  const spans: Omit<AudioSpan, "id">[] = [];
  let runStart: number | null = null;
  for (let sec = 0; sec <= seconds; sec++) {
    const sound = sec < seconds && loudness[sec] !== null && (loudness[sec] as number) > -50 && !hasWord(sec);
    if (sound && runStart === null) runStart = sec;
    if (!sound && runStart !== null) {
      if (sec - runStart >= 1.5) spans.push({ start: runStart, end: Math.min(durationSec, sec), kind: "sound_without_speech" });
      runStart = null;
    }
  }
  return spans;
}

/** Silent spans and sound-without-speech spans together, in time order, with ids A01… */
export function buildAudioSpans(silence: Timed[], loudness: (number | null)[], words: Timed[], durationSec: number): AudioSpan[] {
  const spans: Omit<AudioSpan, "id">[] = [
    ...silence.map((s) => ({ start: r2(s.start), end: r2(s.end), kind: "silence" as const })),
    ...soundWithoutSpeech(loudness, words, durationSec),
  ];
  return spans.sort((a, b) => a.start - b.start).map((s, i) => ({ id: `A${pad(i + 1, 2)}`, ...s }));
}

/** WebVTT captions from the word-timed transcript, so the player's CC button shows real captions. */
export function captionsVtt(transcript: { start: number; end: number; text: string }[]): string {
  const ts = (t: number) => {
    const h = Math.floor(t / 3600);
    const m = Math.floor((t % 3600) / 60);
    const s = t % 60;
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${s.toFixed(3).padStart(6, "0")}`;
  };
  const cues = transcript.map((s, i) => `${i + 1}\n${ts(s.start)} --> ${ts(Math.max(s.end, s.start + 0.5))}\n${s.text}`);
  return `WEBVTT\n\n${cues.join("\n\n")}\n`;
}
