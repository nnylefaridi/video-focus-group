# Plan: video processing in the browser, the standard Next.js server, 720p and 50 MB

Status: design only (Task 8a). Nothing here is built yet. Written 2026-11-17 against `launch/public-v1` at `69bf688`.

Three approved changes, designed together because they share one goal: run the hosted site on a small free host with no always-on worker.

1. All video processing moves into the user's browser. The server runs no ffmpeg and no whisper.
2. `server.mjs` goes. The app runs on Next.js's own server (`next dev`, `next start`, and the `output: "standalone"` `server.js` in Docker).
3. Processed video is 720p (short side ≤ 720) and `MAX_UPLOAD_MB` defaults to 50 in hosted mode, which is Supabase Free's per-file cap.

Marking used below: **[verified]** means checked in this repo, in `node_modules/next/dist/docs`, or with `npm view` / `npm pack --dry-run` on 2026-11-17. **[unverified]** means it hasn't been checked yet; the step that checks it is named.

---

## 0. Host constraints (design target)

Target is Koyeb's free instance, with Render's free tier as the fallback. These constraints go into `docs/hosting.md` in step 4.

| Constraint | Value | What the design does about it |
| --- | --- | --- |
| RAM | 512 MB | No ffmpeg or whisper on the server. Media is streamed, never held whole. `sharp` concurrency is set to 1. At most 2 reviews run at once per process. Target: idle under 200 MB, peak under 350 MB (measured in step 1). |
| CPU | 0.1 vCPU | The server's only CPU work is `sharp` labelling frames, crops and JSON. Everything heavy happens on the user's device. |
| HTTP request timeout | 100 s | No request is held open for a review. Chat answers stream in segments of 75 s or less and can be resumed. Video uploads go straight to Supabase and never pass through the host. |
| Sleeps when idle | Koyeb: after 1 h. Render: after 15 min, and it may restart at any time. | Job state lives in Postgres with a lease. Unfinished jobs resume when the server boots, when someone polls the review page, and on the health check. Every step is idempotent. |
| Persistent disk | None | Nothing depends on local disk in hosted mode. `/tmp` is only a cache that can be rebuilt (about 30 MB per running review). |

---

## 1. Where every step runs: now and after

### Now [verified, from the code]

| Step | Where | Code |
| --- | --- | --- |
| Quick checks: type, size, duration, vertical | Browser (hosted only) | `UploadStep.tsx`, `readVideoMeta.ts`, `core/uploadChecks.ts` |
| Upload the original | Local: `PUT /api/reviews/[id]/video` streams it to disk, then ffprobe. Hosted: signed URL straight to the `review-uploads` bucket, then `upload-complete` checks the size. | `video/route.ts`, `upload-url`, `upload-complete`, `storage.ts` |
| Intake: download, magic bytes, ffprobe, vertical | Worker (hosted) | `server/intake.ts`, `media/probe.ts` |
| Normalize to H.264/AAC, long side ≤ 1080, strip metadata, poster, 16 kHz WAV | Worker, ffmpeg | `media/pipeline.ts: normalize` |
| Transcribe with word timings (whisper.cpp, `ggml-base.en`) and write captions.vtt | Worker | `transcribe`, `writeCaptions` |
| Shot detection (scene > 0.3 on 320 px) | Worker, ffmpeg | `detectShots` |
| Frame sampling (≤ 120 frames, 640 px long side) and the hook at 8 fps for 0–1.5 s | Worker, ffmpeg | `sampleFrames`, `denseSample` |
| Loudness (ebur128 momentary, loudest per second), silencedetect at −45 dB for 0.5 s, sound without speech, speech rate | Worker, ffmpeg plus JS | `audioSignals` |
| Perception, reviewer passes, discussion, synthesis (Claude) | Worker | `server/process.ts`, `ai/*` |
| Copy media to `review-media`, re-encoding at 720p if over 50 MB | Worker (`store` job) | `storage.ts: storeReviewMedia, fitVideo` |
| Follow-up `inspect`: restore the whole video, extract 8 fps ±1.5 s with ffmpeg, perceive the frames | Web process, during the chat stream | `api/reviews/[id]/chat/route.ts` |
| Job loop polling Postgres every 1 s; cleanup every 10 min | Worker | `worker/index.mts`, `server/jobs.ts` |

### After

| Step | Where |
| --- | --- |
| Quick checks, then probing the picked file (duration, rotation, dimensions, codecs) | **Browser**, both modes |
| Convert to a playable 720p MP4: H.264, AAC or Opus, metadata stripped, faststart | **Browser** (mediabunny + WebCodecs) |
| Scene cuts, sampled frames, hook frames, inspect sprite sheets, poster | **Browser** (mediabunny `CanvasSink` + canvas JPEG) |
| PCM audio → loudness per second and silence spans | **Browser** (pure JS, shared with tests) |
| Word-timed transcript | **Browser** (transformers.js Whisper, in a Web Worker) |
| Upload: the 720p MP4, poster, frames and sprites | **Browser → Supabase Storage** over signed upload URLs (hosted), or → local `PUT` routes (local). The original file is never uploaded. |
| Check the manifest's shape (cheap, synchronous) | Server, in `upload-complete` |
| `verify` step: MP4 header parse, object sizes, JPEG checks, timestamps against duration, frame plan | Server, in the background runner, before anything paid |
| Derived signals: ids, shot ids per frame, speech rate, sound without speech, low-confidence flags, coverage, captions.vtt | Server (pure functions moved out of `pipeline.ts`) |
| Perception, reviewers, discussion, synthesis | Server, in-process background runner (section 5) |
| Follow-up `inspect` | Server crops already-uploaded sprite tiles with `sharp`, then perceives them. No ffmpeg. |
| Chat answer | Server background task. The client streams it in segments of 75 s or less and can resume. |
| Cleanup (abandoned uploads, stale follow-up credit) | Server, opportunistically: on boot, when a review is polled, on the health check, at most once every 10 min |

The `store` job and `worker/` are removed. So are `intake.ts`'s download path and the `review-uploads` bucket's use. The bucket itself is left in place: migrations don't drop storage.

---

## 2. Library choices

### Chosen

| Purpose | Package | Version | Licence | What the user downloads | Notes |
| --- | --- | --- | --- | --- | --- |
| Demux, transcode (WebCodecs), mux MP4, frame and audio sinks | `mediabunny` | 1.66.0 [verified] | MPL-2.0 [verified]. File-level copyleft: fine for a closed or open app as long as mediabunny's own files stay unmodified. | `dist/bundles/mediabunny.min.mjs` is 757,382 B unpacked [verified]. It tree-shakes, so the real chunk is smaller. Gzipped size [unverified, measured in step 2]. | Bundled through npm, so it's same-origin and needs no CSP change. Loaded with dynamic `import()` only when a file is picked. |
| AAC encoding when the browser's WebCodecs can't encode AAC (Firefox, and Chromium on Linux [unverified]) | `@mediabunny/aac-encoder` | 1.66.0 [verified] | MPL-2.0 [verified] | 5,385,642 B package total, unpacked [verified]. The single wasm file's size is [unverified]. | Loaded only when `canEncodeAudio('aac')` is false *and* the source audio isn't already AAC. Phone videos are almost always AAC, and their audio is copied without re-encoding. |
| Speech to text with word timestamps | `@huggingface/transformers` | 4.3.2 [verified] | Apache-2.0 [verified] | `dist/transformers.web.min.js` is 456,110 B [verified]. Its pinned runtime `onnxruntime-web@1.31.0-dev.20260914-8d85527a0` (MIT) ships `ort-wasm-simd-threaded.jsep.wasm` at 28,352,885 B and `ort-wasm-simd-threaded.wasm` at 14,264,838 B [verified, `npm pack --dry-run`]. Transformers ships the `.jsep` loader, so expect the 28 MB one. Compressed size [unverified]. | Runs in a dedicated Web Worker. `device: "webgpu"` when available, otherwise wasm. |
| Whisper model | `onnx-community/whisper-base.en` with word-timestamp (cross-attention) outputs, or `onnx-community/whisper-base_timestamped` if no `.en` export exists | pinned to a commit hash | Weights MIT (OpenAI Whisper) | [unverified] Fetching from the Hugging Face API was blocked in this session. Expect roughly 50–80 MB quantized (q8) and about 150 MB at fp16 for base. **The step 2 spike measures the real files, confirms `return_timestamps: "word"` works with them, and picks the dtype.** | Same model size class as today's `ggml-base.en`, so transcript quality stays comparable. The browser caches it (transformers.js uses the Cache API), so it downloads once per browser. |

