/**
 * Where the browser fetches the big, one-time downloads for preparing a video. They come from
 * public CDNs, never from this app's own server, so a host with a small bandwidth allowance
 * isn't spent on them (and browsers cache them after the first time).
 *  - The speech model: Hugging Face (about 79 MB, once per browser).
 *  - The ONNX runtime's WebAssembly: jsDelivr, pinned to the exact version transformers.js uses.
 * Override with NEXT_PUBLIC_MODEL_HOST / NEXT_PUBLIC_ORT_WASM_BASE (for a mirror).
 */

/** Must equal the installed onnxruntime-web version (a unit test checks it). */
export const ORT_VERSION = "1.31.0-dev.20260914-8d85527a0";
export const ORT_WASM_BASE = process.env.NEXT_PUBLIC_ORT_WASM_BASE || `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ORT_VERSION}/dist/`;
export const MODEL_HOST = process.env.NEXT_PUBLIC_MODEL_HOST || "https://huggingface.co";

/**
 * Whisper base (multilingual) exported with cross-attentions, which word-level timestamps need
 * (onnx-community/whisper-base.en isn't, and fails with word timestamps). Run in English.
 */
export const SPEECH_MODEL = "onnx-community/whisper-base_timestamped";
export const SPEECH_DTYPE = "q8";
export const MEDIABUNNY_VERSION = "1.66.0";
export const TRANSFORMERS_VERSION = "4.3.2";
