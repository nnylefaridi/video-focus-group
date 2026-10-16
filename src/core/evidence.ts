import { z } from "zod";

/**
 * The evidence ledger: everything the pipeline actually extracted from a video.
 * Reviewers may only make claims that cite ids from this ledger, and every
 * timestamp shown to the user is derived from these ids by the server.
 */

export const Shot = z.object({ id: z.string(), start: z.number(), end: z.number() });
export type Shot = z.infer<typeof Shot>;

export const Frame = z.object({
  id: z.string(),
  t: z.number(),
  file: z.string(),
  shotId: z.string().nullable(),
  /** Frames added by a focused re-sample (hook, or "inspect this moment"). */
  dense: z.boolean().default(false),
});
export type Frame = z.infer<typeof Frame>;

export const Word = z.object({ w: z.string(), start: z.number(), end: z.number(), p: z.number() });
export const TranscriptSegment = z.object({
  id: z.string(),
  start: z.number(),
  end: z.number(),
  text: z.string(),
  words: z.array(Word),
  lowConfidence: z.boolean(),
});
export type TranscriptSegment = z.infer<typeof TranscriptSegment>;

export const AudioSpan = z.object({
  id: z.string(),
  start: z.number(),
  end: z.number(),
  kind: z.enum(["silence", "sound_without_speech"]),
});
export type AudioSpan = z.infer<typeof AudioSpan>;

export const FramePerception = z.object({
  frameId: z.string(),
  description: z.string(),
  onScreenText: z.string(),
  captionsVisible: z.boolean(),
  people: z.number(),
  framing: z.string(),
  productVisible: z.boolean().nullable(),
});
export type FramePerception = z.infer<typeof FramePerception>;

export const Coverage = z.object({
  durationSec: z.number(),
  width: z.number(),
  height: z.number(),
  framesAnalyzed: z.number(),
  sampling: z.string(),
  transcript: z.enum(["speech", "no_speech_detected"]),
  notes: z.array(z.string()),
});
export type Coverage = z.infer<typeof Coverage>;

export const Ledger = z.object({
  shots: z.array(Shot),
  frames: z.array(Frame),
  transcript: z.array(TranscriptSegment),
  audio: z.array(AudioSpan),
  /** Words per second in 2-second windows: [windowStart, wps]. */
  speechRate: z.array(z.tuple([z.number(), z.number()])),
  /** Integrated loudness (LUFS) per second, or null if silent. */
  loudness: z.array(z.number().nullable()),
  perception: z.array(FramePerception),
  coverage: Coverage,
});
export type Ledger = z.infer<typeof Ledger>;

export type EvidenceKind = "frame" | "transcript" | "shot" | "audio";

export function evidenceKind(id: string): EvidenceKind | null {
  if (/^F\d+$/.test(id)) return "frame";
  if (/^T\d+$/.test(id)) return "transcript";
  if (/^S\d+$/.test(id)) return "shot";
  if (/^A\d+$/.test(id)) return "audio";
  return null;
}

/** Look up the time span an evidence id covers. Returns null for unknown ids. */
export function evidenceSpan(ledger: Ledger, id: string): [number, number] | null {
  switch (evidenceKind(id)) {
    case "frame": {
      const f = ledger.frames.find((x) => x.id === id);
      return f ? [f.t, f.t] : null;
    }
    case "transcript": {
      const s = ledger.transcript.find((x) => x.id === id);
      return s ? [s.start, s.end] : null;
    }
    case "shot": {
      const s = ledger.shots.find((x) => x.id === id);
      return s ? [s.start, s.end] : null;
    }
    case "audio": {
      const a = ledger.audio.find((x) => x.id === id);
      return a ? [a.start, a.end] : null;
    }
    default:
      return null;
  }
}

/** Server-derived span for a set of evidence ids. The model never writes timestamps. */
export function deriveSpan(ledger: Ledger, ids: string[]): { start: number; end: number } | null {
  const spans = ids.map((id) => evidenceSpan(ledger, id)).filter((s): s is [number, number] => s !== null);
  if (spans.length === 0) return null;
  return { start: Math.min(...spans.map((s) => s[0])), end: Math.max(...spans.map((s) => s[1])) };
}

export function formatTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec - m * 60;
  return `${m}:${s < 10 ? "0" : ""}${s.toFixed(1)}`;
}
