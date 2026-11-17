import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import type { Frame, Ledger } from "@/core/evidence";
import { pad, shotAt } from "@/media/analysis/framePlan";
import { isHosted } from "./config";
import { reviewDir } from "./reviews";
import { putSmallFile, restoreFile } from "./storage";

/** A still already in the ledger this close to a tile's time makes the tile redundant. */
const SAME_MOMENT_SEC = 0.06;

/**
 * "Take a closer look" for follow-up answers, without decoding the video again: the browser made
 * sprite sheets of small stills 4 times a second when it prepared the video, and the tiles within
 * `radius` seconds of `t` are cropped out here and become new frames. Each keeps its tile's real
 * timestamp. Reviews from before sprite sheets existed get no new frames (said plainly by the caller).
 * Returns the frames added (already written locally and, when hosted, to storage), not yet in the ledger.
 */
export async function framesFromSprites(review: { id: string; userId: string | null }, ledger: Ledger, t: number, radius = 1.5): Promise<Frame[]> {
  const sheets = ledger.sprites ?? [];
  if (!sheets.length) return [];
  const dir = reviewDir(review.id);
  let next = ledger.frames.reduce((n, f) => Math.max(n, Number(f.id.slice(1)) || 0), 0) + 1;
  const added: Frame[] = [];
  for (const sheet of sheets) {
    const tiles = sheet.t
      .map((tt, i) => ({ tt, i }))
      .filter(({ tt }) => Math.abs(tt - t) <= radius && !ledger.frames.some((f) => Math.abs(f.t - tt) < SAME_MOMENT_SEC));
    if (!tiles.length) continue;
    if (isHosted() && review.userId) await restoreFile(review.userId, review.id, sheet.file);
    const src = path.join(/* turbopackIgnore: true */ dir, sheet.file);
    if (!fs.existsSync(src)) continue;
    const image = fs.readFileSync(src);
    for (const { tt, i } of tiles) {
      const left = (i % sheet.cols) * sheet.tileW;
      const top = Math.floor(i / sheet.cols) * sheet.tileH;
      const data = await sharp(image).extract({ left, top, width: sheet.tileW, height: sheet.tileH }).jpeg({ quality: 85 }).toBuffer();
      const id = `F${pad(next++, 3)}`;
      const file = `frames/${id}.jpg`;
      fs.mkdirSync(path.join(dir, "frames"), { recursive: true });
      fs.writeFileSync(path.join(dir, file), data);
      if (isHosted() && review.userId) await putSmallFile(review.userId, review.id, file, data);
      added.push({ id, t: tt, file, shotId: shotAt(ledger.shots, tt), dense: true });
    }
  }
  return added.sort((a, b) => a.t - b.t);
}
