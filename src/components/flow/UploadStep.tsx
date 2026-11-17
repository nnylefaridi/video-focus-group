"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import type { ExpertCard } from "@/core/expert";
import type { Answer } from "@/core/questionnaire/engine";
import { Avatar } from "../Avatar";
import { ArrowLeft, Film } from "../Icons";
import type { PaymentContext } from "@/server/billing";
import { LoginHint } from "./LoginHint";
import { PAYMENT_LABELS } from "./PaymentStep";
import { ApiKeyPanel } from "../account/ApiKeyPanel";
import { CreditsPanel } from "../account/CreditsPanel";
import { formatMicros } from "@/core/credits";
import { ACCEPT, checkFile, checkVideo, MAX_PICK_MB } from "@/core/uploadChecks";

/** Sends one prepared file with real progress: to storage's one-time URL (hosted) or to this computer (local). */
function put(url: string, blob: Blob, hosted: boolean, onProgress: (sent: number) => void): Promise<{ ok: boolean; error?: string }> {
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.setRequestHeader("content-type", blob.type || "application/octet-stream");
    if (hosted) xhr.setRequestHeader("x-upsert", "true");
    xhr.upload.onprogress = (e) => onProgress(e.loaded);
    xhr.onload = () =>
      resolve(
        xhr.status >= 200 && xhr.status < 300
          ? { ok: true }
          : { ok: false, error: xhr.status === 413 ? "Your video came out too big to store. Please trim it and try again." : "Sending your video failed. Please try again." },
      );
    xhr.onerror = () => resolve({ ok: false, error: "Sending was interrupted, so it has to start over. Check your connection and try again." });
    xhr.send(blob);
  });
}

const PHASE_COPY: Record<string, string> = {
  convert: "Preparing your video on this device…",
  frames: "Finding cuts and pulling frames…",
  audio: "Measuring the sound…",
  transcribe: "Listening for speech… This can take a minute or two on a phone.",
};

const mb = (bytes: number) => Math.max(1, Math.round(bytes / 1024 / 1024));

