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

const MAX_BYTES = 250 * 1024 * 1024;
const ACCEPT = "video/mp4,video/quicktime,video/webm,.mp4,.mov,.m4v,.webm";

function uploadWithProgress(url: string, file: File, onProgress: (p: number) => void): Promise<{ ok: boolean; error?: string }> {
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.setRequestHeader("x-file-name", encodeURIComponent(file.name));
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    xhr.onload = () => {
      let data: { error?: string } = {};
      try {
        data = JSON.parse(xhr.responseText);
      } catch {}
      resolve(xhr.status >= 200 && xhr.status < 300 ? { ok: true } : { ok: false, error: data.error ?? "The upload failed." });
    };
    xhr.onerror = () => resolve({ ok: false, error: "The upload was interrupted. Please try again." });
    xhr.send(file);
  });
}

export function UploadStep({
  answers,
  board,
  payment = null,
  onBack,
  onDone,
  onChangePayment,
  onPaymentChange,
}: {
  answers: Answer[];
  board: ExpertCard[];
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
  const [drag, setDrag] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loginHelps, setLoginHelps] = useState(false);

  async function start(file: File) {
    setError(null);
    setLoginHelps(false);
    if (file.size > MAX_BYTES) return setError("That file is larger than 250 MB. Please export a smaller version.");
    if (file.size === 0) return setError("That file is empty.");

    setProgress(0);
    const res = await fetch("/api/reviews", { method: "POST", body: JSON.stringify({ answers, board: board.map((b) => b.id) }) }).catch(() => null);
    if (!res) {
      setProgress(null);
      return setError("Couldn't reach Panel. Check it's still running in Terminal, then try again.");
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setProgress(null);
      setLoginHelps(Boolean(data.login));
      // Credits ran short since this page loaded: show where to add them.
      if (data.payment === "credits" && onPaymentChange) {
        const fresh = await fetch("/api/credits").then((r) => (r.ok ? r.json() : null)).catch(() => null);
        if (fresh?.payment) onPaymentChange(fresh.payment as PaymentContext);
      }
      return setError(data.error ?? "Couldn't start the review.");
    }
    const up = await uploadWithProgress(`/api/reviews/${data.id}/video`, file, setProgress);
    if (!up.ok) {
      setProgress(null);
      return setError(up.error ?? "The upload failed.");
    }
    onDone();
    router.push(`/r/${data.id}`);
  }

  const uploading = progress !== null;

  return (
    <div className="mx-auto w-full max-w-xl">
      <button onClick={onBack} disabled={uploading} className="-ml-2 mb-8 inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-sm text-ink-soft transition-colors hover:text-ink disabled:opacity-40">
        <ArrowLeft className="h-4 w-4" /> Back
      </button>
      <h1 className="font-display text-[2rem] leading-tight font-extrabold text-ink sm:text-[2.6rem]">Now, the video</h1>
      <p className="mt-3 font-semibold text-ink-soft">MP4, MOV or WebM, up to 3 minutes and 250 MB.</p>

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
          {uploading ? (
            <div aria-live="polite">
              <p className="font-display font-extrabold text-xl text-ink">{progress! < 1 ? "Uploading…" : "Checking your video…"}</p>
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
