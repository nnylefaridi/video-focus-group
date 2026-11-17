"use client";

import Link from "next/link";
import type { ExpertCard } from "@/core/expert";
import { Avatar } from "../Avatar";
import { ArrowLeft } from "../Icons";

/** Hosted mode, signed out: in place of the upload step. Logging in brings them back here with everything kept. */
export function SignInStep({ board, onBack, onLeave }: { board: ExpertCard[]; onBack: () => void; onLeave: () => void }) {
  return (
    <div className="mx-auto w-full max-w-xl">
      <button onClick={onBack} className="-ml-2 mb-8 inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-sm text-ink-soft transition-colors hover:text-ink">
        <ArrowLeft className="h-4 w-4" /> Back
      </button>
      <h1 className="font-display text-[2rem] leading-tight font-extrabold text-ink sm:text-[2.6rem]">Log in to send it to your board</h1>
      <p className="mt-3 font-semibold text-ink-soft">
        Your answers and your board are saved. Log in or sign up, and you&apos;ll come straight back here to upload your video.
      </p>
      <Link
        href="/login?next=/"
        onClick={onLeave}
        className="mt-8 inline-block rounded-full bg-accent px-6 py-3 font-bold text-accent-ink transition-all hover:brightness-110"
      >
        Log in or sign up
      </Link>

      {board.length > 0 && (
        <div className="mt-10 flex items-center gap-3">
          <div className="flex -space-x-2">
            {board.map((c) => (
              <Avatar key={c.id} card={c} size={36} />
            ))}
          </div>
          <p className="text-sm text-ink-soft">{board.map((b) => b.name).join(", ")} will watch it.</p>
        </div>
      )}
    </div>
  );
}
