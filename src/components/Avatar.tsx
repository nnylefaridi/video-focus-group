"use client";

import { motion, useReducedMotion } from "motion/react";
import { useEffect, useState } from "react";
import type { ExpertCard } from "@/core/expert";

export type AvatarState = "idle" | "speaking" | "thinking" | "agree" | "disagree";

const ART: Record<AvatarState, string[]> = {
  idle: ["neutral"],
  speaking: ["talk-a", "talk-b"],
  thinking: ["thinking"],
  agree: ["agree"],
  disagree: ["disagree"],
};

/**
 * A reviewer's character. Uses their illustrated art when it exists
 * (public/reviewers/<id>/*.png), otherwise a soft monogram in their color.
 */
export function Avatar({ card, state = "idle", size = 56, label = false }: { card: ExpertCard; state?: AvatarState; size?: number; label?: boolean }) {
  const reduce = useReducedMotion();
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    if (state !== "speaking" || reduce) return;
    const t = setInterval(() => setFrame((f) => f + 1), 180);
    return () => clearInterval(t);
  }, [state, reduce]);

  const poses = ART[state];
  const pose = poses[frame % poses.length];

  const body = card.hasArt ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={`/reviewers/${card.id}/${pose}.png`} alt="" className="h-full w-full object-cover" draggable={false} />
  ) : (
    <span className="font-serif font-medium text-ink" style={{ fontSize: size * 0.36 }}>
      {card.initials}
    </span>
  );

  return (
    <div className="flex flex-col items-center gap-1.5">
      <motion.div
        aria-hidden
        className="relative grid place-items-center overflow-hidden rounded-full"
        style={{ width: size, height: size, background: card.color }}
        animate={
          reduce
            ? {}
            : state === "speaking"
              ? { y: [0, -2, 0], scale: [1, 1.03, 1] }
              : state === "thinking"
                ? { rotate: [0, -3, 0, 3, 0] }
                : state === "agree"
                  ? { y: [0, 3, 0, 3, 0] }
                  : state === "disagree"
                    ? { rotate: [0, -4, 4, -4, 0] }
                    : { scale: [1, 1.015, 1] }
        }
        transition={{
          duration: state === "speaking" ? 0.5 : state === "idle" ? 4 : 1.6,
          repeat: state === "agree" || state === "disagree" ? 0 : Infinity,
          ease: "easeInOut",
        }}
      >
        {body}
        {state === "speaking" && !reduce && (
          <motion.span
            className="absolute inset-0 rounded-full border-2"
            style={{ borderColor: card.color }}
            initial={{ opacity: 0.6, scale: 1 }}
            animate={{ opacity: 0, scale: 1.25 }}
            transition={{ duration: 1.2, repeat: Infinity }}
          />
        )}
      </motion.div>
      {label && <span className="max-w-[7rem] truncate text-center text-xs text-ink-soft">{card.name}</span>}
      <span className="sr-only">{card.name}</span>
    </div>
  );
}
