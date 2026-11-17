"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { PaymentContext, PaymentMethod } from "@/server/billing";
import { ApiKeyPanel } from "../account/ApiKeyPanel";
import { CreditsPanel } from "../account/CreditsPanel";
import { ArrowLeft, Spinner } from "../Icons";
import { LoginHint } from "./LoginHint";

export const START_CHOICES: { method: PaymentMethod; label: string; cost: string }[] = [
  { method: "credits", label: "Buy credits", cost: "Top up from $10 by card. Each use costs what it costs us plus 20%." },
  { method: "own_key", label: "Use your own Anthropic key", cost: "Anthropic bills your key. Video Focus Group charges nothing." },
];

/** A pick made before logging in, applied once they're back signed in. */
export const INTENT_KEY = "panel.pay.intent.v1";
/** The pick whose setup (key or top-up) is under way, kept across the trip to Stripe and back. */
export const SETUP_KEY = "panel.pay.setup.v1";

function read(storage: () => Storage, key: string): PaymentMethod | null {
  try {
    const v = storage().getItem(key);
    return v === "credits" || v === "own_key" ? v : null;
  } catch {
    return null;
  }
}
function write(storage: () => Storage, key: string, v: PaymentMethod | null) {
  try {
    if (v) storage().setItem(key, v);
    else storage().removeItem(key);
  } catch {
    /* storage unavailable: they're asked again next visit */
  }
}

/**
 * Hosted mode, first screen, in place of the first question: how to pay, with the demo
 * playing. The questions start once the choice can pay (key saved, or credits topped up),
 * because the server checks answers only on the visitor's own key or credits. Signed out,
 * a pick is kept and they log in first. `pay` is null when signed out.
 */
export function StartPay({ pay, onPayment }: { pay: PaymentContext | null; onPayment: (ctx: PaymentContext) => void }) {
  const router = useRouter();
  const signedIn = pay !== null;
  const [setup, setSetupState] = useState<PaymentMethod | null>(() => (signedIn ? read(() => sessionStorage, SETUP_KEY) : null));
  const [busy, setBusy] = useState<PaymentMethod | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loginHelps, setLoginHelps] = useState(false);
  const video = useRef<HTMLVideoElement>(null);
  const [muted, setMuted] = useState(true);
  // It starts muted (browsers only autoplay silent video); the button turns the sound on.
  const toggleSound = () => {
    const v = video.current;
    if (!v) return;
    v.muted = !v.muted;
    if (!v.muted && v.paused) void v.play().catch(() => {});
    setMuted(v.muted);
  };

  const setSetup = (m: PaymentMethod | null) => {
    setSetupState(m);
    write(() => sessionStorage, SETUP_KEY, m);
  };

  const choose = useCallback(
    async (method: PaymentMethod) => {
      setError(null);
      setLoginHelps(false);
      if (!signedIn) {
        write(() => localStorage, INTENT_KEY, method);
        router.push("/login?next=/");
        return;
      }
      setBusy(method);
      const res = await fetch("/api/account/payment", { method: "POST", body: JSON.stringify({ method }) }).catch(() => null);
      const data = res ? await res.json().catch(() => ({})) : {};
      setBusy(null);
      if (!res) return setError("Couldn't reach Video Focus Group. Please try again.");
      if (!res.ok) {
        setLoginHelps(Boolean(data.login));
        return setError(data.error ?? "Couldn't save that. Please try again.");
      }
      setSetupState(method);
      write(() => sessionStorage, SETUP_KEY, method);
      onPayment(data as PaymentContext);
    },
    [signedIn, onPayment, router],
  );

  // Back from logging in with a pick made before it: apply it.
  useEffect(() => {
    if (!signedIn) return;
    const t = setTimeout(() => {
      const intent = read(() => localStorage, INTENT_KEY);
      if (!intent) return;
      write(() => localStorage, INTENT_KEY, null);
      void choose(intent);
    }, 0);
    return () => clearTimeout(t);
  }, [signedIn, choose]);

  if (signedIn && setup && pay.method === setup) {
    return (
      <div className="mx-auto w-full max-w-xl">
        <button onClick={() => setSetup(null)} className="-ml-2 mb-8 inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-sm font-semibold text-ink-soft transition-colors hover:text-ink">
          <ArrowLeft className="h-4 w-4" /> Back
        </button>
        <h1 className="font-display text-[2rem] leading-[1.15] font-extrabold tracking-[-0.015em] text-ink sm:text-[2.6rem]">
          {setup === "own_key" ? "Add your Anthropic API key" : "Top up your credits"}
        </h1>
        {pay.problem && <p className="mt-3 text-base text-ink-soft">{pay.problem}</p>}
        <div className="mt-8">{setup === "own_key" ? <ApiKeyPanel initial={pay.key} onChange={onPayment} /> : <CreditsPanel initial={pay} from="flow" onChange={onPayment} />}</div>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-5xl">
      <h1 className="font-display text-[2rem] leading-[1.15] font-extrabold tracking-[-0.015em] text-ink sm:text-[2.6rem]">Make your videos WORK</h1>
      {/* As big as fits: the rest of the screen takes about 19rem, so the video gets the height left. */}
      <div className="relative mx-auto mt-5 w-full max-w-[calc((100dvh-19rem)*16/9)]">
        <video
          ref={video}
          className="block aspect-video w-full rounded-[1.4rem] bg-ink object-cover shadow-lift"
          src="/demo.mp4"
          poster="/demo-poster.jpg"
          autoPlay
          muted
          loop
          playsInline
          preload="auto"
          aria-label="Video Focus Group launch video"
        />
        <button
          type="button"
          onClick={toggleSound}
          aria-pressed={!muted}
          className="absolute right-3 bottom-3 rounded-full bg-accent px-3.5 py-1.5 text-sm font-bold text-accent-ink transition-all hover:brightness-110"
        >
          {muted ? "Sound on" : "Sound off"}
        </button>
      </div>
      <div className="mt-5 grid gap-3 sm:grid-cols-2" role="group" aria-label="How do you want to pay?">
        {START_CHOICES.map((c) => (
          <button
            key={c.method}
            disabled={busy !== null}
            onClick={() => choose(c.method)}
            className="cutout rounded-[1.4rem] px-5 py-4 text-left transition-all hover:-translate-y-0.5 hover:shadow-lift"
          >
            <span className="flex items-center gap-2 text-lg font-bold text-ink">
              {c.label}
              {busy === c.method && <Spinner className="h-4 w-4" />}
            </span>
            <span className="mt-1 block text-sm text-ink-soft">{c.cost}</span>
          </button>
        ))}
      </div>
      {error && (
        <p role="alert" className="mt-4 rounded-xl bg-warn-soft px-4 py-3 text-sm text-warn">
          {error}
          {loginHelps && <LoginHint />}
        </p>
      )}
    </div>
  );
}