export function UploadStep({
  answers,
  board,
  payment = null,
  maxUploadMb,
  hosted = false,
  onBack,
  onDone,
  onChangePayment,
  onPaymentChange,
}: {
  answers: Answer[];
  board: ExpertCard[];
  /** The most the prepared video may be, in MB (MAX_UPLOAD_MB on the server). */
  maxUploadMb: number;
  /** Hosted mode: prepared files go straight to storage instead of to this computer. */
  hosted?: boolean;
  /** Hosted mode: how the account pays. Null in local mode, which uses the server's own key. */
  payment?: PaymentContext | null;
  onBack: () => void;
  onDone: () => void;
  onChangePayment?: () => void;
  /** Hosted mode: an API key was saved or removed here, so the account can (or can't) pay now. */
  onPaymentChange?: (payment: PaymentContext) => void;
}) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  // Preparing takes minutes, and the board can finish loading after the file is picked: send the
  // latest answers and board when the review starts, not the ones from the moment of picking.
  const latest = useRef({ answers, board });
  latest.current = { answers, board };
  const [drag, setDrag] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [status, setStatus] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loginHelps, setLoginHelps] = useState(false);
  /** Reading the chosen video's length and shape, before the long work. */
  const [checking, setChecking] = useState(false);

  async function start(file: File) {
    setError(null);
    setLoginHelps(false);
    const fail = (message: string) => {
      setChecking(false);
      setProgress(null);
      setStatus("");
      setError(message);
    };
    // Quick checks first, so a problem shows in seconds and not after a long wait.
    const basics = checkFile(file, MAX_PICK_MB);
    if (basics) return fail(basics);
    setChecking(true);
    const { prepareVideo, probeFile, PrepareError, supportProblem } = await import("@/media/browser/prepare");
    const unsupported = await supportProblem();
    if (unsupported) return fail(unsupported);
    const facts = await probeFile(file).catch((e) => (e instanceof PrepareError ? e : null));
    if (facts instanceof Error) return fail(facts.message);
    const problem = facts && checkVideo(facts);
    if (problem) return fail(problem);
    setChecking(false);

    // Prepared on this device first, so a slow phone never holds a review (or credit) open.
    setProgress(0);
    setStatus(PHASE_COPY.convert);
    const lock = await navigator.wakeLock?.request("screen").catch(() => null);
    let prepared;
    try {
      prepared = await prepareVideo(file, {
        maxBytes: maxUploadMb * 1024 * 1024,
        onProgress: (p) => {
          setProgress(p.overall * 0.9);
          setStatus(p.model ? `Getting the speech reader ready (one time, ${mb(p.model.loaded)} of ${mb(p.model.total)} MB)…` : PHASE_COPY[p.phase]);
        },
      });
    } catch (e) {
      await lock?.release().catch(() => {});
      if (e instanceof PrepareError) return fail(e.message);
      console.error("[prepare]", e);
      return fail("Something went wrong preparing your video on this device. Please try again, or try a recent Chrome.");
    }

    setStatus("Starting your review…");
    const res = await fetch("/api/reviews", { method: "POST", body: JSON.stringify({ answers: latest.current.answers, board: latest.current.board.map((b) => b.id) }) }).catch(() => null);
    if (!res) {
      await lock?.release().catch(() => {});
      return fail(hosted ? "Couldn't reach Video Focus Group. Please try again." : "Couldn't reach Video Focus Group. Check it's still running in Terminal, then try again.");
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      await lock?.release().catch(() => {});
      setLoginHelps(Boolean(data.login));
      // Credits ran short since this page loaded: show where to add them.
      if (data.payment === "credits" && onPaymentChange) {
        const fresh = await fetch("/api/credits").then((r) => (r.ok ? r.json() : null)).catch(() => null);
        if (fresh?.payment) onPaymentChange(fresh.payment as PaymentContext);
      }
      return fail(data.error ?? "Couldn't start the review.");
    }

    const names = [...prepared.files.keys()];
    const target = await fetch(`/api/reviews/${data.id}/upload-urls`, { method: "POST", body: JSON.stringify({ files: names }) }).catch(() => null);
    const t = target ? await target.json().catch(() => ({})) : {};
    if (!target?.ok || !t.urls) {
      await lock?.release().catch(() => {});
      return fail(t.error ?? "Couldn't reach Video Focus Group. Please try again.");
    }
    const total = [...prepared.files.values()].reduce((n, b) => n + b.size, 0);
    const sent = new Map<string, number>();
    const show = () => {
      const done = [...sent.values()].reduce((n, x) => n + x, 0);
      setProgress(0.9 + 0.1 * (done / total));
      setStatus(`Sending it (${mb(done)} of ${mb(total)} MB)…`);
    };
    // A few at a time: the video first (it's the big one), the stills alongside.
    const queue = [...names];
    let failed: string | null = null;
    const worker = async () => {
      for (let name = queue.shift(); name && !failed; name = queue.shift()) {
        const blob = prepared.files.get(name)!;
        let r = await put(t.urls[name], blob, hosted, (n) => (sent.set(name!, n), show()));
        if (!r.ok) r = await put(t.urls[name], blob, hosted, (n) => (sent.set(name!, n), show()));
        if (!r.ok) failed = r.error ?? "Sending your video failed.";
        else sent.set(name, blob.size);
        show();
      }
    };
    await Promise.all(Array.from({ length: 4 }, worker));
    if (failed) {
      await lock?.release().catch(() => {});
      return fail(failed);
    }

    setStatus("Checking your video…");
    const done = await fetch(`/api/reviews/${data.id}/upload-complete`, { method: "POST", body: JSON.stringify(prepared.manifest) }).catch(() => null);
    await lock?.release().catch(() => {});
    if (!done?.ok) {
      const d = done ? await done.json().catch(() => ({})) : {};
      return fail(d.error ?? "Your video was sent, but we couldn't confirm it. Please try again.");
    }
    setProgress(1);
    onDone();
    router.push(`/r/${data.id}`);
  }

  const uploading = progress !== null || checking;

  return (
    <div className="mx-auto w-full max-w-xl">
      <button onClick={onBack} disabled={uploading} className="-ml-2 mb-8 inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-sm text-ink-soft transition-colors hover:text-ink disabled:opacity-40">
        <ArrowLeft className="h-4 w-4" /> Back
      </button>
      <h1 className="font-display text-[2rem] leading-tight font-extrabold text-ink sm:text-[2.6rem]">Now, the video</h1>
      <p className="mt-3 font-semibold text-ink-soft">
        A vertical MP4, MOV or WebM, up to 3 minutes. Your device makes a smaller copy before sending it.
      </p>

      {payment?.method && (
        <p className="mt-2 text-sm text-ink-soft">
          Paying with {PAYMENT_LABELS[payment.method]}
          {payment.method === "own_key" && payment.ready && payment.key ? ` (ending in ${payment.key.last4})` : ""}
          {payment.method === "credits" && payment.ready ? ` (${formatMicros(payment.credits.available)} free)` : ""}.
          {onChangePayment && (
            <button
              onClick={onChangePayment}
              disabled={uploading}
              className="ml-1.5 font-semibold underline decoration-line-strong underline-offset-4 transition-colors hover:text-ink disabled:opacity-40"
            >
              Change
            </button>
          )}
        </p>
      )}

      {payment && !payment.ready && payment.method === "own_key" && onPaymentChange ? (
        <div className="cutout mt-8 p-5">
          <p className="mb-4 text-sm font-semibold text-ink-soft">{payment.problem}</p>
          <ApiKeyPanel initial={payment.key} onChange={onPaymentChange} />
        </div>
      ) : payment && !payment.ready && payment.method === "credits" && onPaymentChange ? (
        <div className="cutout mt-8 p-5">
          <p className="mb-4 text-sm font-semibold text-ink-soft">{payment.problem}</p>
          <CreditsPanel initial={payment} from="flow" onChange={onPaymentChange} />
        </div>
      ) : payment && !payment.ready ? (
        <p role="alert" className="mt-8 rounded-xl bg-warn-soft px-4 py-3 text-sm text-warn">
          {payment.problem}
        </p>
      ) : (
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDrag(true);
          }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDrag(false);
            const f = e.dataTransfer.files[0];
            if (f && !uploading) start(f);
          }}
          className={`cutout-lift mt-8 rotate-[0.3deg] rounded-[1.6rem] px-6 py-12 text-center outline-2 outline-offset-[-14px] outline-dashed transition-colors ${
            drag ? "bg-accent-soft outline-accent" : "outline-line-strong"
          }`}
        >
          {checking ? (
            <p aria-live="polite" className="font-display font-extrabold text-xl text-ink">
              Having a quick look at your video…
            </p>
          ) : uploading ? (
            <div aria-live="polite">
              <p className="font-display font-extrabold text-xl text-ink">{status}</p>
              <p className="mt-2 text-sm text-ink-soft">Keep this tab open until it&apos;s sent. After that you can close it.</p>
              <div className="mx-auto mt-5 h-2 max-w-xs overflow-hidden rounded-full bg-paper-deep">
                <div className="h-full rounded-full bg-accent transition-[width] duration-200" style={{ width: `${Math.round(progress! * 100)}%` }} />
              </div>
              <p className="mt-3 text-sm text-ink-soft">{Math.round(progress! * 100)}%</p>
            </div>
          ) : (
            <>
              <Film className="mx-auto h-10 w-10 text-ink-soft" />
              <p className="mt-4 font-bold text-ink">Drop your video here</p>
              <button
                onClick={() => input.current?.click()}
                className="mt-4 rounded-full bg-accent px-6 py-2.5 font-bold text-accent-ink transition-all hover:brightness-110"
              >
                Choose a file
              </button>
              <input
                ref={input}
                type="file"
                accept={ACCEPT}
                className="sr-only"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) start(f);
                  e.target.value = "";
                }}
              />
            </>
          )}
        </div>
      )}

      {error && (
        <p role="alert" className="mt-4 rounded-xl bg-warn-soft px-4 py-3 text-sm text-warn">
          {error}
          {loginHelps && <LoginHint />}
        </p>
      )}

      <div className="mt-10 flex items-center gap-3">
        <div className="flex -space-x-2">
          {board.map((c) => (
            <Avatar key={c.id} card={c} size={36} />
          ))}
        </div>
        <p className="text-sm text-ink-soft">{board.map((b) => b.name).join(", ")} will watch it.</p>
      </div>
    </div>
  );
}
