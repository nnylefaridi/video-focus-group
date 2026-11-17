/**
 * Prepares a video on the person's own device before anything is sent: a 720p MP4 without
 * metadata, the cuts, the sampled frames, sprite sheets for close looks later, a poster, the
 * loudness and silences, and a word-timed transcript. Only these are uploaded; the original
 * file never leaves the device. Every time recorded here comes from the media itself (decoded
 * frame and sample timestamps, the speech model's word alignment), and the server checks it all
 * again, since nothing from a browser is trusted.
 *
 * Browser only. Loaded with a dynamic import when a file is picked, so none of it is in the
 * first page load.
 */
import {
  ALL_FORMATS,
  BlobSource,
  BufferTarget,
  CanvasSink,
  AudioSampleSink,
  Conversion,
  Input,
  Mp4OutputFormat,
  Output,
  canEncodeAudio,
  canEncodeVideo,
  type InputVideoTrack,
} from "mediabunny";
import type { Manifest } from "@/media/analysis/manifest";
import { FRAME_MAX_BYTES, POSTER_MAX_BYTES, SPRITE_MAX_BYTES } from "@/media/analysis/manifest";
import { pad, planFrames, planSprites, SPRITE_COLS, SPRITE_ROWS } from "@/media/analysis/framePlan";
import { SceneDetector, SCENE_WIDTH, finalizeCuts, shotsFromCuts } from "@/media/analysis/scenes";
import { LoudnessMeter } from "@/media/analysis/loudness";
import { SilenceDetector } from "@/media/analysis/silence";
import { segmentWords } from "@/media/analysis/speech";
import { checkVideo } from "@/core/uploadChecks";
import { MEDIABUNNY_VERSION, SPEECH_MODEL, TRANSFORMERS_VERSION } from "./cdn";
import type { TranscribeMessage } from "./transcribe.worker";

/** A problem to show the person as it is: plain words, nothing technical. */
export class PrepareError extends Error {}

export type Phase = "convert" | "frames" | "audio" | "transcribe";
export type Progress = {
  phase: Phase;
  /** 0–1 across the whole preparation, from real work done. */
  overall: number;
  /** The speech model download, while it's happening (bytes). */
  model?: { loaded: number; total: number };
};

export type Prepared = { manifest: Manifest; files: Map<string, Blob> };

const UNSUPPORTED = "This browser can't prepare videos. Please use a recent Chrome, Edge, Safari or Firefox.";
const SHORT_SIDE = 720;
const SPRITE_TILE_H = 480;
const MAX_VIDEO_BPS = 2_500_000;
const AUDIO_BPS = 128_000;

const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);
const r3 = (n: number) => Math.round(n * 1000) / 1000;
const CONTROL = /[\u0000-\u0009\u000B-\u001F\u007F-\u009F]/g;

/** Null when this browser has what preparing a video needs, otherwise what to tell the person. */
export async function supportProblem(): Promise<string | null> {
  const g = globalThis as Record<string, unknown>;
  for (const api of ["VideoDecoder", "VideoEncoder", "AudioDecoder", "OffscreenCanvas", "Worker", "OfflineAudioContext"]) if (!(api in g)) return UNSUPPORTED;
  if (!(await canEncodeVideo("avc", { width: 720, height: 1280 }).catch(() => false))) return UNSUPPORTED;
  return null;
}

/** The size to make a video: short side at most 720, aspect kept, even numbers. */
export function targetSize(width: number, height: number): { width: number; height: number } {
  const short = Math.min(width, height);
  const k = short > SHORT_SIDE ? SHORT_SIDE / short : 1;
  return { width: even(width * k), height: even(height * k) };
}

async function canvasToJpeg(canvas: HTMLCanvasElement | OffscreenCanvas, quality: number, maxBytes: number): Promise<Blob> {
  for (const q of [quality, quality - 0.15, quality - 0.3]) {
    const blob =
      "convertToBlob" in canvas
        ? await canvas.convertToBlob({ type: "image/jpeg", quality: q })
        : await new Promise<Blob>((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error("Couldn't make a JPEG."))), "image/jpeg", q));
    if (blob.size <= maxBytes) return blob;
  }
  throw new PrepareError("A still from this video came out too big. Please try a simpler export of it.");
}

function ctx2d(canvas: HTMLCanvasElement | OffscreenCanvas) {
  const c = canvas.getContext("2d", { willReadFrequently: true }) as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
  if (!c) throw new PrepareError(UNSUPPORTED);
  return c;
}

