import fs from "node:fs";
import path from "node:path";
import { run, mapLimit } from "./exec";
import type { Probe } from "./probe";
import type { AudioSpan, Frame, Shot, TranscriptSegment } from "@/core/evidence";
import { WHISPER_MODEL } from "@/server/config";

const pad = (n: number, w: number) => String(n).padStart(w, "0");
const r2 = (n: number) => Math.round(n * 100) / 100;

/** Normalize to H.264/AAC MP4 (metadata stripped, long side ≤ 1080), plus a poster and 16 kHz mono WAV. */
export async function normalize(dir: string, original: string, p: Probe) {
  const out = path.join(dir, "video.mp4");
  const scale = "scale='if(gte(iw,ih),min(1080,iw),-2)':'if(gte(iw,ih),-2,min(1080,ih))'";
  await run("ffmpeg", [
    "-y", "-v", "error", "-i", original,
    "-map", "0:v:0", "-map", "0:a:0?", "-map_metadata", "-1", "-map_chapters", "-1",
    "-vf", `${scale},format=yuv420p`,
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "22",
    "-c:a", "aac", "-b:a", "128k", "-ac", "2",
    "-movflags", "+faststart", out,
  ]);
  await run("ffmpeg", ["-y", "-v", "error", "-ss", String(Math.min(0.5, p.durationSec / 2)), "-i", out, "-frames:v", "1", "-vf", "scale=-2:720", "-q:v", "4", path.join(dir, "poster.jpg")]);
  if (p.hasAudio) {
    await run("ffmpeg", ["-y", "-v", "error", "-i", out, "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", path.join(dir, "audio.wav")]);
  }
}

/** Scene-change detection on a downscaled copy. */
export async function detectShots(dir: string, duration: number): Promise<Shot[]> {
  const { stderr } = await run("ffmpeg", [
    "-v", "info", "-i", path.join(dir, "video.mp4"),
    "-vf", "scale=320:-2,select='gt(scene,0.3)',showinfo", "-an", "-f", "null", "-",
  ]);
  const cuts = [...stderr.matchAll(/pts_time:([\d.]+)/g)]
    .map((m) => Number(m[1]))
    .filter((t) => t > 0.2 && t < duration - 0.2);
  const bounds = [0, ...cuts.filter((t, i, a) => i === 0 || t - a[i - 1] > 0.2), duration];
  const shots: Shot[] = [];
  for (let i = 0; i < bounds.length - 1; i++) {
    shots.push({ id: `S${pad(i + 1, 2)}`, start: r2(bounds[i]), end: r2(bounds[i + 1]) });
  }
  return shots;
}

function planFrameTimes(duration: number, shots: Shot[], cap = 120): number[] {
  const end = Math.max(0, duration - 0.05);
  for (const interval of [1, 1.5, 2, 3, 4, 6]) {
    const t: number[] = [];
    for (let x = 0; x < Math.min(3, end); x += 0.25) t.push(x); // the hook, densely
    for (let x = 3; x <= end; x += interval) t.push(x);
    for (const s of shots.slice(0, 60)) {
      t.push(Math.min(end, s.start + 0.05));
      if (s.end - s.start > 1.2) t.push((s.start + s.end) / 2);
    }
    const sorted = t.map((x) => Math.min(end, Math.max(0, x))).sort((a, b) => a - b);
    const dedup = sorted.filter((x, i) => i === 0 || x - sorted[i - 1] >= 0.15);
    if (dedup.length <= cap || interval === 6) return dedup.slice(0, cap);
  }
  return [];
}

async function grabFrame(dir: string, t: number, id: string) {
  await run("ffmpeg", [
    "-y", "-v", "error", "-ss", t.toFixed(3), "-i", path.join(dir, "video.mp4"),
    "-frames:v", "1", "-vf", "scale='if(gte(iw,ih),640,-2)':'if(gte(iw,ih),-2,640)'", "-q:v", "3",
    path.join(dir, "frames", `${id}.jpg`),
  ]);
}

function shotAt(shots: Shot[], t: number): string | null {
  return shots.find((s) => t >= s.start && t < s.end)?.id ?? shots.at(-1)?.id ?? null;
}

export async function sampleFrames(dir: string, duration: number, shots: Shot[]): Promise<Frame[]> {
  fs.mkdirSync(path.join(dir, "frames"), { recursive: true });
  const times = planFrameTimes(duration, shots);
  const frames = times.map((t, i) => ({ id: `F${pad(i + 1, 3)}`, t: r2(t), file: `frames/F${pad(i + 1, 3)}.jpg`, shotId: shotAt(shots, t), dense: false }));
  await mapLimit(frames, 6, (f) => grabFrame(dir, f.t, f.id));
  return frames.filter((f) => fs.existsSync(path.join(dir, f.file)));
}

/** Extra frames around one moment (8 fps), numbered after the existing ones. */
export async function denseSample(dir: string, existing: Frame[], shots: Shot[], duration: number, center: number, radius = 1.5): Promise<Frame[]> {
  const start = Math.max(0, center - radius);
  const end = Math.min(duration - 0.05, center + radius);
  const have = existing.map((f) => f.t);
  let n = existing.reduce((m, f) => Math.max(m, Number(f.id.slice(1))), 0);
  const frames: Frame[] = [];
  for (let t = start; t <= end; t += 0.125) {
    if (have.some((h) => Math.abs(h - t) < 0.06)) continue;
    n += 1;
    const id = `F${pad(n, 3)}`;
    frames.push({ id, t: r2(t), file: `frames/${id}.jpg`, shotId: shotAt(shots, t), dense: true });
  }
  await mapLimit(frames, 6, (f) => grabFrame(dir, f.t, f.id));
  return frames.filter((f) => fs.existsSync(path.join(dir, f.file)));
}

