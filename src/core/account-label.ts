/** The name and avatar letter shown for a signed-in account. */
export type AccountLabelInput = {
  email?: string | null;
  user_metadata?: Record<string, unknown> | null;
};

/**
 * Prefer Supabase user metadata `full_name`, then `name`. If neither is set,
 * use the part of the email before the @. Never invent a name.
 */
export function displayNameFor(user: AccountLabelInput): string {
  const meta = user.user_metadata;
  if (meta && typeof meta === "object") {
    for (const key of ["full_name", "name"] as const) {
      const value = meta[key];
      if (typeof value === "string" && value.trim()) return value.trim();
    }
  }
  const email = typeof user.email === "string" ? user.email.trim() : "";
  const local = email.split("@")[0]?.trim();
  return local || "Account";
}

/** First letter of the display name, for the round avatar. */
export function avatarLetter(name: string): string {
  const ch = [...name.trim()][0];
  return ch ? ch.toUpperCase() : "A";
}