/** Quick facts about the picked file, for the friendly checks (length, vertical) before the long work. */
export async function probeFile(file: File): Promise<{ durationSec: number; width: number; height: number }> {
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  try {
    const video = await input.getPrimaryVideoTrack().catch(() => null);
    if (!video) throw new PrepareError("That file doesn't have a video in it that this browser can read. Please export it as an MP4 and try again.");
    const durationSec = await input.computeDuration();
    return { durationSec, width: video.displayWidth, height: video.displayHeight };
  } finally {
    input.dispose();
  }
}

/** Converts to the 720p MP4 that's kept. Tries once more at a lower bitrate if the first result is over the size cap. */
async function convert(file: File, durationSec: number, size: { width: number; height: number }, maxBytes: number, onProgress: (p: number) => void): Promise<ArrayBuffer> {
  const aac = await canEncodeAudio("aac", { numberOfChannels: 2, sampleRate: 48000, bitrate: AUDIO_BPS }).catch(() => false);
  const opus = aac ? false : await canEncodeAudio("opus", { numberOfChannels: 2, sampleRate: 48000, bitrate: AUDIO_BPS }).catch(() => false);
  const budget = Math.floor((maxBytes * 0.9 * 8) / Math.max(1, durationSec)) - AUDIO_BPS;
  let bitrate = Math.max(300_000, Math.min(MAX_VIDEO_BPS, budget));
  for (let attempt = 0; attempt < 2; attempt++) {
    const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
    const target = new BufferTarget();
    const output = new Output({ format: new Mp4OutputFormat({ fastStart: "in-memory" }), target });
    try {
      const conversion = await Conversion.init({
        input,
        output,
        tracks: "primary",
        video: {
          width: size.width,
          height: size.height,
          fit: "fill",
          codec: "avc",
          bitrate,
          allowTransformationMetadata: false,
          // The second try has to re-encode to come out smaller.
          ...(attempt > 0 ? { forceTranscode: true } : {}),
        },
        // Phone audio (AAC) is copied as it is; anything else becomes AAC, or Opus where AAC can't be made.
        audio: { codec: aac || !opus ? "aac" : "opus", bitrate: AUDIO_BPS, numberOfChannels: 2 },
        // No tags: device names, locations and the like are left out.
        tags: {},
        showWarnings: false,
      });
      if (!conversion.isValid) {
        const videoGone = conversion.discardedTracks.some((d) => d.track.type === "video");
        throw new PrepareError(videoGone ? UNSUPPORTED : "This browser couldn't read the sound in that video. Please export it as an MP4 and try again.");
      }
      conversion.onProgress = (p) => onProgress(Math.min(1, p));
      await conversion.execute();
      const buf = target.buffer;
      if (!buf) throw new PrepareError("Preparing the video didn't finish. Please try again.");
      if (buf.byteLength <= maxBytes) return buf;
      bitrate = Math.floor(bitrate * 0.8 * (maxBytes / buf.byteLength));
    } finally {
      input.dispose();
    }
  }
  throw new PrepareError(`That video is too detailed to fit in ${Math.floor(maxBytes / 1024 / 1024)} MB at this length. Please trim it or export a smaller version.`);
}

async function findCuts(track: InputVideoTrack, durationSec: number, onProgress: (p: number) => void): Promise<number[]> {
  const h = even((SCENE_WIDTH * track.displayHeight) / track.displayWidth);
  const sink = new CanvasSink(track, { width: SCENE_WIDTH, height: h, fit: "fill", poolSize: 2 });
  const detector = new SceneDetector();
  for await (const { canvas, timestamp } of sink.canvases()) {
    const data = ctx2d(canvas).getImageData(0, 0, SCENE_WIDTH, h).data;
    detector.push({ t: timestamp, width: SCENE_WIDTH, height: h, rgba: data });
    onProgress(Math.min(1, timestamp / durationSec));
  }
  return finalizeCuts(detector.rawCuts, durationSec);
}

/** Grabs a frame at each time, keeping each decoded frame's own timestamp. */
async function* framesAt(sink: CanvasSink, times: number[]) {
  let i = 0;
  for await (const wrapped of sink.canvasesAtTimestamps(times)) {
    // Asked for a time before the first frame: the first frame is the honest answer.
    const w = wrapped ?? (await sink.getCanvas(Math.max(times[i], 0.001))) ?? (await sink.getCanvas(0.05));
    if (!w) throw new PrepareError("Some frames of this video couldn't be read. Please export it as an MP4 and try again.");
    yield { planned: times[i], wrapped: w };
    i++;
  }
}

