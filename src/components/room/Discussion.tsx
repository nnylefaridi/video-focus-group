"use client";

import { motion, useReducedMotion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import type { StoredTurn } from "@/core/review";
import { Avatar } from "../Avatar";
import { useRoom } from "./context";
import { PrincipleChips, TimeChip } from "./Evidence";

const STANCE: Record<StoredTurn["stance"], string> = {
  opens: "",
  agrees: "agrees with",
  disagrees: "disagrees with",
  builds: "builds on",
  closes: "",
};

const CHARS_PER_SEC = 90;

/** The panel talking it through. Plays turn by turn the first time; skippable; remembered. */
export function Discussion({ turns }: { turns: StoredTurn[] }) {
  const { view, card, setSpeaking } = useRoom();
  const reduce = useReducedMotion();
  const storeKey = `panel.played.${view.id}`;
  const [shownState, setShown] = useState<number>(() => {
    try {
      return localStorage.getItem(storeKey) ? turns.length : 0;
    } catch {
      return turns.length;
    }
  });
  const [typed, setTyped] = useState(0);
  const endRef = useRef<HTMLDivElement>(null);
  const shown = reduce ? turns.length : shownState;
  const playing = shown < turns.length;

  useEffect(() => {
    if (!playing) {
      setSpeaking(null);
      try {
        localStorage.setItem(storeKey, "1");
      } catch {}
      return;
    }
    const turn = turns[shown];
    setSpeaking(turn.reviewerId);
    if (typed < turn.text.length) {
      const t = setTimeout(() => setTyped((n) => Math.min(turn.text.length, n + 3)), 3000 / CHARS_PER_SEC);
      return () => clearTimeout(t);
    }
    const t = setTimeout(() => {
      setShown((s) => s + 1);
      setTyped(0);
    }, 650);
    return () => clearTimeout(t);
  }, [playing, shown, typed, turns, setSpeaking, storeKey]);

  useEffect(() => {
    if (playing) endRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [shown, playing]);

  const visible = turns.slice(0, Math.min(turns.length, shown + (playing ? 1 : 0)));

  return (
    <div>
      {playing && (
        <div className="mb-4 flex justify-end">
          <button onClick={() => setShown(turns.length)} className="rounded-full px-3 py-1 text-sm text-ink-soft underline decoration-line-strong underline-offset-4 hover:text-ink">
            Show the whole conversation
          </button>
        </div>
      )}
      <ol className="space-y-5">
        {visible.map((t, i) => {
          const c = card(t.reviewerId);
          if (!c) return null;
          const live = playing && i === shown;
          const other = t.respondsTo ? card(t.respondsTo) : null;
          return (
            <motion.li key={i} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="flex gap-3.5">
              <Avatar card={c} size={44} state={live ? "speaking" : t.stance === "agrees" ? "idle" : "idle"} />
              <div className="min-w-0 flex-1">
                <p className="text-sm">
                  <span className="font-medium text-ink">{c.name}</span>
                  {STANCE[t.stance] && other && (
                    <span className="text-ink-soft">
                      {" "}
                      {STANCE[t.stance]} {other.name.split(" ")[0]}
                    </span>
                  )}
                </p>
                <div className="mt-1.5 rounded-2xl rounded-tl-md px-4 py-3 text-[0.98rem] leading-relaxed text-ink" style={{ background: `${c.color}38` }}>
                  {live ? t.text.slice(0, typed) : t.text}
                  {live && <span className="ml-0.5 inline-block h-4 w-0.5 translate-y-0.5 animate-pulse bg-ink-soft" />}
                </div>
                {!live && (t.evidenceIds.length > 0 || t.principleIds.length > 0) && (
                  <div className="mt-2">
                    {t.evidenceIds.length > 0 && <TimeChip ids={t.evidenceIds} />}
                    <PrincipleChips ids={t.principleIds} />
                  </div>
                )}
              </div>
            </motion.li>
          );
        })}
      </ol>
      <div ref={endRef} />
    </div>
  );
}
