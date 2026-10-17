"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { supabaseBrowser } from "@/lib/supabase-browser";
import { authReady, safeNext } from "@/lib/supabase";
import { ArrowLeft, Spinner } from "../Icons";

type Mode = "login" | "signup";

/** Google's "G", as its sign-in guidelines ask for on a Google button. */
const GoogleG = () => (
  <svg viewBox="0 0 48 48" className="h-5 w-5" aria-hidden>
    <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
    <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
    <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
    <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
  </svg>
);

function friendly(message: string): string {
  if (/invalid login credentials/i.test(message)) return "That email and password don't match an account.";
  if (/email not confirmed/i.test(message)) return "Confirm your email first. The link is in your inbox.";
  if (/rate limit|too many/i.test(message)) return "Too many tries just now. Wait a minute and try again.";
  if (/error sending/i.test(message)) return "We couldn't send that email just now. Please try again in a few minutes, or continue with Google.";
  if (/password/i.test(message) && /least|short|weak/i.test(message)) return message;
  return message || "Something went wrong. Please try again.";
}

export function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = safeNext(params.get("next"));
  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState<null | "google" | "email" | "reset">(null);
  const [error, setError] = useState<string | null>(params.get("error") ? "That link didn't work or has expired. Please try again." : null);
  const [notice, setNotice] = useState<string | null>(params.get("confirmed") ? "Almost there: log in here to finish. If you just confirmed your email, that worked." : null);

  if (!authReady) {
    return (
      <div className="mx-auto w-full max-w-md">
        <h1 className="font-display text-[2rem] leading-tight font-extrabold text-ink">Log in to keep your reviews</h1>
        <p role="alert" className="mt-6 rounded-xl bg-warn-soft px-4 py-3 text-sm text-warn">
          Sign-in isn&apos;t set up yet. Add the Supabase settings to .env.local (see the README) and restart the app.
        </p>
      </div>
    );
  }

  const callback = (to: string) => {
    // Also remember the destination for 10 minutes, in case the sign-in comes back without it.
    document.cookie = `panel_next=${encodeURIComponent(to)}; path=/; max-age=600; samesite=lax`;
    return `${window.location.origin}/auth/callback?next=${encodeURIComponent(to)}`;
  };
  const reset = () => {
    setError(null);
    setNotice(null);
  };

  async function google() {
    reset();
    setBusy("google");
    const { error } = await supabaseBrowser().auth.signInWithOAuth({ provider: "google", options: { redirectTo: callback(next) } });
    if (error) {
      setBusy(null);
      setError(friendly(error.message));
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    reset();
    setBusy("email");
    const auth = supabaseBrowser().auth;
    if (mode === "login") {
      const { error } = await auth.signInWithPassword({ email, password });
      if (error) {
        setBusy(null);
        return setError(friendly(error.message));
      }
      router.replace(next);
      router.refresh();
      return;
    }
    const { data, error } = await auth.signUp({ email, password, options: { emailRedirectTo: callback(next) } });
    setBusy(null);
    if (error) return setError(friendly(error.message));
    if (data.session) {
      router.replace(next);
      router.refresh();
      return;
    }
    setPassword("");
    setNotice(`Check ${email} for a link to finish signing up. Your reviews will be waiting.`);
  }

  async function forgot() {
    reset();
    if (!email) return setError("Type your email above first, then choose Forgot password.");
    setBusy("reset");
    const { error } = await supabaseBrowser().auth.resetPasswordForEmail(email, { redirectTo: callback("/login/new-password") });
    setBusy(null);
    if (error) return setError(friendly(error.message));
    setNotice(`If ${email} has an account, a link to choose a new password is on its way.`);
  }

  const field = "block w-full rounded-xl bg-card px-4 py-3 text-base font-semibold text-ink outline-none ring-1 ring-line-strong transition-shadow placeholder:font-normal placeholder:text-ink-faint focus:ring-2 focus:ring-accent";

  return (
    <div className="mx-auto w-full max-w-md">
      <button
        onClick={() => (window.history.length > 1 ? router.back() : router.push("/"))}
        className="-ml-2 mb-8 inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-sm font-semibold text-ink-soft transition-colors hover:text-ink"
      >
        <ArrowLeft className="h-4 w-4" /> Back
      </button>
      <h1 className="font-display text-[2rem] leading-tight font-extrabold text-ink sm:text-[2.4rem]">
        {mode === "login" ? "Log in to keep your reviews" : "Sign up to keep your reviews"}
      </h1>
      <p className="mt-3 font-semibold text-ink-soft">Your reviews, their videos and your follow-up chats stay in your account.</p>

      <button
        onClick={google}
        disabled={busy !== null}
        className="cutout-lift mt-8 flex w-full items-center justify-center gap-3 rounded-full px-6 py-3 font-bold text-ink transition-all hover:-translate-y-0.5 disabled:opacity-60"
      >
        {busy === "google" ? <Spinner className="h-5 w-5" /> : <GoogleG />}
        Continue with Google
      </button>

      <div className="my-6 flex items-center gap-3 text-sm font-semibold text-ink-faint" aria-hidden>
        <span className="h-px flex-1 bg-line-strong" />
        or with email
        <span className="h-px flex-1 bg-line-strong" />
      </div>

      <form onSubmit={submit} className="space-y-3">
        <div>
          <label htmlFor="email" className="mb-1.5 block text-sm font-bold text-ink">
            Email
          </label>
          <input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} className={field} />
        </div>
        <div>
          <label htmlFor="password" className="mb-1.5 block text-sm font-bold text-ink">
            Password
          </label>
          <input
            id="password"
            type="password"
            autoComplete={mode === "login" ? "current-password" : "new-password"}
            required
            minLength={mode === "signup" ? 8 : undefined}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={field}
          />
          {mode === "signup" && <p className="mt-1 text-xs text-ink-faint">At least 8 characters.</p>}
        </div>
        <button
          type="submit"
          disabled={busy !== null}
          className="mt-2 inline-flex w-full items-center justify-center gap-2 rounded-full bg-accent px-6 py-3 font-bold text-accent-ink transition-all hover:brightness-110 disabled:opacity-60"
        >
          {busy === "email" && <Spinner className="h-5 w-5" />}
          {mode === "login" ? "Log in" : "Create account"}
        </button>
      </form>

      {error && (
        <p role="alert" className="mt-4 rounded-xl bg-warn-soft px-4 py-3 text-sm text-warn">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="mt-4 rounded-xl bg-accent-soft px-4 py-3 text-sm font-semibold text-ink">
          {notice}
        </p>
      )}

      <div className="mt-6 flex flex-wrap items-center justify-between gap-3 text-sm font-semibold text-ink-soft">
        <button
          onClick={() => {
            reset();
            setMode(mode === "login" ? "signup" : "login");
          }}
          className="underline decoration-line-strong underline-offset-4 hover:text-ink"
        >
          {mode === "login" ? "New here? Create an account" : "Have an account? Log in"}
        </button>
        {mode === "login" && (
          <button onClick={forgot} disabled={busy !== null} className="underline decoration-line-strong underline-offset-4 hover:text-ink disabled:opacity-60">
            {busy === "reset" ? "Sending…" : "Forgot password?"}
          </button>
        )}
      </div>
    </div>
  );
}
