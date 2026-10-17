import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { authReady, SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from "@/lib/supabase";

/** Keeps the Supabase sign-in fresh: refreshes an expiring session and writes the new cookies. */
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });
  if (!authReady) return response;
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
  matcher: ["/((?!_next/static|_next/image|api/media|api/reviews/.*/video|favicon.ico|.*\\.(?:png|jpg|jpeg|svg|webp)$).*)"],
};
