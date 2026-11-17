import { displayNameFor } from "@/core/account-label";
import { authReady, supabaseServer, type Viewer } from "@/server/auth";

/** The signed-in account's display name, or null when signed out. */
export async function accountChip(viewer: Viewer): Promise<{ name: string } | null> {
  if (!viewer.userId) return null;
  let metadata: Record<string, unknown> | undefined;
  if (authReady) {
    try {
      const { data } = await (await supabaseServer()).auth.getUser();
      const raw = data.user?.user_metadata;
      if (raw && typeof raw === "object") metadata = raw as Record<string, unknown>;
    } catch {
      /* The email on the viewer is enough for a label. */
    }
  }
  return { name: displayNameFor({ email: viewer.email, user_metadata: metadata }) };
}
