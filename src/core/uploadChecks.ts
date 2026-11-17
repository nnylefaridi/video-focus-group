/**
 * Checks on a video before it's uploaded, so people hear about a problem in seconds
 * instead of after a long upload. Only for a friendlier experience: the server checks
 * everything again from the file's own bytes and never trusts these.
 */

export const MAX_DURATION_SEC = 180;
/**
 * The biggest file that can be picked. Only a friendliness check: the original never leaves the
 * device (a smaller 720p copy is made and sent), so nothing over the network depends on it.
 */
export const MAX_PICK_MB = 2048;

const EXTENSIONS = [".mp4", ".mov", ".m4v", ".webm"];
const MIME_TYPES = ["video/mp4", "video/quicktime", "video/x-m4v", "video/webm"];

/** The file picker's `accept` list. */
export const ACCEPT = [...MIME_TYPES, ...EXTENSIONS].join(",");

export type FileFacts = { name: string; type: string; size: number };
export type VideoFacts = { durationSec: number; width: number; height: number };

function extensionOf(name: string): string {
  const i = name.lastIndexOf(".");
  return i < 0 ? "" : name.slice(i).toLowerCase();
}

/** What's wrong with the file by its name, type and size alone (null when nothing is). */
export function checkFile(file: FileFacts, maxMb: number): string | null {
  if (file.size === 0) return "That file is empty.";
  // Some browsers don't know a video's type and leave it blank; the extension still has to match.
  const typeOk = file.type === "" || MIME_TYPES.includes(file.type.toLowerCase());
  if (!EXTENSIONS.includes(extensionOf(file.name)) || !typeOk) return "That doesn't look like an MP4, MOV or WebM video. Please choose one of those.";
  if (file.size > maxMb * 1024 * 1024) return `That file is larger than ${maxMb >= 1024 ? `${maxMb / 1024} GB` : `${maxMb} MB`}. Please export a smaller version.`;
  return null;
}

/** What's wrong with the video itself, from its length and size on screen (null when nothing is). */
export function checkVideo(v: VideoFacts): string | null {
  if (Number.isFinite(v.durationSec) && v.durationSec > MAX_DURATION_SEC + 0.5) {
    return `That video is ${formatLength(v.durationSec)} long. The limit is 3 minutes, so please trim it and try again.`;
  }
  if (!(v.width > 0 && v.height > 0) || isTallerThanWide(v)) return null;
  return "Video Focus Group reviews vertical videos (like 9:16 for TikTok, Reels and Shorts), and this one is wider than it is tall. Please export a vertical version and try again.";
}

export function isTallerThanWide(v: Pick<VideoFacts, "width" | "height">): boolean {
  return v.height > v.width;
}

function formatLength(sec: number): string {
  const s = Math.round(sec);
  return s >= 60 ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}` : `${s} seconds`;
}
