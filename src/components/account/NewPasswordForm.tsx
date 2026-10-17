"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { supabaseBrowser } from "@/lib/supabase-browser";
import { Spinner } from "../Icons";

/** Reached from a password-reset email, after /auth/callback has signed the person in. */
export function NewPasswordForm() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const { error } = await supabaseBrowser().auth.updateUser({ password });
    setBusy(false);
    if (error) {
      return setError(
        /session|auth/i.test(error.message) ? "This reset link has expired. Go back to log in and choose Forgot password again." : error.message,
      );
    }
    router.replace("/reviews");
    router.refresh();
  }

  return (
    <div className="mx-auto w-full max-w-md">
      <h1 className="font-display text-[2rem] leading-tight font-extrabold text-ink sm:text-[2.4rem]">Choose a new password</h1>
      <form onSubmit={submit} className="mt-8 space-y-3">
        <label htmlFor="password" className="mb-1.5 block text-sm font-bold text-ink">
          New password
        </label>
        <input
          id="password"
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="block w-full rounded-xl bg-card px-4 py-3 text-base font-semibold text-ink outline-none ring-1 ring-line-strong focus:ring-2 focus:ring-accent"
        />
        <p className="text-xs text-ink-faint">At least 8 characters.</p>
        <button
          type="submit"
          disabled={busy}
          className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-accent px-6 py-3 font-bold text-accent-ink transition-all hover:brightness-110 disabled:opacity-60"
        >
          {busy && <Spinner className="h-5 w-5" />}
          Save password
        </button>
      </form>
      {error && (
        <p role="alert" className="mt-4 rounded-xl bg-warn-soft px-4 py-3 text-sm text-warn">
          {error}
        </p>
      )}
    </div>
  );
}
