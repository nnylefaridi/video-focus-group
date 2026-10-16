"use client";

import type { Synthesis } from "@/core/review";
import { Avatar } from "../Avatar";
import { useRoom } from "./context";
import { PrincipleChips, TimeChip } from "./Evidence";

function Faces({ ids }: { ids: string[] }) {
  const { card } = useRoom();
  return (
    <div className="flex -space-x-2">
      {ids.map((id) => {
        const c = card(id);
        return c ? <Avatar key={id} card={c} size={30} /> : null;
      })}
    </div>
  );
}

export function Compare({ s }: { s: Synthesis }) {
  const { card } = useRoom();
  return (
    <div className="space-y-10">
      <section>
        <h2 className="font-display font-extrabold text-2xl text-ink">Where they agree</h2>
        {s.consensus.length === 0 ? (
          <p className="mt-3 text-ink-soft">No point came up independently from two or more reviewers.</p>
        ) : (
          <ul className="mt-4 space-y-3">
            {s.consensus.map((c, i) => (
              <li key={i} className="flex gap-4 cutout p-4">
                <Faces ids={c.reviewerIds} />
                <div className="min-w-0 flex-1">
                  <p className="text-ink">{c.point}</p>
                  {c.evidenceIds.length > 0 && <TimeChip ids={c.evidenceIds} className="mt-2" />}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="font-display font-extrabold text-2xl text-ink">Where they don&apos;t</h2>
        {s.disagreements.length === 0 ? (
          <p className="mt-3 text-ink-soft">No real disagreements on this one.</p>
        ) : (
          <ul className="mt-4 space-y-4">
            {s.disagreements.map((d, i) => (
              <li key={i} className="cutout p-4 sm:p-5">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-medium text-ink">{d.topic}</p>
                  {d.evidenceIds.length > 0 && <TimeChip ids={d.evidenceIds} />}
                </div>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  {d.positions.map((p) => {
                    const c = card(p.reviewerId);
                    if (!c) return null;
                    return (
                      <div key={p.reviewerId} className="rounded-xl p-3.5" style={{ background: `${c.color}33` }}>
                        <div className="flex items-center gap-2">
                          <Avatar card={c} size={26} />
                          <span className="text-sm font-medium text-ink">{c.name}</span>
                        </div>
                        <p className="mt-2 text-[0.95rem] text-ink">{p.position}</p>
                        <PrincipleChips ids={p.principleIds} />
                      </div>
                    );
                  })}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

    </div>
  );
}

export function Plan({ s }: { s: Synthesis }) {
  return (
    <div className="space-y-10">
      <section>
        <h2 className="font-display font-extrabold text-2xl text-ink">Change these first</h2>
        <p className="mt-1 text-sm text-ink-soft">Backed by clear evidence and either agreement or a well-documented principle.</p>
        <ol className="mt-4 space-y-3">
          {s.plan.high.map((h, i) => (
            <li key={i} id={`note-plan-high-${i}`} className="cutout flex scroll-mt-24 gap-4 p-4 sm:p-5">
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-accent font-display font-extrabold text-accent-ink">{i + 1}</span>
              <div className="min-w-0 flex-1">
                <p className="text-ink">{h.change}</p>
                <p className="mt-1 text-sm text-ink-soft">{h.why}</p>
                <div className="mt-2.5 flex flex-wrap items-center gap-3">
                  <TimeChip ids={h.evidenceIds} />
                  <Faces ids={h.reviewerIds} />
                </div>
              </div>
            </li>
          ))}
          {s.plan.high.length === 0 && <p className="text-ink-soft">Nothing rose to high priority.</p>}
        </ol>
      </section>

      <section>
        <h2 className="font-display font-extrabold text-2xl text-ink">Worth trying</h2>
        <p className="mt-1 text-sm text-ink-soft">Matters of taste or real disagreement. Try a version and see which feels right.</p>
        <ul className="mt-4 space-y-3">
          {s.plan.experiments.map((e, i) => (
            <li key={i} id={`note-plan-exp-${i}`} className="cutout scroll-mt-24 p-4 sm:p-5">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-ink">{e.idea}</p>
                {e.evidenceIds.length > 0 && <TimeChip ids={e.evidenceIds} />}
              </div>
              <ul className="mt-3 space-y-2">
                {e.options.map((o, j) => (
                  <li key={j} className="flex items-start gap-3 rounded-xl bg-paper px-3.5 py-2.5">
                    <Faces ids={o.reviewerIds} />
                    <p className="text-[0.95rem] text-ink">{o.option}</p>
                  </li>
                ))}
              </ul>
            </li>
          ))}
          {s.plan.experiments.length === 0 && <p className="text-ink-soft">No open experiments.</p>}
        </ul>
      </section>

      <section>
        <h2 className="font-display font-extrabold text-2xl text-ink">Keep these</h2>
        <ul className="mt-4 space-y-3">
          {s.plan.keep.map((k, i) => (
            <li key={i} id={`note-plan-keep-${i}`} className="flex scroll-mt-24 gap-4 rounded-2xl bg-accent-soft p-4">
              <div className="min-w-0 flex-1">
                <p className="text-ink">{k.what}</p>
                <div className="mt-2 flex flex-wrap items-center gap-3">
                  <TimeChip ids={k.evidenceIds} />
                  <Faces ids={k.reviewerIds} />
                </div>
              </div>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

/** What the panel could and couldn't see in this video. */
export function Coverage() {
  const { view } = useRoom();
  if (!view.ledger) return null;
  return (
    <section className="cutout p-5">
      <h2 className="font-display text-lg font-extrabold text-ink">What the panel could and couldn&apos;t see</h2>
      <ul className="mt-2 list-disc space-y-1.5 pl-5 text-sm text-ink-soft">
        <li>{view.ledger.coverage.sampling}</li>
        {view.ledger.coverage.notes.map((n, i) => (
          <li key={i}>{n}</li>
        ))}
      </ul>
    </section>
  );
}
