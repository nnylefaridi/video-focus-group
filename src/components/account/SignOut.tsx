"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { supabaseBrowser } from "@/lib/supabase-browser";

export function SignOut() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <button
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        await supabaseBrowser().auth.signOut();
        router.refresh();
      }}
      className="font-semibold underline decoration-line-strong underline-offset-4 hover:text-ink disabled:opacity-50"
    >
      Log out
    </button>
  );
}