The server keeps `sharp` (already a dependency) for labelling frames and cropping sprite tiles.

### Considered and rejected

- **ffmpeg.wasm** (`@ffmpeg/ffmpeg` 0.12.15 MIT; `@ffmpeg/core` 0.12.10 **GPL-2.0-or-later**, with `ffmpeg-core.wasm` at 32,232,419 B [verified]). Three problems: the core is GPL (it bundles x264), so serving it from our site carries GPL source-offer obligations; it's a 32 MB download; and it encodes in software, single-threaded unless the page is cross-origin isolated. That makes it much slower than WebCodecs' hardware encoders on phones. It would make sense only as a fallback for browsers without WebCodecs, and the GPL cost isn't worth it. Browsers without WebCodecs get a clear message instead (section 3.6).
- **whisper.cpp wasm.** It works, but the official builds aren't published to npm as a maintained package, so we'd vendor and build it ourselves. transformers.js is maintained, versioned, and has word timestamps built in.
- **mp4box** 2.5.0 (BSD-3-Clause, 2.5 MB unpacked [verified]). mediabunny covers demuxing in the browser. On the server, a roughly 150-line ISO-BMFF box reader (section 4.3) is easier to audit and test than a general library.

### Where the files are served from

| Asset | Served from | Why |
| --- | --- | --- |
| mediabunny, transformers.js JS | Our bundle (npm) | Same-origin, versioned in `package-lock.json`, no CSP change |
| onnxruntime wasm (≈ 28 MB) | **`public/vendor/ort/<version>/`**, copied from `node_modules` by a `postinstall` / `prebuild` script, with `env.backends.onnx.wasm.wasmPaths` set to it | Avoids depending on jsDelivr at run time. The file is static, so the 0.1 vCPU host only streams it. Long cache headers keep repeat visits free. |
| Whisper model (≈ 50–150 MB) | **Hugging Face CDN**, pinned to a revision (`env.remoteHost` defaults to `https://huggingface.co`). A non-secret setting, `NEXT_PUBLIC_MODEL_HOST`, can point elsewhere. | Putting it under `public/` would add 50–150 MB to the Docker image and send all that traffic through a 0.1 vCPU instance. Supabase Free's egress budget is too small for it. HF's CDN is free and reliable. Trade-off: the user's browser contacts huggingface.co. That has to go in `/privacy` (Nyle to approve wording). |

CSP: the app sets no Content-Security-Policy today [verified: none in `src/` or `next.config.ts`]. If one is added later it needs `connect-src https://huggingface.co https://*.hf.co https://*.xethub.hf.co` [unverified host list], `worker-src 'self' blob:` and `script-src 'wasm-unsafe-eval'`.

No cross-origin isolation (COOP/COEP) is required. Without it onnxruntime runs single-threaded wasm; WebGPU doesn't need it. Turning on `COEP: require-corp` would break the Supabase signed media URLs on the review page, so it stays off.

---

## 3. Browser side

### 3.1 Order of work and progress copy

All of this runs in a Web Worker (`src/media/browser/prepare.worker.ts`), so the page stays responsive. The page shows one status line and a progress bar. The copy matches the current voice:

| Phase | Copy | Share of the bar |
| --- | --- | --- |
| Probe and checks | "Having a quick look at your video…" (existing) | — |
| Convert | "Preparing your video on this device…" | 0–45% |
| Model download, started in parallel with conversion | "Getting the speech reader ready (one time, about N MB)…", using the real size from the response headers | shown only while it's downloading |
| Cuts, frames, sprites, poster | "Finding cuts and pulling frames…" | 45–65% |
| Audio signals | "Measuring the sound…" | 65–70% |
| Transcribe | "Listening for speech… This can take a minute or two on a phone." | 70–90% |
| Upload | "Sending it (12 of 31 MB)…" | 90–100% |

Above the bar, at all times: "Keep this tab open until it's sent. After that you can close it." That's true: once `upload-complete` returns, nothing else depends on the browser. If a phase is slow, the bar keeps moving on real progress (mediabunny's conversion `onProgress`, frames done out of planned, transcriber chunks done) and never shows an invented ETA. Background-tab timer throttling doesn't stop a Web Worker's WebCodecs work. `navigator.wakeLock` is requested where supported so a phone doesn't sleep partway through.

**Order relative to creating the review:** prepare the video first, then `POST /api/reviews`, then upload. Today the review is created before the upload. Moving creation later means a long preparation never holds a daily-review slot or a credit reservation, and the "abandoned upload" window only covers the upload itself. The sign-in and payment steps are still before the upload step, so hosted users are signed in and able to pay before any work starts (unchanged).

### 3.2 Probe and limits

- Picked-file cap: **2 GB**, enforced in the browser only (`MAX_PICK_BYTES` in `core/uploadChecks.ts`). This is a friendliness check, not a security one. Nothing over the network depends on it, because the original is never uploaded. mediabunny reads a `File` with random access through `BlobSource`, so a large original isn't loaded into memory.
- From mediabunny `Input`: duration (`computeDuration()`), display width and height after rotation, codec. The existing intake rules apply to the *original*: 1 s ≤ duration ≤ 180.5 s, height > width (after rotation), long side ≤ 4096. The messages are the ones already in `uploadChecks.ts` and `probe.ts`.

### 3.3 The 720p video

- Target: short side ≤ 720, aspect kept, even dimensions. For 9:16 that's 720×1280.
- **Always remux, sometimes re-encode.** Every output goes through mediabunny `Conversion` so container metadata is dropped. That matches today's `-map_metadata -1`, which removes GPS and the device name. Output is MP4 with `fastStart: "in-memory"`, so `moov` comes before `mdat`.
  - Video track is **copied** when the source is H.264 (`avc`), its short side is ≤ 720, and the whole file would fit under the cap. Otherwise it's re-encoded to H.264 via WebCodecs at bitrate `min(2.5 Mbps, budget)`, where `budget = floor(capBytes × 0.9 × 8 / durationSec) − audioBitrate`. For 180 s at a 50 MB cap that's ≈ 1.86 Mbps of video plus 128 kbps of audio.
  - Audio is **copied** when it's AAC or Opus. Otherwise it's encoded to AAC at 128 kbps (WebCodecs, or the `@mediabunny/aac-encoder` fallback). Opus is used only if neither is available.
  - If the result is still over the cap (encoders can overshoot), re-encode once at 80% of the bitrate. If it's still over: "That video is too detailed to fit in 50 MB at this length. Please trim it or export a smaller version." That message is real; it isn't a fallback path.
