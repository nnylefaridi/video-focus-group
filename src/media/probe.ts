import fs from "node:fs";
import { run } from "./exec";
import { LIMITS } from "@/server/config";

export class UploadRejected extends Error {}

/** Check the first bytes: we never trust the file extension or MIME type. */
export function sniffContainer(file: string): "mp4" | "webm" | null {
  const fd = fs.openSync(file, "r");
  const head = Buffer.alloc(16);
  fs.readSync(fd, head, 0, 16, 0);
  fs.closeSync(fd);
  if (head.subarray(4, 8).toString("latin1") === "ftyp") return "mp4"; // mp4 / mov / m4v
  if (head.readUInt32BE(0) === 0x1a45dfa3) return "webm"; // EBML (webm / mkv)
  return null;
}

export type Probe = { durationSec: number; width: number; height: number; hasAudio: boolean; rotation: number };

export async function probe(file: string): Promise<Probe> {
  let data: {
    format?: { duration?: string; format_name?: string };
    streams?: { codec_type: string; width?: number; height?: number; duration?: string; side_data_list?: { rotation?: number }[]; tags?: { rotate?: string } }[];
  };
  try {
    const { stdout } = await run("ffprobe", ["-v", "error", "-show_format", "-show_streams", "-of", "json", file], { timeoutMs: 30_000 });
    data = JSON.parse(stdout);
  } catch {
    throw new UploadRejected("That file couldn't be read as a video.");
  }
  const video = data.streams?.find((s) => s.codec_type === "video");
  if (!video || !video.width || !video.height) throw new UploadRejected("That file doesn't contain a video track.");
  const durationSec = Number(data.format?.duration ?? video.duration ?? 0);
  if (!Number.isFinite(durationSec) || durationSec < LIMITS.minDurationSec)
    throw new UploadRejected("That video is too short to review.");
  if (durationSec > LIMITS.maxDurationSec + 0.5)
    throw new UploadRejected(`That video is ${Math.round(durationSec)} seconds long. The limit is 3 minutes.`);
  if (Math.max(video.width, video.height) > LIMITS.maxDimension)
    throw new UploadRejected("That video's resolution is larger than 4K. Please export a smaller version.");
  const rotation = Math.abs(Number(video.side_data_list?.find((d) => d.rotation !== undefined)?.rotation ?? video.tags?.rotate ?? 0));
  const swap = rotation === 90 || rotation === 270;
  return {
    durationSec,
    width: swap ? video.height : video.width,
    height: swap ? video.width : video.height,
    hasAudio: Boolean(data.streams?.some((s) => s.codec_type === "audio")),
    rotation,
  };
}
