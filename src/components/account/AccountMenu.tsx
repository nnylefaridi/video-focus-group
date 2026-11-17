"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { avatarLetter } from "@/core/account-label";
import { supabaseBrowser } from "@/lib/supabase-browser";

/**
 * Hosted mode, signed in: the person's name and a round letter avatar at the top
 * right. Opens a small menu with Log out, which signs them out through Supabase
 * and returns them to the first screen.
 */
export function AccountMenu({ name }: { name: string }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const router = useRouter();
  const menuId = useId();
  const letter = avatarLetter(name);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: MouseEvent | PointerEvent) => {
      if (!wrap.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
        button.current?.focus();
      }
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const logOut = async () => {
    setBusy(true);
    await supabaseBrowser().auth.signOut();
    setOpen(false);
    router.replace("/");
    router.refresh();
  };

  return (
    <div
      ref={wrap}
      className="absolute top-4 right-4 z-10 sm:right-8"
      onBlur={(event) => {
        if (!wrap.current?.contains(event.relatedTarget as Node)) setOpen(false);
      }}
    >
      <button
        ref={button}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((value) => !value)}
        className="flex max-w-[min(100vw-2rem,16rem)] items-center gap-2 rounded-full py-1 pr-2.5 pl-1 text-sm font-bold text-ink transition-colors hover:bg-paper-deep"
      >
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-ink text-sm font-extrabold text-paper" aria-hidden>
          {letter}
        </span>
        <span className="min-w-0 truncate">{name}</span>
      </button>
      {open && (
        <div id={menuId} role="menu" aria-label="Account" className="cutout absolute right-0 z-20 mt-2 min-w-[11rem] py-1">
          <button
            type="button"
            role="menuitem"
            disabled={busy}
            onClick={logOut}
            className="block w-full px-4 py-2 text-left text-sm font-semibold text-ink hover:bg-paper-deep disabled:opacity-50"
          >
            Log out
          </button>
        </div>
      )}
    </div>
  );
}
