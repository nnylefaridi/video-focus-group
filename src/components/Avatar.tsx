"use client";

import type { ExpertCard } from "@/core/expert";
import { Figure } from "./puppets/Figure";
import { lookFor } from "./puppets/looks";

export type AvatarState = "idle" | "speaking" | "thinking" | "agree" | "disagree";

/** A small paper-cutout head of a reviewer. Wags like its puppet when speaking. */
export function Avatar({ card, state = "idle", size = 56, label = false }: { card: ExpertCard; state?: AvatarState; size?: number; label?: boolean }) {
  const look = lookFor(card.id);
  const anim = state === "speaking" ? "speaking" : state === "thinking" ? "thinking" : "idle";
  return (
    <div className="flex flex-col items-center gap-1">
      <div className="puppet" data-state={anim} data-style={look.wag} style={{ width: size, filter: "drop-shadow(0 2px 2px rgb(40 52 70 / 0.18))" }}>
        <Figure look={look} crop="head" className="block h-auto w-full" />
      </div>
      {label && <span className="max-w-[7rem] truncate text-center text-xs font-semibold text-ink-soft">{card.name}</span>}
      <span className="sr-only">{card.name}</span>
    </div>
  );
}
