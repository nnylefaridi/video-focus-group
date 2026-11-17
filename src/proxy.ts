import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { authReady, SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from "@/lib/supabase";
import { canonicalLocation, parseMode, publicOriginOf } from "@/server/mode.mjs";

/**
 * Hosted mode has one public address (HOSTED_PUBLIC_URL). A page visit that reached the site at
 * any other (127.0.0.1 vs localhost, or the host's own *.onrender.com name) is sent there, because
 * sign-in cookies and Google sign-in's one-time verifier belong to a single host. Returns the
 * redirect, or null to carry on. next.config.ts sets skipProxyUrlNormalize so Next sends this
 * Location as written (otherwise it rewrites a 127.0.0.1 → localhost redirect into a loop).
 */
export function publicAddressRedirect(request: NextRequest): NextResponse | null {
  if (parseMode(process.env.PANEL_MODE) !== "hosted") return null;
  const origin = publicOriginOf(process.env.HOSTED_PUBLIC_URL);
  // A host's proxy may pass the address the visitor used in X-Forwarded-Host while it rewrites Host to an internal name.
  const host = request.headers.get("x-forwarded-host")?.split(",")[0].trim() || request.headers.get("host") || undefined;
  const { pathname, search } = request.nextUrl;
  const to = canonicalLocation(request.method, pathname + search, host, origin);
  if (!to) return null;
  return NextResponse.redirect(to, { status: 307, headers: { "Cache-Control": "no-store" } });
}

/** Keeps the Supabase sign-in fresh: refreshes an expiring session and writes the new cookies. */
export async function proxy(request: NextRequest) {
  const elsewhere = publicAddressRedirect(request);
  if (elsewhere) return elsewhere;
  let response = NextResponse.next({ request });
  if (!authReady) return response;
  // A sign-in that landed somewhere other than /auth/callback (Supabase falls back to the
  // Site URL when it doesn't recognise the return address): finish it at the callback.
  const { pathname, searchParams } = request.nextUrl;
  if (searchParams.has("code") && pathname !== "/auth/callback" && !pathname.startsWith("/api/")) {
    const to = request.nextUrl.clone();
    to.pathname = "/auth/callback";
    to.search = "";
    to.searchParams.set("code", searchParams.get("code")!);
    return NextResponse.redirect(to);
  }
  const supabase = createServerClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (list, headers) => {
        list.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        list.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        Object.entries(headers ?? {}).forEach(([k, v]) => response.headers.set(k, v));
      },
    },
  });
  await supabase.auth.getClaims();
  return response;
}

export const config = {
  // Skip static files, images and signed media (they don't need the session), and video
  // uploads: Next.js buffers any request body that passes through the proxy (10 MB max),
  // which would cut uploads short. The upload route checks who's uploading itself.
  // Stripe's webhook has no session and is checked by its signature over the untouched body.
  // The host's health check (api/health) needs no session either, and must answer at any address.
  // (API routes that do reach the proxy are never redirected: see canonicalLocation.)
  matcher: ["/((?!_next/static|_next/image|api/media|api/reviews/.*/video|api/stripe/webhook|api/health|favicon.ico|.*\\.(?:png|jpg|jpeg|svg|webp)$).*)"],
};
