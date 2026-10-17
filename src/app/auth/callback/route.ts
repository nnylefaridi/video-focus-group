import { NextResponse } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { safeNext } from "@/lib/supabase";
import { claimForViewer, getViewer, supabaseServer } from "@/server/auth";

/**
 * Where Google sign-in, email confirmation and password-reset links land. Finishes
 * the sign-in, moves this browser's reviews into the account, then continues on.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  // Send the browser back to the exact host it used (127.0.0.1 vs localhost matters: the
  // sign-in cookie is set on that host). Next can report a different one in req.url.
  const origin = `${req.headers.get("x-forwarded-proto") ?? url.protocol.replace(":", "")}://${req.headers.get("host") ?? url.host}`;
  const next = safeNext(url.searchParams.get("next"));
  const code = url.searchParams.get("code");
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type") as EmailOtpType | null;

  const supabase = await supabaseServer();
  const result = code
    ? await supabase.auth.exchangeCodeForSession(code)
    : tokenHash && type
      ? await supabase.auth.verifyOtp({ token_hash: tokenHash, type })
      : null;
  const user = result?.data.user;
  // A confirmation link opened in a different browser from the one that signed up: Supabase
  // has already confirmed the email, but this browser can't finish the sign-in. Say so plainly.
  if (code && result?.error && /code.?verifier/i.test(`${result.error.name} ${result.error.message}`) && next !== "/login/new-password") {
    return NextResponse.redirect(new URL(`/login?confirmed=1&next=${encodeURIComponent(next)}`, origin));
  }
  if (!result || result.error || !user) {
    return NextResponse.redirect(new URL(`/login?error=link&next=${encodeURIComponent(next)}`, origin));
  }
  const { anonId } = await getViewer();
  await claimForViewer({ userId: user.id, email: user.email ?? null, anonId });
  return NextResponse.redirect(new URL(next, origin));
}
