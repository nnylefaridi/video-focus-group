"use client";

import { useState } from "react";
import type { KeyInfo } from "@/server/apikeys";
import type { PaymentContext } from "@/server/billing";
import { Spinner } from "../Icons";
import { LoginHint } from "../flow/LoginHint";

const field =
  "block w-full rounded-xl bg-card px-4 py-3 text-base font-semibold text-ink outline-none ring-1 ring-line-strong transition-shadow placeholder:font-normal placeholder:text-ink-faint focus:ring-2 focus:ring-accent";
const savedOn = (at: number) => new Date(at).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });

/**
 * Hosted mode: save, replace or remove the account's own Anthropic API key. The key
 * goes to Panel once, to be checked and saved; after that only its last 4 characters
 * ever come back.
 */
export function ApiKeyPanel({ initial, onChange }: { initial: KeyInfo | null; onChange?: (payment: PaymentContext) => void }) {
  const [key, setKey] = useState(initial);
  const [editing, setEditing] = useState(!initial);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState<null | "save" | "remove">(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loginHelps, setLoginHelps] = useState(false);

  async function send(method: "PUT" | "DELETE") {
    setBusy(method === "PUT" ? "save" : "remove");
    setError(null);
    setLoginHelps(false);
    const res = await fetch("/api/account/key", { method, body: method === "PUT" ? JSON.stringify({ key: value }) : undefined }).catch(() => null);
    const data = res ? await res.json().catch(() => ({})) : {};
    setBusy(null);
    if (!res) return setError("Couldn't reach Video Focus Group. Please try again.");
    if (!res.ok) {
      setLoginHelps(Boolean(data.login));
      return setError(data.error ?? "Couldn't save that. Please try again.");
    }
    setValue("");
    setKey(data.key);
    setEditing(!data.key);
    setConfirmRemove(false);
    if (data.payment) onChange?.(data.payment as PaymentContext);
  }

  return (
    <div>
      {key && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-ink">
            <span className="font-bold">Key ending in {key.last4}</span>
            <span className="text-ink-soft" suppressHydrationWarning>
              {" "}
              · saved {savedOn(key.savedAt)}
            </span>
          </p>
          {!confirmRemove && (
            <div className="flex gap-2 text-sm font-semibold">
              {!editing && (
                <button onClick={() => setEditing(true)} disabled={busy !== null} className="rounded-full px-3 py-1.5 text-ink ring-1 ring-line-strong transition-colors hover:bg-paper-deep disabled:opacity-60">
                  Replace
                </button>
              )}
              <button onClick={() => setConfirmRemove(true)} disabled={busy !== null} className="rounded-full px-3 py-1.5 text-warn ring-1 ring-line-strong transition-colors hover:bg-warn-soft disabled:opacity-60">
                Remove
              </button>
            </div>
          )}
        </div>
      )}

      {key?.rejected && !editing && (
        <p role="alert" className="mt-3 rounded-xl bg-warn-soft px-4 py-3 text-sm text-warn">
          Anthropic rejected this key during a review. Replace it with a working one to keep going.
        </p>
      )}

      {confirmRemove && (
        <div className="mt-3 rounded-xl bg-warn-soft px-4 py-3 text-sm text-warn">
          <p>Remove your key from Video Focus Group? A review running on it will stop at its next step.</p>
          <div className="mt-2 flex gap-2 font-semibold">
            <button onClick={() => send("DELETE")} disabled={busy !== null} className="inline-flex items-center gap-1.5 rounded-full bg-warn px-3 py-1.5 text-card disabled:opacity-60">
              {busy === "remove" && <Spinner className="h-4 w-4" />}
              Yes, remove it
            </button>
            <button onClick={() => setConfirmRemove(false)} disabled={busy !== null} className="rounded-full px-3 py-1.5 text-ink ring-1 ring-line-strong disabled:opacity-60">
              Keep it
            </button>
          </div>
        </div>
      )}

      {editing && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!busy) send("PUT");
          }}
          className={key ? "mt-4" : ""}
        >
          <label htmlFor="anthropic-key" className="mb-1.5 block text-sm font-bold text-ink">
            {key ? "New Anthropic API key" : "Your Anthropic API key"}
          </label>
          <input
            id="anthropic-key"
            type="password"
            autoComplete="off"
            spellCheck={false}
            required
            placeholder="sk-ant-…"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className={field}
          />
          <p className="mt-1.5 text-xs text-ink-faint">
            Make one in the{" "}
            <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noreferrer" className="underline underline-offset-2 hover:text-ink">
              Anthropic Console
            </a>
            . Video Focus Group checks it with Anthropic, keeps it encrypted, and only ever shows its last 4 characters.
          </p>
          <div className="mt-3 flex gap-2">
            <button
              type="submit"
              disabled={busy !== null}
              className="inline-flex items-center gap-2 rounded-full bg-accent px-5 py-2.5 font-bold text-accent-ink transition-all hover:brightness-110 disabled:opacity-60"
            >
              {busy === "save" && <Spinner className="h-4 w-4" />}
              {busy === "save" ? "Checking with Anthropic…" : key ? "Replace key" : "Save key"}
            </button>
            {key && (
              <button
                type="button"
                onClick={() => {
                  setEditing(false);
                  setValue("");
                  setError(null);
                }}
                disabled={busy !== null}
                className="rounded-full px-4 py-2.5 text-sm font-semibold text-ink-soft hover:text-ink disabled:opacity-60"
              >
                Cancel
              </button>
            )}
          </div>
        </form>
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
