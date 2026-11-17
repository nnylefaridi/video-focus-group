/// <reference lib="webworker" />
/**
 * Speech to text on the person's own device, in a Web Worker so the page stays responsive.
 * Gets 16 kHz mono samples, returns each word with the start and end time the model aligned it to.
 * Nothing here invents a time: they're Whisper's own word alignments (the same kind whisper.cpp gave).
 */
import { MODEL_HOST, ORT_WASM_BASE, SPEECH_DTYPE, SPEECH_MODEL } from "./cdn";

export type TranscribeRequest = { audio: Float32Array };
export type TranscribeMessage =
  | { type: "download"; loaded: number; total: number }
  | { type: "running" }
  | { type: "done"; words: { text: string; start: number; end: number | null }[] }
  | { type: "error"; message: string };

const post = (m: TranscribeMessage) => (self as unknown as DedicatedWorkerGlobalScope).postMessage(m);

self.onmessage = async (e: MessageEvent<TranscribeRequest>) => {
  try {
    const { pipeline, env } = await import("@huggingface/transformers");
    env.allowLocalModels = false;
    env.remoteHost = MODEL_HOST.replace(/\/?$/, "/");
    const onnx = env.backends.onnx as { wasm?: { wasmPaths?: string; numThreads?: number } };
    if (onnx.wasm) {
      onnx.wasm.wasmPaths = ORT_WASM_BASE;
      // Threads need cross-origin isolation, which this site doesn't turn on; one thread is slower but works everywhere.
      onnx.wasm.numThreads = 1;
    }
    const files = new Map<string, { loaded: number; total: number }>();
    const asr = await pipeline("automatic-speech-recognition", SPEECH_MODEL, {
      dtype: SPEECH_DTYPE,
      device: "wasm",
      progress_callback: (p: { status: string; file?: string; loaded?: number; total?: number }) => {
        if (p.status !== "progress" || !p.file) return;
        files.set(p.file, { loaded: p.loaded ?? 0, total: p.total ?? 0 });
        let loaded = 0;
        let total = 0;
        for (const f of files.values()) {
          loaded += f.loaded;
          total += f.total;
        }
        post({ type: "download", loaded, total });
      },
    });
    post({ type: "running" });
    const out = (await asr(e.data.audio, {
      return_timestamps: "word",
      chunk_length_s: 30,
      stride_length_s: 5,
      language: "en",
      task: "transcribe",
    })) as { chunks?: { text: string; timestamp: [number, number | null] }[] };
    const words = (out.chunks ?? []).map((c) => ({ text: c.text, start: c.timestamp[0], end: c.timestamp[1] ?? null }));
    post({ type: "done", words });
  } catch (err) {
    post({ type: "error", message: err instanceof Error ? err.message : String(err) });
  }
};
