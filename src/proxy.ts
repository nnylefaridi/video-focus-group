import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { authReady, SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from "@/lib/supabase";
import { publicOriginOf } from "@/server/mode.mjs";

/**
 * Hosted mode: the site's one public address. Sign-in cookies (and the Google sign-in's
 * one-time verifier) belong to a single host, so a page opened at another address for the
 * same server (127.0.0.1 vs localhost, or the host's *.fly.dev name) looks signed out and
 * can't finish a Google sign-in. Page visits there are sent to the public address instead.
 */
function canonicalRedirect(request: NextRequest): NextResponse | null {
  if (process.env.PANEL_MODE?.trim() !== "hosted") return null;
  if (request.method !== "GET" && request.method !== "HEAD") return null;
  const { pathname } = request.nextUrl;
  if (pathname.startsWith("/api/") || pathname.startsWith("/_next/")) return null;
  const origin = publicOriginOf(process.env.HOSTED_PUBLIC_URL);
  const host = request.headers.get("host");
  if (!origin || !host || host === new URL(origin).host) return null;
  return NextResponse.redirect(new URL(pathname + request.nextUrl.search, origin));
}

/** Keeps the Supabase sign-in fresh: refreshes an expiring session and writes the new cookies. */
export async function proxy(request: NextRequest) {
  const elsewhere = canonicalRedirect(request);
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
  // The host's health check (api/health) needs no session either.
  matcher: ["/((?!_next/static|_next/image|api/media|api/reviews/.*/video|api/stripe/webhook|api/health|favicon.ico|.*\\.(?:png|jpg|jpeg|svg|webp)$).*)"],
};
