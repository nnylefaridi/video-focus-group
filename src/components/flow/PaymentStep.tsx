"use client";

import { useState } from "react";
import type { ExpertCard } from "@/core/expert";
import type { PaymentContext, PaymentMethod } from "@/server/billing";
import { Avatar } from "../Avatar";
import { ArrowLeft, Spinner } from "../Icons";
import { LoginHint } from "./LoginHint";

const CHOICES: { method: PaymentMethod; label: string; cost: string }[] = [
  { method: "credits", label: "Prepaid credits", cost: "You pay what the review costs us plus 20%." },
  { method: "own_key", label: "My own Anthropic API key", cost: "Billed by Anthropic to your key. Video Focus Group charges nothing." },
];

export const PAYMENT_LABELS: Record<PaymentMethod, string> = { credits: "prepaid credits", own_key: "your own Anthropic API key" };

/** Hosted mode, signed in: how the account pays, asked once and remembered. Comes before the upload. */
export function PaymentStep({
  board,
  current,
  onBack,
  onChosen,
}: {
  board: ExpertCard[];
  current: PaymentMethod | null;
  onBack: () => void;
  onChosen: (ctx: PaymentContext) => void;
}) {
  const [busy, setBusy] = useState<PaymentMethod | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loginHelps, setLoginHelps] = useState(false);

  async function choose(method: PaymentMethod) {
    if (busy) return;
    setBusy(method);
    setError(null);
    setLoginHelps(false);
    const res = await fetch("/api/account/payment", { method: "POST", body: JSON.stringify({ method }) }).catch(() => null);
    const data = res ? await res.json().catch(() => ({})) : {};
    setBusy(null);
    if (!res) return setError("Couldn't reach Video Focus Group. Please try again.");
    if (!res.ok) {
      setLoginHelps(Boolean(data.login));
      return setError(data.error ?? "Couldn't save that. Please try again.");
    }
    onChosen(data as PaymentContext);
  }

  return (
    <div className="mx-auto w-full max-w-xl">
      <button onClick={onBack} className="-ml-2 mb-8 inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-sm text-ink-soft transition-colors hover:text-ink">
        <ArrowLeft className="h-4 w-4" /> Back
      </button>
      <h1 className="font-display text-[2rem] leading-tight font-extrabold text-ink sm:text-[2.6rem]">How do you want to pay?</h1>
      <p className="mt-3 font-semibold text-ink-soft">Video Focus Group remembers your pick for next time. You can change it whenever you like.</p>

      <div className="mt-8 flex flex-col gap-3" role="radiogroup" aria-label="How do you want to pay?">
        {CHOICES.map((c) => {
          const on = current === c.method;
          return (
            <button
              key={c.method}
              role="radio"
              aria-checked={on}
              disabled={busy !== null}
              onClick={() => choose(c.method)}
              className={`rounded-[1.4rem] px-5 py-4 text-left transition-all ${
                on ? "bg-accent-soft ring-2 ring-accent" : "cutout hover:-translate-y-0.5 hover:shadow-lift"
              }`}
            >
              <span className={`flex items-center gap-2 text-lg font-bold ${on ? "text-accent" : "text-ink"}`}>
                {c.label}
                {busy === c.method && <Spinner className="h-4 w-4" />}
              </span>
              <span className="mt-1 block text-sm text-ink-soft">{c.cost}</span>
            </button>
          );
        })}
      </div>

      {error && (
        <p role="alert" className="mt-4 rounded-xl bg-warn-soft px-4 py-3 text-sm text-warn">
          {error}
          {loginHelps && <LoginHint />}
        </p>
      )}

      {board.length > 0 && (
        <div className="mt-10 flex items-center gap-3">
          <div className="flex -space-x-2">
            {board.map((c) => (
              <Avatar key={c.id} card={c} size={36} />
            ))}
          </div>
          <p className="text-sm text-ink-soft">{board.map((b) => b.name).join(", ")} will watch it.</p>
        </div>
      )}
    </div>
  );
}
