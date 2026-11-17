"use client";

import { useCallback, useEffect, useState } from "react";
import type { PaymentContext } from "@/server/billing";
import { CREDIT_PACKS, formatMicros, MICROS_PER_CENT, NO_CASH_REFUND, ON_HOLD, type CreditPackId } from "@/core/credits";
import { Spinner } from "../Icons";
import { LoginHint } from "../flow/LoginHint";
import { LegalLinks } from "./LegalLinks";

const POLL_MS = 2000;
const POLL_TRIES = 20;

type Notice = { tone: "ok" | "wait" | "warn"; text: string; recheck?: string };

/** Removes ?topup= and ?session_id= once they've been read, so a reload doesn't repeat the message. */
function clearReturnParams() {
  const url = new URL(window.location.href);
  url.searchParams.delete("topup");
  url.searchParams.delete("session_id");
  window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
}

/**
 * Hosted mode: the account's prepaid credits, and buying more through Stripe Checkout.
 * After paying, Stripe sends people back here; the credit arrives by Stripe's webhook,
 * so this checks until it's there (or says it's still on its way).
 */
export function CreditsPanel({ initial, from, onChange }: { initial: PaymentContext; from: "flow" | "account"; onChange?: (payment: PaymentContext) => void }) {
  const [payment, setPayment] = useState(initial);
  const [busy, setBusy] = useState<CreditPackId | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loginHelps, setLoginHelps] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const c = payment.credits;

  const update = useCallback(
    (p: PaymentContext) => {
      setPayment(p);
      onChange?.(p);
    },
    [onChange],
  );

  /** Asks Panel whether this Checkout has been credited, every couple of seconds for a while. */
  const watch = useCallback(
    async (session: string) => {
      setNotice({ tone: "wait", text: "Payment received by Stripe. Adding your credits…" });
      for (let i = 0; i < POLL_TRIES; i++) {
        const res = await fetch(`/api/credits?session_id=${encodeURIComponent(session)}`).catch(() => null);
        const data = res?.ok ? await res.json().catch(() => null) : null;
        if (data?.credited) {
          update(data.payment as PaymentContext);
          return setNotice({ tone: "ok", text: "Your credits are in." });
        }
        await new Promise((r) => setTimeout(r, POLL_MS));
      }
      setNotice({
        tone: "wait",
        text: "Stripe hasn't confirmed this payment to Video Focus Group yet. Some payment methods take a few minutes. Your credits appear here as soon as it does.",
        recheck: session,
      });
    },
    [update],
  );

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const topup = params.get("topup");
    if (!topup) return;
    const session = params.get("session_id");
    clearReturnParams();
    void (async () => {
      await null;
      if (topup === "cancelled") setNotice({ tone: "warn", text: "Payment cancelled. Nothing was charged." });
      else if (topup === "done" && session) await watch(session);
    })();
  }, [watch]);

  async function buy(pack: CreditPackId) {
    if (busy) return;
    setBusy(pack);
    setError(null);
    setLoginHelps(false);
    const res = await fetch("/api/credits/checkout", { method: "POST", body: JSON.stringify({ pack, from }) }).catch(() => null);
    const data = res ? await res.json().catch(() => ({})) : {};
    if (res?.ok && typeof data.url === "string") {
      window.location.assign(data.url);
      return;
    }
    setBusy(null);
    if (!res) return setError("Couldn't reach Video Focus Group. Please try again.");
    setLoginHelps(Boolean(data.login));
    setError(data.error ?? "Couldn't start the payment. Please try again.");
  }

  return (
    <div>
      <p className="text-sm text-ink">
        <span className="font-bold">Balance {formatMicros(c.balance)}</span>
        {c.reserved > 0 && <span className="text-ink-soft"> · {formatMicros(c.reserved)} set aside for what&apos;s running now</span>}
      </p>

      {c.onHold ? (
        <p role="alert" className="mt-3 rounded-xl bg-warn-soft px-4 py-3 text-sm text-warn">
          {ON_HOLD}
        </p>
      ) : (
        <div className="mt-3 flex flex-wrap gap-2">
          {CREDIT_PACKS.map((p) => (
            <button
              key={p.id}
              onClick={() => buy(p.id)}
              disabled={busy !== null}
              className="inline-flex items-center gap-2 rounded-full bg-accent px-5 py-2.5 font-bold text-accent-ink transition-all hover:brightness-110 disabled:opacity-60"
            >
              {busy === p.id && <Spinner className="h-4 w-4" />}
              Add {formatMicros(p.cents * MICROS_PER_CENT).replace(".00", "")}
            </button>
          ))}
        </div>
      )}

      <p className="mt-3 text-xs text-ink-faint">
        You pay what Anthropic charges us for your review plus 20%. A review sets aside up to {formatMicros(c.reviewReserve)} while it runs and gives back what it
        doesn&apos;t use. {NO_CASH_REFUND} Payments go through Stripe.
      </p>
      <LegalLinks className="mt-1.5" />

      {notice && (
        <p role="status" className={`mt-3 rounded-xl px-4 py-3 text-sm ${notice.tone === "warn" ? "bg-warn-soft text-warn" : "bg-accent-soft text-ink"}`}>
          {notice.text}
          {notice.recheck && (
            <button onClick={() => watch(notice.recheck!)} className="ml-1.5 font-semibold underline decoration-line-strong underline-offset-4 hover:text-accent">
              Check again
            </button>
          )}
        </p>
      )}

      {error && (
        <p role="alert" className="mt-3 rounded-xl bg-warn-soft px-4 py-3 text-sm text-warn">
          {error}
          {loginHelps && <LoginHint />}
        </p>
      )}
    </div>
  );
}
