"use client";

import { STAGE_LABELS, type ReviewStage } from "@/core/review";
import { Avatar } from "../Avatar";
import { useRoom } from "./context";

const ORDER: ReviewStage[] = ["queued", "ingesting", "transcribing", "sampling", "perceiving", "reviewing", "discussing", "synthesizing"];

/** Honest, stage-by-stage progress while the video is processed and reviewed. */
export function Progress() {
  const { view } = useRoom();
  const at = ORDER.indexOf(view.stage);
  return (
    <div className="mx-auto max-w-lg py-6">
      <div className="flex justify-center gap-4">
        {view.board.map((c) => {
          const done = Boolean(view.notes?.[c.id]);
          return (
            <div key={c.id} className="flex flex-col items-center gap-2">
              <Avatar card={c} size={64} state={view.stage === "reviewing" && !done ? "thinking" : "idle"} />
              <span className="text-xs text-ink-soft">{c.name.split(" ")[0]}</span>
              <span className="h-4 text-xs text-accent">{done ? "Notes in" : ""}</span>
            </div>
          );
        })}
      </div>
      <ol className="mt-8 space-y-2.5" aria-live="polite">
        {ORDER.slice(1).map((s, i) => {
          const idx = i + 1;
          const state = idx < at ? "done" : idx === at ? "now" : "later";
          return (
            <li key={s} className={`flex items-center gap-3 ${state === "later" ? "text-ink-faint" : "text-ink"}`}>
              <span
                className={`grid h-5 w-5 shrink-0 place-items-center rounded-full border ${
                  state === "done" ? "border-accent bg-accent" : state === "now" ? "border-accent" : "border-line-strong"
                }`}
              >
                {state === "done" && (
                  <svg viewBox="0 0 16 16" className="h-3 w-3 text-accent-ink" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <path d="m4 8.5 2.5 2.5L12 5.5" />
                  </svg>
                )}
                {state === "now" && <span className="h-2 w-2 animate-pulse rounded-full bg-accent" />}
              </span>
              <span>{STAGE_LABELS[s]}</span>
              {state === "now" && view.stageDetail && <span className="text-sm text-ink-soft">· {view.stageDetail}</span>}
            </li>
          );
        })}
      </ol>
      <p className="mt-8 text-center text-sm text-ink-soft">This usually takes a few minutes. You can leave this page and come back.</p>
    </div>
  );
}