/** Mono samples at the track's own rate, plus loudness and silences measured as they stream by. */
async function readAudio(input: Input, durationSec: number, onProgress: (p: number) => void) {
  const track = await input.getPrimaryAudioTrack();
  if (!track) return null;
  const sink = new AudioSampleSink(track);
  let meter: LoudnessMeter | null = null;
  let silence: SilenceDetector | null = null;
  let rate = 0;
  const chunks: Float32Array[] = [];
  for await (const sample of sink.samples()) {
    try {
      if (!meter) {
        rate = sample.sampleRate;
        meter = new LoudnessMeter(rate);
        silence = new SilenceDetector(rate);
      }
      const n = sample.numberOfFrames;
      const mono = new Float32Array(n);
      const plane = new Float32Array(n);
      for (let ch = 0; ch < sample.numberOfChannels; ch++) {
        sample.copyTo(plane, { planeIndex: ch, format: "f32-planar" });
        for (let i = 0; i < n; i++) mono[i] += plane[i] / sample.numberOfChannels;
      }
      meter.push(mono);
      silence!.push(mono);
      chunks.push(mono);
      onProgress(Math.min(1, (sample.timestamp + sample.duration) / durationSec));
    } finally {
      sample.close();
    }
  }
  if (!meter) return null;
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const samples = new Float32Array(total);
  let at = 0;
  for (const c of chunks) {
    samples.set(c, at);
    at += c.length;
  }
  return { samples, rate, loudness: meter.perSecond(durationSec), silence: silence!.result(durationSec) };
}

async function to16k(samples: Float32Array, rate: number): Promise<Float32Array> {
  const length = Math.ceil((samples.length * 16000) / rate);
  const ctx = new OfflineAudioContext(1, Math.max(1, length), 16000);
  const buffer = ctx.createBuffer(1, samples.length, rate);
  buffer.copyToChannel(samples as Float32Array<ArrayBuffer>, 0);
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  src.connect(ctx.destination);
  src.start();
  return (await ctx.startRendering()).getChannelData(0);
}

