"use client";

import { useState } from "react";
import type { PaymentContext, PaymentMethod } from "@/server/billing";
import { Spinner } from "../Icons";
import { LoginHint } from "../flow/LoginHint";

const CHOICES: { method: PaymentMethod; label: string; cost: string }[] = [
  { method: "credits", label: "Prepaid credits", cost: "You pay what the review costs us plus 20%." },
  { method: "own_key", label: "My own Anthropic API key", cost: "Billed by Anthropic to your key. Video Focus Group charges nothing." },
];

/** Hosted mode: shows how the account pays for reviews, and changes it. Saved on the server. */
export function PaymentMethodPanel({ initial, onChange }: { initial: PaymentContext; onChange?: (payment: PaymentContext) => void }) {
  const [payment, setPayment] = useState(initial);
  const [busy, setBusy] = useState<PaymentMethod | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loginHelps, setLoginHelps] = useState(false);

  async function choose(method: PaymentMethod) {
    if (busy || payment.method === method) return;
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
    setPayment(data as PaymentContext);
    onChange?.(data as PaymentContext);
  }

  return (
    <div>
      {payment.method === null && <p className="mb-3 text-sm text-ink-soft">You haven&apos;t picked one yet. Video Focus Group asks before your first review, too.</p>}
      <div className="flex flex-col gap-3" role="radiogroup" aria-label="How you pay for reviews">
        {CHOICES.map((c) => {
          const on = payment.method === c.method;
          return (
            <button
              key={c.method}
              role="radio"
              aria-checked={on}
              disabled={busy !== null}
              onClick={() => choose(c.method)}
              className={`rounded-[1.4rem] px-5 py-3 text-left transition-all ${on ? "bg-accent-soft ring-2 ring-accent" : "cutout hover:-translate-y-0.5 hover:shadow-lift"}`}
            >
              <span className={`flex items-center gap-2 font-bold ${on ? "text-accent" : "text-ink"}`}>
                {c.label}
                {busy === c.method && <Spinner className="h-4 w-4" />}
              </span>
              <span className="mt-0.5 block text-sm text-ink-soft">{c.cost}</span>
            </button>
          );
        })}
      </div>
      {payment.method && payment.problem && <p className="mt-3 text-sm text-ink-soft">{payment.problem}</p>}
      {error && (
        <p role="alert" className="mt-3 rounded-xl bg-warn-soft px-4 py-3 text-sm text-warn">
          {error}
          {loginHelps && <LoginHint />}
        </p>
      )}
    </div>
  );
}
