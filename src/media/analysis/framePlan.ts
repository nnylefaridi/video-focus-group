import type { Shot } from "@/core/evidence";

/**
 * Which moments of a video the reviewers get to see. Pure, so the browser (which grabs the frames)
 * and the server (which re-derives the plan to check what it was sent) always agree.
 */

export const r2 = (n: number) => Math.round(n * 100) / 100;
export const pad = (n: number, w: number) => String(n).padStart(w, "0");

/** The most frames sampled across a video before the extra close look at the hook. */
export const FRAME_CAP = 120;
/** The hook (the first second and a half) is looked at again at 8 frames per second. */
export const HOOK_SEC = 1.5;
export const HOOK_STEP_SEC = 0.125;

/** Sample times for a video: the first 3 s densely, then every 1–6 s, plus the start and middle of each shot. */
export function planFrameTimes(duration: number, shots: Shot[], cap = FRAME_CAP): number[] {
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

/** Which shot a time falls in (the last shot for a time at or past the end). */
export function shotAt(shots: Shot[], t: number): string | null {
  return shots.find((s) => t >= s.start && t < s.end)?.id ?? shots.at(-1)?.id ?? null;
}

/**
 * Extra frames around one moment, at 8 per second, skipping times already covered.
 * `existing` are the times already sampled.
 */
export function planDenseTimes(existing: number[], duration: number, center: number, radius = 1.5): number[] {
  const start = Math.max(0, center - radius);
  const end = Math.min(duration - 0.05, center + radius);
  const out: number[] = [];
  for (let t = start; t <= end; t += HOOK_STEP_SEC) {
    if (existing.some((h) => Math.abs(h - t) < 0.06)) continue;
    out.push(r2(t));
  }
  return out;
}

export type PlannedFrame = { t: number; dense: boolean };

/**
 * The whole sampled set in time order: the regular plan, then the hook at 8 fps filling in between.
 * Times are rounded to hundredths, so the same number can be compared exactly on both sides.
 */
export function planFrames(duration: number, shots: Shot[]): PlannedFrame[] {
  const base = planFrameTimes(duration, shots).map(r2);
  const dense = planDenseTimes(base, duration, HOOK_SEC / 2, HOOK_SEC / 2);
  return [...base.map((t) => ({ t, dense: false })), ...dense.map((t) => ({ t, dense: true }))].sort((a, b) => a.t - b.t);
}

/** How far a frame's real time may sit from its planned time: one frame of a slow video, and no more. */
export const FRAME_TOLERANCE_SEC = 0.25;

/** Inspect sprite sheets: every video looked at 4 times a second, 40 tiles (8 × 5) to a sheet. */
export const SPRITE_FPS = 4;
export const SPRITE_COLS = 8;
export const SPRITE_ROWS = 5;
export const SPRITE_TILES = SPRITE_COLS * SPRITE_ROWS;
/** Real tile times may sit this far from the 0.25 s grid. */
export const SPRITE_TOLERANCE_SEC = 0.1;

/** The tile times (seconds) of every sprite sheet, as sheets of up to 40 tiles. A sheet covers 10 s. */
export function planSprites(duration: number): number[][] {
  const end = Math.max(0, duration - 0.05);
  const total = Math.floor(end * SPRITE_FPS) + 1;
  const sheets: number[][] = [];
  for (let i = 0; i < total; i += SPRITE_TILES) {
    const tiles: number[] = [];
    for (let k = i; k < Math.min(total, i + SPRITE_TILES); k++) tiles.push(k / SPRITE_FPS);
    sheets.push(tiles);
  }
  return sheets;
}

/** How many sheets a video of this length has. */
export const spriteCount = (duration: number) => planSprites(duration).length;
