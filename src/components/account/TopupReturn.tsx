"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import type { PaymentContext } from "@/server/billing";
import { formatMicros } from "@/core/credits";
import { Spinner } from "../Icons";

const POLL_MS = 2000;
const POLL_TRIES = 20;

type State = { kind: "checking" } | { kind: "credited"; balance: number } | { kind: "pending" } | { kind: "error"; message: string; login: boolean };

/**
 * Where Stripe sends people after paying. Credit arrives by Stripe's webhook, which can
 * land a few seconds after the browser does, so this asks the server (not Stripe, and
 * not the address bar) whether the ledger has the payment yet. It only says credit is in
 * once the ledger does.
 */
export function TopupReturn({ session }: { session: string | null }) {
  const [state, setState] = useState<State>(session ? { kind: "checking" } : { kind: "pending" });
  const running = useRef(false);

  const watch = useCallback(async () => {
    if (!session || running.current) return;
    running.current = true;
    setState({ kind: "checking" });
    for (let i = 0; i < POLL_TRIES; i++) {
      const res = await fetch(`/api/credits?session_id=${encodeURIComponent(session)}`).catch(() => null);
      const data = res ? await res.json().catch(() => ({})) : {};
      if (res && !res.ok && res.status !== 502) {
        running.current = false;
        return setState({ kind: "error", message: data.error ?? "Couldn't check your credits just now.", login: Boolean(data.login) });
      }
      if (res?.ok && data.credited) {
        running.current = false;
        return setState({ kind: "credited", balance: (data.payment as PaymentContext).credits.balance });
      }
      await new Promise((r) => setTimeout(r, POLL_MS));
    }
    running.current = false;
    setState({ kind: "pending" });
  }, [session]);

  useEffect(() => {
    void Promise.resolve().then(watch);
  }, [watch]);

  return (
    <div className="cutout-lift mt-8 -rotate-[0.3deg] p-6 sm:p-8">
      {state.kind === "checking" && (
        <p role="status" className="flex items-center gap-2 font-semibold text-ink">
          <Spinner className="h-4 w-4" /> Payment received by Stripe. Adding your credits…
        </p>
      )}
      {state.kind === "credited" && (
        <>
          <h2 className="font-display text-xl font-extrabold text-ink">Your credits are in</h2>
          <p role="status" className="mt-2 text-ink-soft">
            Your balance is {formatMicros(state.balance)}.
          </p>
        </>
      )}
      {state.kind === "pending" && (
        <>
          <h2 className="font-display text-xl font-extrabold text-ink">Your credits aren&apos;t in yet</h2>
          <p role="status" className="mt-2 text-ink-soft">
            {session
              ? "Stripe hasn't confirmed this payment to Video Focus Group yet. Some payment methods take a few minutes. Nothing is added until it does, and your balance on the account page updates as soon as it has."
              : "This page needs the link Stripe sends you back to after paying. Your balance and history are on the account page."}
          </p>
          {session && (
            <button onClick={watch} className="mt-3 text-sm font-semibold underline decoration-line-strong underline-offset-4 hover:text-accent">
              Check again
            </button>
          )}
        </>
      )}
      {state.kind === "error" && (
        <p role="alert" className="rounded-xl bg-warn-soft px-4 py-3 text-sm text-warn">
          {state.message}
          {state.login && (
            <Link href="/login?next=/account" className="ml-1.5 font-semibold underline underline-offset-4">
              Log in
            </Link>
          )}
        </p>
      )}
      <Link href="/account" className="mt-5 inline-block rounded-full bg-accent px-6 py-2.5 font-bold text-accent-ink transition-all hover:brightness-110">
        Go to your account
      </Link>
    </div>
  );
}