type WhisperToken = { text: string; offsets: { from: number; to: number }; p: number };
type WhisperSegment = { offsets: { from: number; to: number }; text: string; tokens?: WhisperToken[] };

const NON_SPEECH = /^\s*[[(*♪].*[\])*♪]?\s*$/;

export async function transcribe(dir: string): Promise<TranscriptSegment[]> {
  const wav = path.join(dir, "audio.wav");
  if (!fs.existsSync(wav)) return [];
  if (!fs.existsSync(WHISPER_MODEL)) throw new Error(`Whisper model not found at ${WHISPER_MODEL}`);
  const base = path.join(dir, "transcript");
  await run("whisper-cli", ["-m", WHISPER_MODEL, "-f", wav, "-ojf", "-of", base, "-np", "-l", "en"]);
  const data = JSON.parse(fs.readFileSync(`${base}.json`, "utf8")) as { transcription: WhisperSegment[] };

  const segments: TranscriptSegment[] = [];
  for (const seg of data.transcription ?? []) {
    const text = seg.text.trim();
    if (!text || NON_SPEECH.test(text)) continue;
    const words: TranscriptSegment["words"] = [];
    for (const tok of seg.tokens ?? []) {
      if (tok.text.startsWith("[_") || !tok.text.trim()) continue;
      const start = tok.offsets.from / 1000;
      const end = tok.offsets.to / 1000;
      if (tok.text.startsWith(" ") || words.length === 0) {
        words.push({ w: tok.text.trim(), start, end, p: tok.p });
      } else {
        const last = words[words.length - 1];
        last.w += tok.text;
        last.end = end;
        last.p = Math.min(last.p, tok.p);
      }
    }
    const meanP = words.length ? words.reduce((s, w) => s + w.p, 0) / words.length : 0;
    segments.push({
      id: `T${pad(segments.length + 1, 2)}`,
      start: r2(seg.offsets.from / 1000),
      end: r2(seg.offsets.to / 1000),
      text,
      words: words.map((w) => ({ ...w, start: r2(w.start), end: r2(w.end), p: r2(w.p) })),
      lowConfidence: meanP < 0.5,
    });
  }
  return segments;
}

export async function audioSignals(dir: string, duration: number, transcript: TranscriptSegment[]) {
  const wav = path.join(dir, "audio.wav");
  const seconds = Math.ceil(duration);
  if (!fs.existsSync(wav)) {
    return { audio: [] as AudioSpan[], loudness: Array<number | null>(seconds).fill(null), speechRate: [] as [number, number][] };
  }

  // Momentary loudness every 100 ms → loudest value per second.
  const { stderr: lstderr } = await run("ffmpeg", ["-v", "info", "-nostats", "-i", wav, "-af", "ebur128", "-f", "null", "-"]);
  const loud: (number | null)[] = Array(seconds).fill(null);
  for (const m of lstderr.matchAll(/t:\s*([\d.]+)\s+TARGET:[^M]*M:\s*(-?[\d.]+)/g)) {
    const sec = Math.min(seconds - 1, Math.floor(Number(m[1])));
    const v = Number(m[2]);
    if (v > -70 && (loud[sec] === null || v > (loud[sec] as number))) loud[sec] = Math.round(v * 10) / 10;
  }

  const { stderr: sstderr } = await run("ffmpeg", ["-v", "info", "-nostats", "-i", wav, "-af", "silencedetect=n=-45dB:d=0.5", "-f", "null", "-"]);
  const spans: Omit<AudioSpan, "id">[] = [];
  let open: number | null = null;
  for (const line of sstderr.split("\n")) {
    const s = line.match(/silence_start:\s*(-?[\d.]+)/);
    const e = line.match(/silence_end:\s*([\d.]+)/);
    if (s) open = Math.max(0, Number(s[1]));
    if (e && open !== null) {
      spans.push({ start: r2(open), end: r2(Number(e[1])), kind: "silence" });
      open = null;
    }
  }
  if (open !== null) spans.push({ start: r2(open), end: r2(duration), kind: "silence" });

  // Seconds with sound but no transcribed words → likely music or effects (not identified).
  const words = transcript.flatMap((s) => s.words);
  const hasWord = (sec: number) => words.some((w) => w.start < sec + 1 && w.end > sec);
  let runStart: number | null = null;
  for (let sec = 0; sec <= seconds; sec++) {
    const sound = sec < seconds && loud[sec] !== null && (loud[sec] as number) > -50 && !hasWord(sec);
    if (sound && runStart === null) runStart = sec;
    if (!sound && runStart !== null) {
      if (sec - runStart >= 1.5) spans.push({ start: runStart, end: Math.min(duration, sec), kind: "sound_without_speech" });
      runStart = null;
    }
  }

  const audio = spans
    .sort((a, b) => a.start - b.start)
    .map((s, i) => ({ id: `A${pad(i + 1, 2)}`, ...s }));

  const speechRate: [number, number][] = [];
  for (let t = 0; t < duration; t += 2) {
    const n = words.filter((w) => w.start >= t && w.start < t + 2).length;
    speechRate.push([t, Math.round((n / Math.min(2, duration - t)) * 10) / 10]);
  }

  return { audio, loudness: loud, speechRate };
}