- Uploaded-file cap: `MAX_UPLOAD_MB`. The default is **50 in hosted mode and 250 in local mode**. It applies to the *processed* MP4, which is the only video that's stored. `storage.ts` `MAX_FILE_BYTES` becomes `LIMITS.maxBytes` (one source). `fitVideo` is deleted.
- User-facing copy on the upload step changes from "up to 3 minutes and 50 MB" to **"A vertical MP4, MOV or WebM, up to 3 minutes. Your device makes a smaller copy before sending it."** Size is no longer the user's problem until 2 GB.

### 3.4 Visual evidence

Everything is taken from the **720p output**, not the original, so each frame matches what plays in the room and decoding stays cheap.

- **Shots.** Iterate every frame (frames above 30 fps are skipped) through `CanvasSink` at 64×114. Port ffmpeg's scene score as a pure function, `src/media/analysis/scenes.ts`: the sum of absolute differences per pixel, `mafd`, then `score = clamp(min(mafd, |mafd − prevMafd|) / 100, 0, 1)`. That's the same formula as `vf_select`'s scene detection, reimplemented. Cut where score > 0.3. Then apply today's filtering: drop cuts within 0.2 s of either end and cuts within 0.2 s of the previous one. The browser sends **cut times only**.
- **Sampled frames.** `planFrameTimes` and the hook plan move unchanged into `src/media/analysis/framePlan.ts`, a pure module both sides import. The browser computes the plan from (duration, cuts) and grabs each frame with `CanvasSink.getCanvas(t)`. It records **the decoded sample's actual timestamp**, so the time is real, not the planned one. Frames are JPEG at quality 0.8 with a 640 px long side, the same as today.
- **Hook.** 8 fps over 0–1.5 s, same as `denseSample(…, 0.75, 0.75)`, marked `dense`.
- **Inspect sprite sheets.** These replace server-side `denseSample` for follow-ups. **4 fps over the whole video**, tiles 270×480 (360 px long side was too small to read on-screen text), 40 tiles per sheet (8 × 5 grid = one sheet per 10 s), JPEG quality 0.7. Storage per 10 s sheet [unverified, measured in step 2] is roughly 150–300 KB, so up to 18 sheets and ≈ 3–5 MB for a 3-minute video. **Product change to approve:** `inspect` today looks at 8 fps. With sprites it sees 4 fps, which is 12 frames in a ±1.5 s window instead of 24. 8 fps would double sprite storage. Recommendation: 4 fps. The `INSPECT_TOOL` description is updated to say "4 per second" so the model isn't told something untrue.
- **Poster.** At `min(0.5, duration/2)`, 720 px tall, JPEG, same as today.

### 3.5 Audio evidence

- PCM comes from mediabunny `AudioSampleSink` on the output, mixed down to mono at the native rate. Nothing decodes the whole file into one `ArrayBuffer`.
- **Loudness**, `src/media/analysis/loudness.ts`, pure: the EBU R128 momentary meter (K-weighting biquads computed for the actual sample rate, 400 ms window, 100 ms hop). Then the same reduction as today: loudest value above −70 LUFS per second, rounded to 0.1, `null` otherwise. That gives an array of length `ceil(duration)`.
- **Silence**, `src/media/analysis/silence.ts`, pure: the same semantics as `silencedetect=n=-45dB:d=0.5` (sample amplitude below −45 dBFS for at least 0.5 s, and an open span runs to the end).
- **Transcript.** Resample to 16 kHz mono with `OfflineAudioContext`. The Whisper pipeline is `automatic-speech-recognition` with `return_timestamps: "word"`, `chunk_length_s: 30`, `stride_length_s: 5`, language English. Segments come from the pipeline's chunk boundaries. Words carry `[start, end]` and a probability, taken from the token probabilities exposed by the pipeline [unverified that 4.3.2 exposes them with word timestamps; checked in the step 2 spike]. **If per-word probability isn't available:** send `p: null`, and the server marks the segment low-confidence only if the model said so (no invented confidence). Coverage then says "Word-level confidence isn't available for this transcript." The non-speech filter (`NON_SPEECH`) moves to a shared module.
- `captions.vtt`, speech rate and "sound without speech" are **computed on the server** from the validated transcript and loudness, using the existing code moved into `src/media/analysis/speech.ts`. The browser doesn't send them.

### 3.6 Browsers that can't do it

Feature check before anything starts: `VideoDecoder`, `VideoEncoder`, `AudioDecoder`, `OffscreenCanvas` and `Worker` exist, and mediabunny's `canEncodeVideo('avc', {width, height})` is true. If not: **"This browser can't prepare videos. Please use a recent Chrome, Edge, Safari or Firefox."** No fallback path pretends otherwise. Per-browser support for H.264 encoding with WebCodecs [unverified, exercised in step 2 on desktop Chrome and Safari, and on an iPhone and an Android phone]: Chrome/Edge 94+, Safari 16.4+, Firefox 130+ desktop. This also applies in local mode, where any browser used to work. That's acceptable for a local single user and is said in the README.

---

## 4. Data formats and server-side validation

### 4.1 Files

| Object (hosted: `review-media/<user>/<review>/…`; local: `data/media/<review>/…`) | Type | Cap |
| --- | --- | --- |
| `video.mp4` | `video/mp4`, H.264 + (AAC or Opus or no audio), faststart | `MAX_UPLOAD_MB` |
| `poster.jpg` | JPEG, ≤ 1280 px on its long side | 1 MB |
| `frames/F001.jpg` … | JPEG, long side ≤ 640 | 300 KB each, ≤ 140 files |
| `sprites/P000.jpg` … | JPEG, exactly 8×270 by 5×480 (for 9:16; tile size is in the manifest) | 2 MB each, ≤ 18 files (`ceil(duration/10)`) |
| `captions.vtt` | written by the server | — |

The `review-media` bucket already allows `video/mp4`, `image/jpeg` and `text/vtt` at 50 MB per file [verified, `0001_init.sql`]. Nothing new is needed.

### 4.2 Manifest (body of `POST /api/reviews/[id]/upload-complete`, a zod schema in `src/media/analysis/manifest.ts`)

```ts
{
  v: 1,
  originalName: string (≤200),
  video: { durationSec: number, width: int, height: int, hasAudio: boolean, bytes: int },
  cuts: number[],                                   // seconds, ascending
  frames: { t: number, plannedT: number, dense: boolean, file: string, bytes: int }[],
  sprites: { file: string, bytes: int, cols: 8, rows: 5, tileW: int, tileH: int, t: number[] }[], // t per tile, actual timestamps
  poster: { bytes: int },
  loudness: (number|null)[],                        // per second
  silence: { start: number, end: number }[],
  transcript: { start: number, end: number, text: string, words: { w: string, start: number, end: number, p: number|null }[] }[],
  tools: { mediabunny: string, transformers: string, model: string }   // recorded for eval and coverage
}
```

The browser sends **no ids**. The server assigns `S01…`, `F001…`, `T01…`, `A01…` in time order, and assigns `shotId`s, so a client can't plant or collide ids.

### 4.3 What the server checks (the browser is untrusted)

In `upload-complete`, synchronously (cheap, no downloads, well under 1 s):

