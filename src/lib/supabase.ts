/** Public Supabase settings (safe in the browser: the publishable key can only sign people in). */
export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
export const SUPABASE_PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "";
/**
 * Accounts are on when Supabase is configured. Without it the app runs in local
 * mode: one person on their own computer, no sign-in, every review theirs.
 */
export const authReady = Boolean(SUPABASE_URL && SUPABASE_PUBLISHABLE_KEY);

/** Only same-site paths are allowed as a post-login destination. */
export function safeNext(next: string | null | undefined, fallback = "/reviews"): string {
  return next && next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/\\") ? next : fallback;
}
