/**
 * What a browser sends after preparing a video, built here without a browser: the committed
 * 720p fixture (tests/fixtures/prepared-720.mp4, 8 s, cuts at 3.0 and 5.5 s), JPEG stills made
 * with sharp at the sizes the browser makes, and a manifest that follows the server's frame plan.
 */
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import type { Manifest } from "@/media/analysis/manifest";
import { pad, planFrames, planSprites, SPRITE_COLS, SPRITE_ROWS } from "@/media/analysis/framePlan";
import { shotsFromCuts } from "@/media/analysis/scenes";

export const VIDEO = path.resolve(import.meta.dirname, "../../fixtures/prepared-720.mp4");
const DURATION = 8;
const CUTS = [3, 5.5];

const jpeg = (width: number, height: number, r = 120) =>
  sharp({ create: { width, height, channels: 3, background: { r, g: 90, b: 60 } } }).jpeg({ quality: 70 }).toBuffer();

export async function makePrepared(): Promise<{ manifest: Manifest; files: Map<string, Buffer> }> {
  const files = new Map<string, Buffer>();
  const video = fs.readFileSync(VIDEO);
  files.set("video.mp4", video);
  const poster = await jpeg(720, 1280);
  files.set("poster.jpg", poster);
  const frames: Manifest["frames"] = [];
  const plan = planFrames(DURATION, shotsFromCuts(CUTS, DURATION));
  for (let i = 0; i < plan.length; i++) {
    const file = `frames/F${pad(i + 1, 3)}.jpg`;
    const body = await jpeg(360, 640, (i * 7) % 255);
    files.set(file, body);
    frames.push({ t: Math.min(DURATION, plan[i].t + 0.01), plannedT: plan[i].t, dense: plan[i].dense, file, bytes: body.length });
  }
  const sprites: Manifest["sprites"] = [];
  const sheets = planSprites(DURATION);
  for (let s = 0; s < sheets.length; s++) {
    const file = `sprites/P${pad(s, 3)}.jpg`;
    const body = await jpeg(SPRITE_COLS * 270, SPRITE_ROWS * 480);
    files.set(file, body);
    sprites.push({ file, bytes: body.length, cols: SPRITE_COLS, rows: SPRITE_ROWS, tileW: 270, tileH: 480, t: sheets[s] });
  }
  const manifest: Manifest = {
    v: 1,
    originalName: "my clip.mov",
    video: { durationSec: DURATION, width: 720, height: 1280, hasAudio: true, bytes: video.length },
    cuts: CUTS,
    frames,
    sprites,
    poster: { bytes: poster.length },
    loudness: Array.from({ length: DURATION }, (_, i) => (i === 0 ? null : -20)),
    silence: [{ start: 0, end: 1 }],
    transcript: [
      {
        start: 1.1,
        end: 3.4,
        text: "My cat is judging my cooking tonight.",
        words: ["My", "cat", "is", "judging", "my", "cooking", "tonight."].map((w, i) => ({ w, start: 1.1 + i * 0.3, end: 1.1 + i * 0.3 + 0.28, p: null })),
      },
    ],
    tools: { mediabunny: "1.66.0", transformers: "4.3.2", model: "onnx-community/whisper-base_timestamped" },
  };
  return { manifest, files };
}
