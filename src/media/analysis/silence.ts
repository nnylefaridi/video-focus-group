import { r2 } from "./framePlan";

/**
 * Silent stretches, with the meaning of ffmpeg's `silencedetect=n=-45dB:d=0.5`: a sample is silent
 * when its size is below −45 dBFS, and a run of silent samples counts once it lasts at least 0.5 s.
 * A run still open at the end of the audio runs to the end of the video. Pure and streaming.
 */

export const SILENCE_DB = -45;
export const SILENCE_MIN_SEC = 0.5;

export class SilenceDetector {
  private readonly threshold = Math.pow(10, SILENCE_DB / 20);
  private readonly minSamples: number;
  private n = 0; // samples seen so far
  private runStart = -1; // index of the first sample in the current silent run, or -1
  private readonly spans: { start: number; end: number }[] = [];

  constructor(readonly sampleRate: number) {
    if (!(sampleRate > 0)) throw new Error(`Unsupported sample rate ${sampleRate}`);
    this.minSamples = Math.ceil(SILENCE_MIN_SEC * sampleRate);
  }

  /** Add the next mono samples (−1…1), in order. */
  push(samples: ArrayLike<number>): void {
    for (let i = 0; i < samples.length; i++, this.n++) {
      if (Math.abs(samples[i]) < this.threshold) {
        if (this.runStart < 0) this.runStart = this.n;
      } else if (this.runStart >= 0) {
        if (this.n - this.runStart >= this.minSamples) this.spans.push({ start: this.runStart / this.sampleRate, end: this.n / this.sampleRate });
        this.runStart = -1;
      }
    }
  }

  /** The silent spans, in seconds. An open run lasting at least 0.5 s runs to `durationSec`. */
  result(durationSec: number): { start: number; end: number }[] {
    const out = [...this.spans];
    if (this.runStart >= 0 && this.n - this.runStart >= this.minSamples) out.push({ start: this.runStart / this.sampleRate, end: durationSec });
    return out.map((s) => ({ start: r2(s.start), end: r2(Math.min(durationSec, Math.max(s.start, s.end))) }));
  }
}

/** Convenience for whole buffers (tests, short clips). */
export function silenceSpans(samples: ArrayLike<number>, sampleRate: number, durationSec: number) {
  const d = new SilenceDetector(sampleRate);
  d.push(samples);
  return d.result(durationSec);
}
