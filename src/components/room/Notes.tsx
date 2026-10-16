"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { deriveSpan, type Ledger } from "@/core/evidence";
import { Avatar } from "../Avatar";
import { useRoom } from "./context";
import { BasisLabel, PrincipleChips, SeenEvidence, TimeChip } from "./Evidence";

const SENTIMENT = { working: "Working", problem: "Needs work", neutral: "Note" } as const;

/** Every reviewer's timestamped observations and recommendations, in video order. */
export function Notes() {
  const { view, card } = useRoom();
  const [who, setWho] = useState<string | null>(null);
  const notes = useMemo(() => view.notes ?? {}, [view.notes]);
  const ledger = view.ledger as unknown as Ledger;

  const items = useMemo(() => {
    const all = Object.entries(notes).flatMap(([rid, n]) => [
      ...n.observations.map((o) => ({ kind: "obs" as const, rid, o, t: deriveSpan(ledger, o.evidenceIds)?.start ?? 0 })),
    ]);
    return all.filter((x) => !who || x.rid === who).sort((a, b) => a.t - b.t);
  }, [notes, ledger, who]);

  const reviewers = view.board.filter((b) => notes[b.id]);

  return (
    <div>
      <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by reviewer">
        <button
          onClick={() => setWho(null)}
          aria-pressed={who === null}
          className={`rounded-full border px-3.5 py-1.5 text-sm transition-colors ${who === null ? "border-accent bg-accent-soft text-ink" : "border-line text-ink-soft hover:text-ink"}`}
        >
          Everyone
        </button>
        {reviewers.map((c) => (
          <button
            key={c.id}
            onClick={() => setWho(c.id)}
            aria-pressed={who === c.id}
            className={`rounded-full border px-3.5 py-1.5 text-sm transition-colors ${who === c.id ? "border-accent bg-accent-soft text-ink" : "border-line text-ink-soft hover:text-ink"}`}
          >
            {c.name}
          </button>
        ))}
      </div>

      {who && notes[who] && (
        <div className="mt-6 rounded-2xl border border-line bg-card p-5">
          <div className="flex items-center gap-3">
            <Avatar card={card(who)!} size={40} />
            <p className="font-serif text-lg text-ink">{card(who)!.name}&apos;s take</p>
            <Link href={`/reviewers/${who}`} className="ml-auto text-sm text-ink-soft underline decoration-line-strong underline-offset-4 hover:text-ink">
              Their published ideas
            </Link>
          </div>
          {notes[who].overall && <p className="mt-3 leading-relaxed text-ink">{notes[who].overall}</p>}
          {notes[who].recommendations.length > 0 && (
            <>
              <h3 className="mt-5 text-sm font-medium text-ink-soft">What they&apos;d change</h3>
              <ul className="mt-2 space-y-3">
                {notes[who].recommendations.map((r) => (
                  <li key={r.id} className="rounded-xl bg-paper px-4 py-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <TimeChip ids={r.evidenceIds} />
                      <span className="text-xs text-ink-soft">
                        {r.priority === "high" ? "High priority" : r.priority === "medium" ? "Medium priority" : "Smaller"}
                        {r.confidence === "tentative" ? " · tentative" : ""}
                      </span>
                    </div>
                    <p className="mt-1.5 text-ink">{r.change}</p>
                    <p className="mt-1 text-sm text-ink-soft">{r.why}</p>
                    <PrincipleChips ids={r.principleIds} />
                  </li>
                ))}
              </ul>
            </>
          )}
          {notes[who].couldNotAssess.length > 0 && (
            <>
              <h3 className="mt-5 text-sm font-medium text-ink-soft">What they couldn&apos;t judge from the evidence</h3>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-ink-soft">
                {notes[who].couldNotAssess.map((c, i) => (
                  <li key={i}>{c}</li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}

      <ol className="mt-6 space-y-4">
        {items.map(({ rid, o }) => {
          const c = card(rid);
          if (!c) return null;
          return (
            <li key={`${rid}-${o.id}`} className="rounded-2xl border border-line bg-card p-4 sm:p-5">
              <div className="flex flex-wrap items-center gap-2.5">
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: c.color }} aria-hidden />
                <span className="text-sm font-medium text-ink">{c.name}</span>
                <TimeChip ids={o.evidenceIds} />
                <span
                  className={`rounded-full px-2 py-0.5 text-xs ${
                    o.sentiment === "problem" ? "bg-warn-soft text-warn" : o.sentiment === "working" ? "bg-accent-soft text-accent" : "bg-paper-deep text-ink-soft"
                  }`}
                >
                  {SENTIMENT[o.sentiment]}
                </span>
              </div>
              <p className="mt-2.5 leading-relaxed text-ink">{o.claim}</p>
              <div className="mt-1">
                <BasisLabel basis={o.basis} />
              </div>
              <PrincipleChips ids={o.principleIds} />
              <details className="group mt-2">
                <summary className="cursor-pointer list-none text-sm text-ink-soft hover:text-ink">
                  <span className="group-open:hidden">What they saw</span>
                  <span className="hidden group-open:inline">Hide</span>
                </summary>
                <SeenEvidence ids={o.evidenceIds} />
              </details>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