1. The caller owns the review, and its stage is `uploading` (existing `ownedUploadReview`, extended to local mode).
2. The body is ≤ 1 MB and the manifest parses with zod. Counts: cuts ≤ 300, frames ≤ 140, sprites = `ceil(duration/10)`, transcript segments ≤ 400, words ≤ `ceil(6 × duration) + 20`, segment text ≤ 500 chars, word ≤ 40 chars, silence spans ≤ 300. No control characters in text other than `\n`.
3. Numbers are finite. 1 ≤ duration ≤ 180.5. Height > width, short side ≤ 720, long side ≤ 4096.
4. **Every timestamp is within [0, duration]** (+0.05 for word ends). Cuts are strictly ascending, more than 0.2 s apart, and inside (0.2, duration − 0.2). Words satisfy start ≤ end and sit inside their segment. Segments are non-overlapping and ascending. Silence spans are ascending and within duration. `loudness.length === ceil(duration)` and every value is null or in [−70, 10]. Every `p` is null or in [0, 1].
5. **The frame plan is reproduced by the server:** `planFrameTimes(duration, shotsFrom(cuts))` plus the hook plan must equal the manifest's `plannedT` list exactly. Each actual `t` must be within `max(0.1, 1/fps)` of its `plannedT`. So the browser can't pick which moments reviewers see. Sprite tile times must be 0.25 s apart (±0.1), starting at 0.
6. File names match `^frames/F\d{3}\.jpg$` / `^sprites/P\d{3}\.jpg$` in order. Declared sizes are under their caps, and their total is under `MAX_UPLOAD_MB` + 30 MB.

If any of these fail: 400 with a plain message ("Something went wrong preparing your video. Please try again."). The review is deleted and refunded (`deleteReview(id, { refund: true })`), as today. The specific reason is logged server-side.

Then, in the background **`verify` step** (section 5), before any paid call:

7. Each listed object exists, and its stored size equals the declared size. Hosted: one `storage.list` of the review folder plus one of `frames/` and one of `sprites/`. Local: `fs.stat`. Nothing extra may be present.
8. **MP4 check from its own bytes**, `src/media/mp4.ts`, a pure parser. Hosted fetches `Range: bytes=0-4194303` of a signed URL and streams it. Local reads the first 4 MB. The parser requires `ftyp`, and `moov` before `mdat` inside the first 4 MB (faststart). It reads `mvhd` (duration/timescale), and for each `trak` the `tkhd` width/height and matrix (rotation), the `hdlr` type and the `stsd` sample entry. It requires exactly one video track `avc1`/`avc3`, and at most one audio track `mp4a`/`Opus`. Duration must equal the manifest's within ±0.1 s, dimensions must equal the manifest's, and the intake rules are re-checked on these values. **The MP4's own duration and dimensions are what's stored.**
9. Every frame, sprite and the poster is downloaded one at a time to `/tmp/panel/<review>/` (that's the cache perception uses). `sharp(...).metadata()` must report `format === "jpeg"` with dimensions inside the caps, and sprite sheets must equal `cols × tileW` by `rows × tileH`.
10. `captions.vtt` is written from the validated transcript (`writeCaptions`, made pure to return a string) and stored.

If any of 7–10 fail, it's `rejectUpload` as today: the stage is `failed`, the detail is `upload-rejected`, the reason is plain, files are removed, credit is released and the daily count is refunded. Network errors throw, so the step is retried (section 5).

**What can't be verified, said plainly:** the server can't prove the transcript matches the audio, or that the loudness numbers match it. A user who edits their own browser's output only misleads their own review. The limits in step 4 stop it being used to make the prompts huge. Claude still never writes timestamps. Every timestamp is derived from the media by deterministic browser code (Whisper's word alignment is the same kind of model-derived timing whisper.cpp gives today) and then bounds-checked here.

### 4.4 Local mode

The same manifest and the same checks. Instead of signed Supabase URLs, `POST /api/reviews/[id]/upload-urls` returns same-origin URLs: `PUT /api/reviews/[id]/files/<file>`. That route streams to `data/media/<id>/<file>` with a byte counter against the per-file cap (the existing `video/route.ts` pattern). The route is excluded from the proxy matcher, like `/video` is today, so Next doesn't buffer bodies. `PUT /api/reviews/[id]/video` is removed.

---

## 5. Background jobs on a host that sleeps

### 5.1 How long the work runs

A review's Claude work after `upload-complete`:

- verify (no Claude, ~2–10 s)
- perception (`ceil(frames/16)` batches, 3 in parallel, Sonnet)
- one reviewer pass, then the rest in parallel (Opus, `maxTokens` 64000 in `review.ts`)
- discussion
- synthesis

