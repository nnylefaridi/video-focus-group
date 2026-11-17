import type { VideoFacts } from "@/core/uploadChecks";

/**
 * Reads a video's length and size on screen from its metadata, using a <video> that is
 * never shown. Null when the browser can't read it (some phones' formats): the server
 * still checks the file, so that's not a reason to stop.
 */
export function readVideoMeta(file: File, timeoutMs = 8000): Promise<VideoFacts | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement("video");
    let done = false;
    const finish = (v: VideoFacts | null) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      video.removeAttribute("src");
      video.load();
      URL.revokeObjectURL(url);
      resolve(v);
    };
    const timer = setTimeout(() => finish(null), timeoutMs);
    video.preload = "metadata";
    video.muted = true;
    video.onloadedmetadata = () => finish({ durationSec: video.duration, width: video.videoWidth, height: video.videoHeight });
    video.onerror = () => finish(null);
    video.src = url;
  });
}
