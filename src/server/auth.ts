import crypto from "node:crypto";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { authReady, SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from "@/lib/supabase";
import { canAccess, claimAnonymous, getReview, type ReviewRecord } from "./reviews";
import { enqueue } from "./jobs";

export async function supabaseServer() {
  const store = await cookies();
  return createServerClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list) => {
        try {
          list.forEach(({ name, value, options }) => store.set(name, value, options));
        } catch {
          /* Server Components can't set cookies; the proxy refreshes the session instead. */
        }
      },
    },
  });
}

/** Identifies this browser's signed-out reviews, so they can move into an account at sign-in. */
const ANON_COOKIE = "panel_anon";
const ANON_RE = /^[A-Za-z0-9_-]{32}$/;

export type Viewer = { userId: string | null; email: string | null; anonId: string | null };

export async function getViewer(): Promise<Viewer> {
  const store = await cookies();
  const raw = store.get(ANON_COOKIE)?.value;
  const anonId = raw && ANON_RE.test(raw) ? raw : null;
  if (!authReady) return { userId: null, email: null, anonId };
  const { data } = await (await supabaseServer()).auth.getClaims();
  const claims = data?.claims;
  return { userId: claims?.sub ?? null, email: typeof claims?.email === "string" ? claims.email : null, anonId };
}

/** Route handlers only: the browser's anonymous id, created on first use. */
export async function ensureAnonId(viewer: Viewer): Promise<string> {
  if (viewer.anonId) return viewer.anonId;
  const id = crypto.randomBytes(24).toString("base64url");
  (await cookies()).set(ANON_COOKIE, id, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 60 * 60 * 24 * 365 });
  return id;
}

/** Moves this browser's signed-out reviews into the account, and copies finished ones' media to storage. */
export async function claimForViewer(viewer: Viewer) {
  if (!viewer.userId || !viewer.anonId) return;
  const claimed = await claimAnonymous(viewer.userId, viewer.anonId);
  for (const r of claimed) if (r.stage === "done") await enqueue(r.id, "store");
}

/** The review, if this viewer may see it: their account's, or this browser's from before sign-in. */
export async function accessibleReview(id: string): Promise<{ review: ReviewRecord; viewer: Viewer } | null> {
  if (!/^[A-Za-z0-9_-]{16}$/.test(id)) return null;
  const [review, viewer] = await Promise.all([getReview(id), getViewer()]);
  if (!review || !canAccess(review, viewer)) return null;
  if (!review.userId && viewer.userId) {
    // Signed in since making it: it joins the account now.
    await claimForViewer(viewer);
    return { review: { ...review, userId: viewer.userId }, viewer };
  }
  return { review, viewer };
}
