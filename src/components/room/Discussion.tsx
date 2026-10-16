"use client";

import type { StoredTurn } from "@/core/review";
import { Avatar } from "../Avatar";
import { useRoom } from "./context";
import { PrincipleChips, TimeChip } from "./Evidence";

const STANCE: Record<StoredTurn["stance"], string> = {
  opens: "",
  agrees: "agrees with",
  disagrees: "pushes back on",
  builds: "builds on",
  closes: "",
};

/** The whole panel conversation as a readable transcript. */
export function Discussion({ turns }: { turns: StoredTurn[] }) {
  const { card } = useRoom();
  return (
    <ol className="space-y-5">
      {turns.map((t, i) => {
        const c = card(t.reviewerId);
        if (!c) return null;
        const other = t.respondsTo ? card(t.respondsTo) : null;
        return (
          <li key={i} className="flex gap-3.5">
            <Avatar card={c} size={46} />
            <div className="min-w-0 flex-1">
              <p className="text-sm">
                <span className="font-extrabold text-ink">{c.name}</span>
                {STANCE[t.stance] && other && (
                  <span className="font-semibold text-ink-soft">
                    {" "}
                    {STANCE[t.stance]} {other.name.split(" ")[0]}
                  </span>
                )}
              </p>
              <div className="cutout mt-1.5 rounded-tl-md px-4 py-3 text-[0.98rem] leading-relaxed text-ink">{t.text}</div>
              {(t.evidenceIds.length > 0 || t.principleIds.length > 0) && (
                <div className="mt-2">
                  {t.evidenceIds.length > 0 && <TimeChip ids={t.evidenceIds} />}
                  <PrincipleChips ids={t.principleIds} />
                </div>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