function transcribe(audio: Float32Array, onModel: (loaded: number, total: number) => void) {
  return new Promise<{ text: string; start: number; end: number | null }[]>((resolve, reject) => {
    const worker = new Worker(new URL("./transcribe.worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (e: MessageEvent<TranscribeMessage>) => {
      const m = e.data;
      if (m.type === "download") onModel(m.loaded, m.total);
      else if (m.type === "done") {
        worker.terminate();
        resolve(m.words);
      } else if (m.type === "error") {
        worker.terminate();
        console.error("[prepare] speech reader failed:", m.message);
        reject(new PrepareError("The speech reader couldn't start in this browser. Check your connection (it downloads once), then try again."));
      }
    };
    worker.onerror = (e) => {
      worker.terminate();
      console.error("[prepare] speech worker error:", e.message);
      reject(new PrepareError("The speech reader couldn't start in this browser. Please try again."));
    };
    worker.postMessage({ audio }, [audio.buffer]);
  });
}

/** Shares of the progress bar for each phase (real work in each one moves it). */
const SHARE: Record<Phase, [number, number]> = { convert: [0, 0.45], frames: [0.45, 0.65], audio: [0.65, 0.7], transcribe: [0.7, 1] };

export async function prepareVideo(file: File, opts: { maxBytes: number; onProgress: (p: Progress) => void }): Promise<Prepared> {
  const problem = await supportProblem();
  if (problem) throw new PrepareError(problem);
  let model: Progress["model"];
  const report = (phase: Phase, p: number) => {
    const [a, b] = SHARE[phase];
    opts.onProgress({ phase, overall: a + (b - a) * Math.max(0, Math.min(1, p)), model });
  };

  // 1. The original: quick facts and the friendly checks.
  const facts = await probeFile(file);
  const bad = checkVideo(facts);
  if (bad) throw new PrepareError(bad);
  if (!(facts.durationSec >= 1)) throw new PrepareError("That video is shorter than a second. Please choose a longer one.");

  // 2. The 720p MP4.
  report("convert", 0);
  const mp4 = await convert(file, facts.durationSec, targetSize(facts.width, facts.height), opts.maxBytes, (p) => report("convert", p));
  const files = new Map<string, Blob>([["video.mp4", new Blob([mp4], { type: "video/mp4" })]]);

  // Everything else is measured on the 720p copy, so each frame matches what plays in the room.
  const input = new Input({ source: new BlobSource(files.get("video.mp4")!), formats: ALL_FORMATS });
  try {
    const video = await input.getPrimaryVideoTrack();
    if (!video) throw new PrepareError(UNSUPPORTED);
    const durationSec = r3(await input.computeDuration());
    const width = video.displayWidth;
    const height = video.displayHeight;

    // 3. Cuts, frames, sprite sheets, poster.
    report("frames", 0);
    const cuts = await findCuts(video, durationSec, (p) => report("frames", p * 0.4));
    const planned = planFrames(durationSec, shotsFromCuts(cuts, durationSec));
    const frameH = Math.min(640, height);
    const frameW = even((frameH * width) / height);
    const frameSink = new CanvasSink(video, { width: frameW, height: frameH, fit: "fill", poolSize: 2 });
    const frames: Manifest["frames"] = [];
    let i = 0;
    for await (const { planned: t, wrapped } of framesAt(frameSink, planned.map((p) => p.t))) {
      const blob = await canvasToJpeg(wrapped.canvas, 0.8, FRAME_MAX_BYTES);
      const name = `frames/F${pad(i + 1, 3)}.jpg`;
      files.set(name, blob);
      frames.push({ t: r3(Math.max(0, wrapped.timestamp)), plannedT: t, dense: planned[i].dense, file: name, bytes: blob.size });
      i++;
      report("frames", 0.4 + (0.3 * i) / planned.length);
    }

    const tileH = Math.min(SPRITE_TILE_H, height);
    const tileW = even((tileH * width) / height);
    const tileSink = new CanvasSink(video, { width: tileW, height: tileH, fit: "fill", poolSize: 2 });
    const sheets = planSprites(durationSec);
    const sprites: Manifest["sprites"] = [];
    for (let s = 0; s < sheets.length; s++) {
      const sheet = new OffscreenCanvas(SPRITE_COLS * tileW, SPRITE_ROWS * tileH);
      const c = ctx2d(sheet);
      c.fillStyle = "#000";
      c.fillRect(0, 0, sheet.width, sheet.height);
      const t: number[] = [];
      let k = 0;
      for await (const { wrapped } of framesAt(tileSink, sheets[s])) {
        c.drawImage(wrapped.canvas, (k % SPRITE_COLS) * tileW, Math.floor(k / SPRITE_COLS) * tileH, tileW, tileH);
        t.push(r3(Math.max(0, wrapped.timestamp)));
        k++;
      }
      const blob = await canvasToJpeg(sheet, 0.7, SPRITE_MAX_BYTES);
      const name = `sprites/P${pad(s, 3)}.jpg`;
      files.set(name, blob);
      sprites.push({ file: name, bytes: blob.size, cols: SPRITE_COLS, rows: SPRITE_ROWS, tileW, tileH, t });
      report("frames", 0.7 + (0.25 * (s + 1)) / sheets.length);
    }

    const posterSink = new CanvasSink(video, { width, height, fit: "fill" });
    const posterFrame = (await posterSink.getCanvas(Math.min(0.5, durationSec / 2))) ?? (await posterSink.getCanvas(0.05));
    if (!posterFrame) throw new PrepareError("This video's first frames couldn't be read. Please export it as an MP4 and try again.");
    const poster = await canvasToJpeg(posterFrame.canvas, 0.85, POSTER_MAX_BYTES);
    files.set("poster.jpg", poster);
    report("frames", 1);

    // 4. Sound: loudness, silences, then the words.
    report("audio", 0);
    const audio = await readAudio(input, durationSec, (p) => report("audio", p));
    let transcript: Manifest["transcript"] = [];
    if (audio) {
      report("transcribe", 0);
      const pcm = await to16k(audio.samples, audio.rate);
      const words = await transcribe(pcm, (loaded, total) => {
        model = total > 0 && loaded < total ? { loaded, total } : undefined;
        report("transcribe", 0.05);
      });
      transcript = segmentWords(
        words.map((w) => ({ ...w, text: w.text.replace(CONTROL, " ") })),
        durationSec,
      ).map((s) => ({ ...s, text: s.text.slice(0, 500) }));
    }
    report("transcribe", 1);

    const manifest: Manifest = {
      v: 1,
      originalName: file.name.replace(CONTROL, "").slice(0, 200),
      video: { durationSec, width, height, hasAudio: Boolean(audio), bytes: mp4.byteLength },
      cuts,
      frames,
      sprites,
      poster: { bytes: poster.size },
      loudness: audio ? audio.loudness : Array<null>(Math.ceil(durationSec)).fill(null),
      silence: audio ? audio.silence : [],
      transcript,
      tools: { mediabunny: MEDIABUNNY_VERSION, transformers: TRANSFORMERS_VERSION, model: SPEECH_MODEL },
    };
    return { manifest, files };
  } finally {
    input.dispose();
  }
}