Expected wall time is **about 4–10 minutes per review, and could reach about 20 minutes** if a reviewer pass writes close to its token cap [unverified estimate. `npm run eval` prints real processing times from `app.jobs`. Nyle can run it locally; I didn't, per the rules]. **A single Opus call can run longer than 100 s.** So a design where "each poll runs one step inside the request" doesn't fit the 100 s limit. Steps have to run in the background either way.

### 5.2 Recommendation: an in-process runner with a Postgres lease

No separate worker. A module `src/server/runner.ts` lives in the Next.js server process:

- **Kick.** `upload-complete` and `retry` insert or reset the `app.jobs` row, return 200 straight away, and call `after(() => runner.kick())`. `kick()` starts the run as a *detached* promise held in a module-level map, then returns. So the `after` callback finishes at once and doesn't depend on any per-route duration. The Next docs say `after` runs "for the platform's default or configured max duration of your route" and that self-hosted `next start` drains pending `after()` callbacks on SIGTERM [verified, `after.md` and `self-hosting.md`]. Detaching avoids leaning on either.
- **Claim with a lease.** Migration 0009 adds `lease_until bigint` and `lease_owner text` to `app.jobs`. Claim:
  `UPDATE app.jobs SET status='running', attempts=attempts+1, started_at=COALESCE(started_at,$now), lease_owner=$me, lease_until=$now+120000 WHERE id=(SELECT id FROM app.jobs WHERE status='pending' OR (status='running' AND lease_until < $now) ORDER BY id LIMIT 1 FOR UPDATE SKIP LOCKED) RETURNING *`.
  A heartbeat every 30 s pushes `lease_until` forward while the run is alive. `$me` is a random id per process.
- **Concurrency.** At most **2** runs per process, which keeps memory bounded. Queued jobs wait and are claimed as slots free up.
- **Resume.** `src/instrumentation.ts` `register()` calls `runner.resumeOnBoot()` (detached, logs DB errors, never throws). `GET /api/reviews/[id]` (polled every 2 s by the room) and `GET /api/health` call `after(() => runner.kick())` whenever there's claimable work: a pending job, or a running one with an expired lease. A sleeping host that wakes from *any* request picks up unfinished reviews.
- **Idempotent steps** (refactored `processReview`): verify → perceive (**saved after each batch** into a new `reviews.draft` jsonb, so a restart re-pays at most the batches in flight) → each reviewer (already saved one by one) → discussion → synthesis → done. A restart repeats only the Claude calls that were in flight. Those are paid twice at most, which is bounded and acceptable.
- **Credits.** Unchanged. `runReview` wraps the whole run in `onReservation`. `reservationForRun` already reuses a reservation left open by a run that died [verified, `credits.ts:216`].
- **Shutdown.** On SIGTERM the runner stops claiming and sets `lease_until = 0` on the jobs it holds, so the next process resumes them immediately instead of waiting 2 min.
- **Retry policy.** Network or transient failures go back to `pending`, up to 4 attempts, then `failed` with the existing `friendly()` message. `AiUnavailable`, `BudgetExceeded`, `NotEnoughCredits` and upload rejections fail at once, as in today's worker.
- **Maintenance** (`cleanupAbandonedUploads`, which also removes any partly uploaded objects under the review's prefix, and `settleStaleFollowups`) runs from the same kicks, at most once every 10 min per process. A row in `app.jobs` with `kind='maintenance'` dedupes it across processes. The abandoned-upload window goes from 30 to 60 min, because a 50 MB upload on a slow connection can take a while.

### 5.3 Why this design rather than steps driven only by polling

Polling-only would make each request do one step synchronously. It fails on Opus calls that take more than 100 s, and it stops dead when the user closes the tab. The runner keeps working with the tab closed and uses polling only as a wake-up signal. Both designs need the lease and idempotent steps. The runner just doesn't need a browser to be watching.

### 5.4 Follow-up chat within the 90 s limit

Today `POST /chat` streams the whole answer, including up to 4 tool rounds, on one request. New design:

- `POST /api/reviews/[id]/chat` validates, reserves credit, inserts the user message and an assistant row with `status='streaming'` (migration 0009 adds `status`, `updated_at` to `app.followups`). It starts the answer as a detached in-process task and returns NDJSON for **up to 75 s**. The stream ends with `{type:"more", messageId, offset}` if the answer isn't finished.
- The task appends text to an in-memory buffer and flushes it to the row's content about every 1 s. `GET /api/reviews/[id]/chat/stream?message=…&offset=…` tails the in-memory buffer (same process), or the row if the buffer is gone, for up to 75 s more. `Ask.tsx` reconnects on `more`.
- If the process restarts mid-answer, the row stays `streaming`. A reader that finds no live buffer and `updated_at` older than 60 s marks it `failed` with "The reviewer couldn't finish that answer. Please ask again." The existing `settleStaleFollowups` settles its credit. Nothing is half-saved as if it were final.
- `inspect` no longer touches video. It picks the sprite tiles within ±1.5 s, crops each with `sharp().extract()`, and saves them as new `frames/F###.jpg`. Hosted uploads that small file with the server key; local writes it to disk. Then it perceives them. Memory is one sprite (≤ 2 MB) at a time.

### 5.5 Exact host requirements (for `docs/hosting.md`)

- **RAM:** 512 MB is enough. Measure idle and peak RSS of the standalone server with 2 reviews running in step 1, then again in step 2.
- **Long requests:** none longer than about 75 s. Uploads never pass through the host in hosted mode.
- **Background work after a response:** yes. The process must keep running detached work for **up to about 20 minutes** after `upload-complete` returns, even with no inbound requests if the user closes the tab. Koyeb's 1 h idle sleep covers that. Render's 15 min sleep usually does, and anything cut short resumes on the next request. Hosts that freeze the process between requests (serverless functions) are **not** suitable.
- **Can sleep / restart:** yes. Lost work is at most the Claude calls that were in flight. It resumes on the next boot or request.
- **Persistent disk:** not needed. `/tmp` holds about 30 MB per running review as a rebuildable cache.
- **Graceful shutdown:** SIGTERM with a few seconds' grace is enough, because leases are released.

---

## 6. Moving to the standard Next.js server

### 6.1 Starting

- `next.config.ts`:
  - `output: process.env.PANEL_STANDALONE === "1" ? "standalone" : undefined`. Only the Docker build sets it. `next start` can complain about standalone output [unverified in 16.4.6], and local mode needs `process.cwd()` to stay the repo so `data/` is where it always was.
  - `outputFileTracingIncludes: { "/*": ["./src/experts/profiles/**", "./supabase/migrations/**"] }`, because both are read with `fs` at run time [verified: `experts/load.ts`, `server/db.ts`].
  - `skipProxyUrlNormalize: true` (section 6.2).
- Local: `scripts/dev.mjs` → `exitUnlessReady`, start the local DB, then spawn `next dev --hostname <h> --port <p>`, where `{h,p} = listenAddress(mode, process.env)`. That's **127.0.0.1:3000 by default**, and `HOST` is read only from the shell, as today. `scripts/start.mjs` → the same with `next start`. No worker process.
- Docker: the runtime is `node server.js` from `.next/standalone`, plus `.next/static` and `public/` copied in, as the Next docs describe [verified, `output.md`]. Set **`HOSTNAME=0.0.0.0`** explicitly, because Docker sets `HOSTNAME` to the container id by default and the standalone server reads it.
- **Startup checks:** `src/instrumentation.ts` `register()`. When `process.env.NEXT_RUNTIME === "nodejs"` and it isn't the build phase (`process.env.NEXT_PHASE !== "phase-production-build"`), it runs `checkStartup(startupEnv())`. On `StartupError` it prints the message and calls `process.exit(1)`. `register` "must complete before the server is ready to handle requests" [verified, `instrumentation.md`], so a misconfigured hosted start never serves a request, whatever started it (`next start`, `server.js`, `next dev`). `scripts/start.mjs` / `dev.mjs` also call `exitUnlessReady` first, so the message shows before Next's banner.
- `EADDRINUSE`: Next prints its own error. `dev.mjs` and `start.mjs` catch the child's exit and print today's friendlier hint.

### 6.2 Redirect to the one public address

`src/proxy.ts` (hosted only, `GET`/`HEAD`, not `/api/*` or `/_next/*`, already excluded by the matcher or the code) calls the existing `canonicalLocation(method, pathname + search, request.headers.get("host"), publicOrigin)`. When that returns a location, the proxy returns `NextResponse.redirect(location, 307)` with `Cache-Control: no-store`.

Why it failed before [verified in `node_modules/next/dist/server/web/adapter.js:416–431` and `next-url.js:15`]: Next's adapter parses a proxy response's `Location` with `NextURL`, which rewrites `127.x.x.x` / `[::1]` to `localhost`. If the host then equals the request's (also normalised) host, it **rewrites Location to a relative URL**. So 127.0.0.1 → localhost became a same-host redirect loop. This happens for a raw `Response` with a `Location` header too, so building the response by hand doesn't help. The guard is `process.env.__NEXT_NO_MIDDLEWARE_URL_NORMALIZE`, which is defined from the **documented** config option `skipProxyUrlNormalize` [verified, `build/define-env.js:162`, and the docs page `skipProxyUrlNormalize.md`]. With it on, "destinations it rewrites or redirects to are sent as written". Side effect: `request.nextUrl` holds the path as sent. That only matters for Pages Router `_next/data` URLs, which this app doesn't have. The existing `?code=` → `/auth/callback` redirect builds from `request.nextUrl.clone()`, which still gives the right absolute URL.

Production note: on Koyeb or Render, the platform hostname and the custom domain differ, so even without the flag this is a different-host redirect. The flag matters for trying hosted mode on 127.0.0.1 vs localhost, and it costs nothing in production. Risk: if a host's proxy rewrites `Host` to an internal name, every page would redirect forever. The guard is to skip the redirect when `x-forwarded-host` already equals the public host. Check this once on the real host after deploy (step 4 checklist).

**Tests:**

- Unit (`tests/unit/proxy-redirect.test.ts`): call `proxy(new NextRequest("http://127.0.0.1:3000/login?next=%2F", { headers: { host: "127.0.0.1:3000" } }))` with `PANEL_MODE=hosted` and `HOSTED_PUBLIC_URL=http://localhost:3000`. Expect 307 and `Location: http://localhost:3000/login?next=%2F`. Also cover `/api/health`, `POST`, local mode, and `x-forwarded-host` equal to the public host, all expecting no redirect.
- Config: `next.config.ts` has `skipProxyUrlNormalize: true`.
- E2E against the real adapter (`tests/e2e/hosted-server.spec.ts`, its own Playwright project with its own `webServer`): `next build && next start -p 3100` with `PANEL_MODE=hosted`, format-valid dummy secrets, and `HOSTED_PUBLIC_URL=http://localhost:3100`. With `node:http`, send `GET /login` with header `Host: 127.0.0.1:3100` and assert `307` with that absolute `Location`. Send `GET /api/health` with the same host and assert `200 {"ok":true}`. No Supabase or Stripe network calls happen: the redirect returns before any session work, and health touches nothing.

### 6.3 Client IP for rate limits

Without `server.mjs` there's no per-run peer header. Next's base server fills `x-forwarded-for` from the socket **only if it's missing** (`??=`) [verified, `base-server.js:604`], so the socket address can't be told apart from a forged header. New rules in `src/server/client.ts`:

- **Local mode:** headers are ignored. Every request is the one local client (`"local"`). Local mode is bound to 127.0.0.1, so there's only one person. That's the same effective behaviour as today's 127.0.0.1 peer, and nothing a request sends can change it.
- **Hosted mode, `CLIENT_IP_HEADER` set** (preferred): read only that header, which the platform overwrites on every request. Today's code already does this. Platform values to confirm before deploy [unverified]: Koyeb (check its docs for a client-IP header; otherwise use `TRUSTED_PROXIES`), Render (`True-Client-IP` is set when Cloudflare fronts it; confirm), Fly `Fly-Client-IP`, Cloudflare `CF-Connecting-IP`.
- **Hosted mode, `TRUSTED_PROXIES=N`:** take `X-Forwarded-For` and use entry `len − N`, counting from 0. That's the address the outermost trusted proxy saw, and anything to its left was written by the client. It's the same answer `peerAddress` gives today with the socket appended. It's safe only because the app can't be reached except through the platform's proxy, which always appends. `docs/hosting.md` says so.
- `hostedProblems` keeps requiring one of the two. `PANEL_PEER_HEADER` and `peerAddress`'s socket argument are removed.
- Tests: update `budget.test.ts` (which simulates `server.mjs`'s header) to cover the three rules. A forged `X-Forwarded-For` in local mode, or a left-side entry in hosted mode, must not change the key.

### 6.4 Files

Removed:
- `server.mjs`
- `worker/index.mts`
- `src/media/pipeline.ts`
- `src/media/probe.ts`
- `src/media/exec.ts` (if nothing else uses it: `mapLimit` moves to `src/core/limit.ts`, because `perceive.ts` uses it)
- `src/server/intake.ts`'s download and probe path
- `storage.ts`'s `fitVideo`, `storeReviewMedia`, `createUploadUrl` (single file), `downloadUpload`, `restoreFile`
- `api/reviews/[id]/upload-url` (replaced by `upload-urls`)
- `api/reviews/[id]/video`
- the `store` job kind

`package.json` scripts:
- `dev`: `node scripts/dev.mjs`
- `build`: `next build`
- `start`: `node scripts/start.mjs`
- `dev:web`, `worker` and `start:web` are removed
- `smoke`: Playwright, see section 8

---

## 7. Scripts, setup, eval and smoke

- **`scripts/prereqs.mjs` / `setup.mjs`:** drop the ffmpeg, ffprobe and whisper-cli checks and the `ggml-base.en.bin` download. Setup checks only Node and the API key. `tests/unit/prereqs.test.ts` shrinks to match. `WHISPER_MODEL`, `WHISPER_BIN` and `config.ts`'s `WHISPER_MODEL` go.
- **README:** remove the ffmpeg and whisper install steps from Mac and Ubuntu (Ubuntu becomes "install Node 20.9+"). Say the browser prepares the video, needs a recent Chrome, Edge, Safari or Firefox, and downloads a speech model once from Hugging Face. Replace the `server.mjs` paragraph. Update "How it works" step 4 and the code map rows for `src/media` and `worker/`.
- **Eval (`npm run eval`):** reads only Postgres. It keeps working if the runner keeps writing `kind='process'` rows with `started_at`/`finished_at`, which it does.
- **Smoke (`npm run smoke`):** no Node pipeline is kept. It becomes `scripts/smoke-review.mts`, which drives the real UI with Playwright (headless Chrome) against the running app. That makes the real Claude calls; it is still Nyle's manual, key-using command. So **no ffmpeg or whisper code remains anywhere**, server path or CLI.
- **ffmpeg on the dev Mac** is used only to *make* test fixtures (section 8). The fixtures are committed, so `npm run check` doesn't need ffmpeg. `upload.test.ts` and `direct-upload.test.ts` stop calling it.

---

## 8. Verification

### 8.1 Unit tests (all run in `npm run check`; in-process PGlite, no network)

- `analysis/framePlan.test.ts`: moved `planFrameTimes`, unchanged results on today's cases.
- `analysis/scenes.test.ts`: synthetic luma frames (flat, flat, jump, flat). One cut at the jump, none for gradual change. Cut filtering matches `detectShots`.
- `analysis/loudness.test.ts`: a 1 kHz sine at −20 dBFS reads about −20 LUFS momentary (EBU reference tolerance ±0.1). Silence is `null`. The length is `ceil(duration)`.
- `analysis/silence.test.ts`: tone/gap/tone gives one span with the right edges, and gaps under 0.5 s give none.
- `analysis/speech.test.ts`: moved speech rate, sound without speech, `writeCaptions` (pure string).
- Optional, gated by `describe.skipIf(!hasFfmpeg)`: on the committed fixture's PCM, the JS loudness is within 1 LU of ffmpeg `ebur128` and the silence spans are within 0.05 s of `silencedetect`. Calibration only; skipped where there's no ffmpeg.
- `manifest.test.ts`: every rule in 4.3 steps 2–6, one failing case each (timestamps past duration, unsorted cuts, wrong frame plan, oversized counts, horizontal, short side 1080, bad file names). The happy path builds ids, shot ids and coverage correctly.
- `mp4.test.ts`: the committed fixtures `vertical-8s.mp4` (pass), `not-faststart.mp4` (moov after mdat → reject), `horizontal.mp4` (reject), `hevc.mp4` (reject), truncated bytes (reject cleanly, no throw past the parser).
- `runner.test.ts` (PGlite): a claim takes one job. A second claimer can't take it while the lease is live, and can once it expires. Heartbeat extends. SIGTERM release sets `lease_until=0`. Concurrency cap 2. A run that throws a transient error goes back to `pending` up to 4 attempts. Perception saved per batch is not repeated on resume (count calls on an injected `work` double).
- `upload-complete` route tests (replacing `direct-upload.test.ts`): ownership, stage, schema rejection deletes and refunds, and a good manifest queues the job and calls `kick`. Supabase Storage is a test double, as today.
- `verify` tests: size mismatch, extra object, non-JPEG frame, wrong sprite dimensions and MP4 duration mismatch all end in `upload-rejected`. A network error leaves it retryable.
- `chat` tests: an answer longer than the segment limit (a fake clock in the double) ends a segment with `more`. Resuming from the offset continues exactly. An orphaned `streaming` row becomes `failed` and its credit is settled.
- `client.test.ts` / `budget.test.ts`: section 6.3.
- `proxy-redirect.test.ts`, `hosted-mode.test.ts`: `register()` exits on bad hosted settings (`process.exit` spied), `start.mjs` exits with the message. The `server.mjs`/worker spawn tests are replaced.
- `deploy-config.test.ts`: the Dockerfile has no ffmpeg, no whisper and no worker, has `HOSTNAME=0.0.0.0` and `PANEL_STANDALONE=1`, and its CMD is `node server.js`. `fly.toml` has no `[processes] worker`. Render/Koyeb notes are present in `docs/hosting.md`.

### 8.2 End to end: Playwright, headless, up to just before the first Claude call

**Fixtures** (`tests/fixtures/`, committed, made once with the Mac's ffmpeg and `say` by `scripts/make-fixtures.sh`, which is kept for regeneration):

- `vertical-8s.mov`: 1080×1920, 8 s, 30 fps, H.264 + AAC. Three visually distinct segments (`testsrc2`, then a solid colour, then `mandelbrot`) with hard cuts at 3.0 s and 5.5 s. Audio is 0–1 s silence, 1–3.5 s `say -v Samantha "My cat is judging my cooking tonight"`, 3.5–5 s silence, 5–8 s a sine tone. About 1–2 MB.
- `horizontal-4s.mp4`: 1280×720.
- `long-190s.mp4`: 180×320, 190 s, very low bitrate (≈ 200 KB).

**Anthropic test double:** the Playwright `webServer` for this project starts the app with `ANTHROPIC_API_KEY=sk-ant-test-not-real` and `ANTHROPIC_BASE_URL=http://127.0.0.1:3299`, where a tiny HTTP server inside the test records each request and answers `529 overloaded`. The Anthropic SDK reads `ANTHROPIC_BASE_URL` [unverified for SDK 0.135, checked in step 2]. No app code changes for testing, and no real Anthropic calls. Local mode, embedded Postgres in a temp `DATA_DIR`. **Browser:** `channel: "chrome"` (the installed Google Chrome), because Playwright's bundled Chromium may lack H.264 encode and decode [unverified, checked in step 2. If bundled Chromium works, drop the channel].

**`tests/e2e/browser-processing.spec.ts`:**

1. Answer the questions (the existing helper path), pick the board, and set `vertical-8s.mov` on the file input.
2. Expect "Preparing your video on this device…", then "Sending it", then navigation to `/r/<id>`. Timeout 5 min; the first run downloads the Whisper model.
3. `GET /api/reviews/<id>`: `video.url`, `poster` and `captions` are set. `video.width === 720`, `height === 1280`, `durationSec` is 8 ± 0.1. Fetch `video.url` and parse it with `src/media/mp4.ts`: avc1 + mp4a, faststart, and no `udta`/`meta` boxes, so metadata was stripped.
4. Fetch `captions.vtt`: contains "cat" (case-insensitive), and the first cue starts between 0.8 s and 1.6 s.
5. The recorded first request to the Anthropic double is a perception call. Its text lists frame ids in order, and their `@ t` labels include values within 0.1 s of 3.0 and 5.5 (shot starts + 0.05). Every `t` ≤ 8.0. The image count equals that batch's frame count.
6. The review ends in `failed` with "The AI service is busy right now. Try again in a minute." That proves the pipeline got exactly as far as the first Claude call.
7. `horizontal-4s.mp4` shows the vertical message before any upload, and no review is created (`GET /api/reviews` count unchanged). `long-190s.mp4` shows the 3-minute message.
8. Tamper test: in the page, intercept `upload-complete` with `page.route` and shift one cut to 9.0 s. Expect 400 with the plain message, and the review is gone.

Hosted-mode e2e of the direct-to-Supabase upload isn't automated (it would need a real Supabase project). The step 4 checklist covers it manually on a test project.

---

## 9. Implementation plan

Each step leaves the app working in both modes, passes `npm run check`, and can be committed on its own.

### Step 1: standard server and in-process runner (media pipeline unchanged)

Goal: drop `server.mjs` and the worker. The current ffmpeg pipeline runs inside the runner for now, so local mode still needs ffmpeg in this step only.

- Files:
  - `next.config.ts` (`skipProxyUrlNormalize`, conditional standalone, tracing includes)
  - new `src/instrumentation.ts`
  - `src/proxy.ts` (canonical redirect)
  - `src/server/mode.mjs` (drop `peerAddress`' socket use; add `clientAddress` rules)
  - `src/server/client.ts`
  - new `src/server/runner.ts`
  - `src/server/jobs.ts` (lease claim, release, heartbeat)
  - new `supabase/migrations/0009_runner_and_browser_media.sql`: `app.jobs` gets `lease_until bigint`, `lease_owner text`, and index `(status, lease_until)`. `app.reviews` gets `draft jsonb`. `app.followups` gets `status text not null default 'done'` and `updated_at bigint`. Plain SQL, `if not exists`, works on embedded Postgres and Supabase.
  - `src/server/process.ts` (per-batch perception saves)
  - `api/reviews/[id]/upload-complete`, `retry`, `video` (local), `[id]` GET, `api/health` (call `kick` via `after`)
  - `scripts/dev.mjs`, `scripts/start.mjs`, `package.json`
  - delete `server.mjs`, `worker/index.mts`, `src/server/mode.d.mts` entries that only `server.mjs` used
  - `scripts/smoke-review.mts` (enqueue and kick in-process)
- Tests: `runner.test.ts`, `proxy-redirect.test.ts`, `client`/`budget` updates, `hosted-mode.test.ts` (`register` and `start.mjs`), `deploy-config.test.ts` (no worker in `fly.toml`), and `tests/e2e/hosted-server.spec.ts` for the real-adapter redirect.
- Also: measure idle and peak RSS of `next start` (with `PANEL_STANDALONE=1`'s `server.js`) and record the numbers in the commit message for `docs/hosting.md`.

### Step 2: browser preparation, the new upload contract, server validation, 720p / 50 MB

Starts with a **time-boxed spike** (no commit, result written into this doc), which settles every [unverified] item in sections 2–3:

- the Whisper ONNX repo, its file sizes and dtype, and that `return_timestamps: "word"` and per-word probabilities work in 4.3.2
- the real size of the ORT wasm transformers loads, and Turbopack bundling of `new Worker(new URL(...), import.meta.url)`
- WebCodecs H.264/AAC encode in desktop Chrome, Safari, an iPhone and an Android phone, and in Playwright's Chromium
- the time to prepare `vertical-8s` and a real 60 s phone clip on a mid-range phone
- sprite sheet sizes
- `ANTHROPIC_BASE_URL` support in SDK 0.135

Then:

- Packages: `mediabunny`, `@mediabunny/aac-encoder`, `@huggingface/transformers` (exact versions pinned). Check that `.next/standalone/node_modules` contains no `onnxruntime-node` or transformers: they must stay browser-only.
- New pure modules in `src/media/analysis/`: `framePlan.ts`, `scenes.ts`, `loudness.ts`, `silence.ts`, `speech.ts` (speech rate, sound without speech, captions, `NON_SPEECH`), `manifest.ts`. New `src/media/mp4.ts`.
- New browser modules in `src/media/browser/`: `prepare.ts` (the orchestrator), `prepare.worker.ts`, `transcribe.worker.ts`, `support.ts`. `scripts/copy-ort-wasm.mjs` (prebuild) copies the ORT wasm into `public/vendor/ort/<v>/`, and `.gitignore` gets that folder.
- `src/components/flow/UploadStep.tsx`: new phases and copy, prepare before create. `core/uploadChecks.ts`: `MAX_PICK_BYTES` and new copy. `readVideoMeta.ts` is replaced by mediabunny's probe.
- Routes:
  - new `api/reviews/[id]/upload-urls` (hosted: batched `createSignedUploadUrl` with concurrency 8 into `review-media`; local: same-origin URLs)
  - new `api/reviews/[id]/files/[...file]` (local PUT)
  - `upload-complete` (manifest)
  - remove `upload-url` and `video`
  - `proxy.ts` matcher excludes `api/reviews/.*/files`
- Server:
  - `storage.ts`: `MAX_FILE_BYTES` becomes `LIMITS.maxBytes`; `signedUploadUrls`, `listReviewObjects`, `rangeFetch`, `putSmallFile`; remove `fitVideo`, `storeReviewMedia`, `downloadUpload`, `restoreFile`
  - `intake.ts` becomes the `verify` step
  - `process.ts` builds the ledger from the manifest plus perception
  - `config.ts`: `MAX_UPLOAD_MB` defaults to 50 when hosted and 250 locally; drop `WHISPER_MODEL`
  - `ai/render.ts`: `labeledFrame` reads from the `/tmp` cache or local dir, falling back to a storage download
  - `chat/route.ts`: `inspect` uses sprites; `INSPECT_TOOL` copy says 4 per second
  - `api/reviews/[id]` GET: frames and sprites come from `storedFiles`
  - `reviews.ts`: `deleteReview` and cleanup remove `sprites/`
  - `core/review.ts`: the stage labels stay; `ingesting` becomes "Checking your video"
- Delete `src/media/pipeline.ts`, `probe.ts`, `exec.ts`, and the `store` job.
- Tests: all of 8.1 except chat segmenting; `tests/fixtures/*` and `scripts/make-fixtures.sh`; `tests/e2e/browser-processing.spec.ts`. Rewrite `upload.test.ts` and `direct-upload.test.ts` on fixtures, with no ffmpeg at test time.

### Step 3: follow-up answers that fit inside 90 s

- Files:
  - `api/reviews/[id]/chat/route.ts` (detached answer task, 75 s segments)
  - new `api/reviews/[id]/chat/stream/route.ts`
  - `src/server/followups.ts` (status, partial flush, orphan handling)
  - `src/components/room/Ask.tsx` (reconnect on `more`)
  - `src/server/credits.ts` (`settleStaleFollowups` also covers `failed` orphans)
- Tests: chat segmenting and resume, orphan → failed and settled, and an inspect window built from sprite crops (sharp on a generated sprite in the test).

### Step 4: deploy config, docs, setup

- Files:
  - `Dockerfile`: a build stage with `PANEL_STANDALONE=1 npm run build`; a runtime copying `.next/standalone`, `.next/static`, `public`; **no ffmpeg, whisper, libgomp or worker**; `HOSTNAME=0.0.0.0`, `PORT=8080`, `PANEL_MODE=hosted`, `DATA_DIR=/tmp/panel-data`; `CMD ["node","server.js"]`; dev dependencies no longer in the image
  - `.dockerignore`
  - `fly.toml`: one `app` process, 512 MB, no worker, auto-stop allowed
  - `docs/hosting.md`: Koyeb first, Render as fallback, Fly kept as an option. Includes section 0's constraints, section 5.5's host requirements, the client-IP header per platform, `MAX_UPLOAD_MB=50`, the removed `WHISPER_*` variables, and an updated cost table (no worker VM)
  - `.env.example`: `MAX_UPLOAD_MB` text, `CLIENT_IP_HEADER`/`TRUSTED_PROXIES` without `server.mjs`, `NEXT_PUBLIC_MODEL_HOST`, `WHISPER_*` removed
  - `README.md`, `AGENTS.md` only if it describes running (today it doesn't [verified])
  - `scripts/setup.mjs`, `scripts/prereqs.mjs`
  - `scripts/smoke-review.mts` (Playwright-driven)
  - `/privacy` draft: a note for Nyle about video staying on the device until the 720p copy is sent, and the Hugging Face model download. Wording is Nyle's call; flag it in `docs/legal-review.md`, not in the page.
- Tests: `deploy-config.test.ts`, `prereqs.test.ts`.
- Manual checklist for the first deploy:
  - `/api/health` returns ok
  - `curl -I -H "Host: <platform hostname>" https://<platform hostname>/` gives a 307 to `HOSTED_PUBLIC_URL`, and the public address doesn't redirect
  - check the client-IP header with two networks
  - a real upload on a phone, signed in, reaches done
  - the instance sleeping mid-review resumes on the next visit
  - one chat answer that inspects a moment

---

## 10. Open questions for Nyle

1. **Inspect at 4 fps instead of 8** (section 3.4). Recommended. 8 fps doubles sprite storage.
2. **Hugging Face CDN for the Whisper model** (section 2). The user's browser contacts huggingface.co once per browser. The alternative is self-hosting in Supabase Storage, which costs egress, or in the image, which costs size and CPU.
3. **Browsers without WebCodecs get a "use a recent browser" message**, including in local mode.
4. **Privacy page wording** for on-device preparation (step 4).
5. Real processing times from `npm run eval` on your machine, to confirm the "up to ~20 min of background work" figure in section 5.1 before choosing between Koyeb and Render.

---

## 11. Decisions (Nov 17, 2026, from the coordinator) — these override anything above

- **Host: Render free web service is the primary target** (Koyeb dropped). Render: 512 MB RAM, 0.1 CPU, no persistent disk, may restart anytime; sleeps after 15 min with no INBOUND traffic (background work doesn't keep it awake), ~1 min cold start; HTTP responses may run up to 100 minutes; **5 GB/month outbound bandwidth** on the free workspace; 750 instance-hours/month. Consequences:
  - Never proxy media through the app. Media is served to the browser with Supabase signed URLs and uploaded directly to Supabase.
  - **No large static assets served from the app.** The ORT wasm (~28 MB), the Whisper model and the AAC-encoder wasm load from public CDNs (onnxruntime-web/transformers wasm from jsDelivr pinned to the exact version, `env.backends.onnx.wasm.wasmPaths`; Whisper model from Hugging Face; AAC wasm from jsDelivr pinned) — NOT copied to `public/vendor`. Make the CDN base overridable by a `NEXT_PUBLIC_*` env var. Drop `scripts/copy-ort-wasm.mjs`. Local mode may use the same CDNs (needs internet anyway for Claude).
  - The review page already polls; that inbound traffic keeps Render awake while the user waits. Any request (including the poll and /api/health) resumes stalled jobs. Resume on boot via instrumentation.
  - Chat streaming has no 100 s cap on Render. Step 3 is reduced: keep answers as a resumable background task only if it's simple; 75 s segmentation is NOT required. At minimum: an answer orphaned by a restart is marked failed and its credit settled (no half-saved answer shown as final).
  - Add `render.yaml` (free plan, one web service, health check `/api/health`, env vars listed with `sync: false`, no values). Docs: Render first, Fly secondary (fly.toml kept, worker group removed), Koyeb mentioned only as an alternative.
- Q1 inspect at **4 fps** (recommended) — yes.
- Q2 Whisper model from **Hugging Face CDN** — yes (see bandwidth above).
- Q3 "use a recent browser" message when WebCodecs is missing — yes, plain friendly copy.
- Q4 privacy wording — flag in docs/legal-review.md only (Nyle's call), as planned.
- Q5 `npm run eval` is a paid run — do NOT run it. Use the estimate and say it's an estimate.
- Tooling note for implementers: you cannot run ffmpeg, bash scripts, `npm run dev` or `npm start`. Write `scripts/make-fixtures.sh` and tell the coordinator to run it; the coordinator runs servers/Playwright e2e and RSS measurements.
