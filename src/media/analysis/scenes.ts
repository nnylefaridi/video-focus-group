import type { Shot } from "@/core/evidence";
import { pad, r2 } from "./framePlan";

/**
 * Cut detection from small decoded frames, the same measure as ffmpeg's `select='gt(scene,0.3)'`:
 * the mean absolute difference between neighbouring frames over all of Y, U and V (4:2:0), as a
 * percentage of full scale, then min(difference, change in difference) / 100.
 * Pure: frames go in, cut times come out. The browser feeds it frames from the finished 720p video.
 */

/** Frames are drawn this wide (height follows the video) before they're compared. */
export const SCENE_WIDTH = 64;
export const SCENE_THRESHOLD = 0.3;
/** Frames closer together than this are skipped, so a 60 fps video is judged like a 30 fps one. */
export const SCENE_MIN_GAP_SEC = 1 / 30 - 0.002;

export type SceneFrame = { t: number; width: number; height: number; rgba: ArrayLike<number> };
type Planes = { y: Uint8Array; u: Uint8Array; v: Uint8Array };

/** BT.601 limited-range YUV, with chroma averaged over 2 × 2 pixels (what ffmpeg sees for yuv420p). */
export function toPlanes(f: SceneFrame): Planes {
  const { width: w, height: h, rgba } = f;
  const cw = Math.ceil(w / 2);
  const ch = Math.ceil(h / 2);
  const y = new Uint8Array(w * h);
  const uSum = new Float32Array(cw * ch);
  const vSum = new Float32Array(cw * ch);
  const n = new Uint8Array(cw * ch);
  for (let row = 0; row < h; row++) {
    for (let col = 0; col < w; col++) {
      const i = (row * w + col) * 4;
      const r = rgba[i];
      const g = rgba[i + 1];
      const b = rgba[i + 2];
      y[row * w + col] = 16 + 0.257 * r + 0.504 * g + 0.098 * b;
      const c = (row >> 1) * cw + (col >> 1);
      uSum[c] += 128 - 0.148 * r - 0.291 * g + 0.439 * b;
      vSum[c] += 128 + 0.439 * r - 0.368 * g - 0.071 * b;
      n[c]++;
    }
  }
  const u = new Uint8Array(cw * ch);
  const v = new Uint8Array(cw * ch);
  for (let c = 0; c < u.length; c++) {
    u[c] = uSum[c] / n[c];
    v[c] = vSum[c] / n[c];
  }
  return { y, u, v };
}

function sad(a: Uint8Array, b: Uint8Array): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += Math.abs(a[i] - b[i]);
  return s;
}

export class SceneDetector {
  private prev: Planes | null = null;
  private prevMafd = 0;
  private lastT = -Infinity;
  /** Every compared frame's time and score, for tests and tuning. */
  readonly scores: { t: number; score: number }[] = [];

  /** Feed the next frame, in time order. Returns its score, or null if the frame was skipped (above 30 fps) or is the first. */
  push(frame: SceneFrame): number | null {
    if (frame.t - this.lastT < SCENE_MIN_GAP_SEC) return null;
    this.lastT = frame.t;
    const cur = toPlanes(frame);
    const prev = this.prev;
    this.prev = cur;
    if (!prev || prev.y.length !== cur.y.length) return null;
    const count = cur.y.length + cur.u.length + cur.v.length;
    const mafd = (sad(prev.y, cur.y) + sad(prev.u, cur.u) + sad(prev.v, cur.v)) * 100 / count / 256;
    const diff = Math.abs(mafd - this.prevMafd);
    this.prevMafd = mafd;
    const score = Math.min(1, Math.max(0, Math.min(mafd, diff) / 100));
    this.scores.push({ t: frame.t, score });
    return score;
  }

  /** Times where a new shot starts, before the end-of-video and too-close filtering of `finalizeCuts`. */
  get rawCuts(): number[] {
    return this.scores.filter((s) => s.score > SCENE_THRESHOLD).map((s) => s.t);
  }
}

/** Drops cuts within 0.2 s of either end of the video or of the cut before; the rest are kept in order. */
export function finalizeCuts(raw: number[], duration: number): number[] {
  return raw
    .filter((t) => t > 0.2 && t < duration - 0.2)
    .filter((t, i, a) => i === 0 || t - a[i - 1] > 0.2)
    .map(r2);
}

/** Shots from cut times: S01 starts at 0, each cut starts the next, the last ends at the video's end. */
export function shotsFromCuts(cuts: number[], duration: number): Shot[] {
  const bounds = [0, ...cuts, duration];
  const shots: Shot[] = [];
  for (let i = 0; i < bounds.length - 1; i++) {
    shots.push({ id: `S${pad(i + 1, 2)}`, start: r2(bounds[i]), end: r2(bounds[i + 1]) });
  }
  return shots;
}
