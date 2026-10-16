"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { STAGE_LABELS, type ReviewStage } from "@/core/review";
import { Boardroom } from "../board/Boardroom";
import type { PuppetState } from "../puppets/Puppet";
import { Avatar } from "../Avatar";
import { Next, Pause, Play, Prev } from "../Icons";
import { useRoom } from "./context";
import { Player } from "./Player";
import { TimeChip } from "./Evidence";

const STEPS: ReviewStage[] = ["ingesting", "transcribing", "sampling", "perceiving", "reviewing", "discussing", "synthesizing"];

/* Pacing: lines type out at a gentle 40 characters a second, then stay up long enough
   to read comfortably (about 230 words a minute) before the next person speaks. */
const CHARS_PER_TICK = 2;
const TICK_MS = 50;
const MS_PER_WORD = 260;
const MIN_HOLD_MS = 2500;

function holdFor(text: string): number {
  const words = text.trim().split(/\s+/).length;
  const typing = (text.length / CHARS_PER_TICK) * TICK_MS;
  return Math.max(MIN_HOLD_MS, words * MS_PER_WORD - typing);
}

/** Plays the panel discussion turn by turn: the speaker's puppet wags while their line types out. */
function useDiscussion(texts: string[], storeKey: string) {
  const count = texts.length;
  const [idx, setIdx] = useState(0);
  const [typed, setTyped] = useState(0);
  // Start on its own the first time this review is opened; after that, wait for Play.
  const [playing, setPlaying] = useState(() => {
    try {
      return !localStorage.getItem(storeKey);
    } catch {
      return false;
    }
  });
  const ended = idx >= count;

  useEffect(() => {
    if (!playing || ended) return;
    try {
      localStorage.setItem(storeKey, "1");
    } catch {}
    const text = texts[idx];
    if (typed < text.length) {
      const t = setTimeout(() => setTyped((n) => Math.min(text.length, n + CHARS_PER_TICK)), TICK_MS);
      return () => clearTimeout(t);
    }
    const t = setTimeout(() => {
      setIdx((i) => i + 1);
      setTyped(0);
      if (idx + 1 >= count) setPlaying(false);
    }, holdFor(text));
    return () => clearTimeout(t);
  }, [playing, ended, typed, idx, texts, count, storeKey]);

  return {
    idx,
    typed,
    playing,
    ended,
    play: () => {
      if (ended) {
        setIdx(0);
        setTyped(0);
      }
      setPlaying(true);
    },
    pause: () => setPlaying(false),
    prev: () => {
      setIdx((i) => Math.max(0, Math.min(i, count) - 1));
      setTyped(Number.MAX_SAFE_INTEGER);
    },
    next: () => {
      setIdx((i) => Math.min(count, i + 1));
      setTyped(0);
    },
  };
}

/**
 * The board screen: the puppet theatre on top, and below it a designated row with
 * the video on one side and the discussion on the other. On laptops it fits the
 * window exactly, so nothing scrolls.
 */
function BoardLayout({ states, onPick, video, panel }: { states: Record<string, PuppetState>; onPick?: (id: string) => void; video: React.ReactNode; panel: React.ReactNode }) {
  const { view } = useRoom();
  return (
    <div className="flex flex-col lg:h-full">
      <div className="lg:min-h-0 lg:flex-[1.05]">
        <Boardroom board={view.board} states={states} onPick={onPick} fitHeight />
      </div>
      <div className="relative z-[5] mt-3 grid gap-4 lg:-mt-[3dvh] lg:min-h-0 lg:flex-1 lg:grid-cols-[auto_minmax(0,1fr)] lg:grid-rows-[minmax(0,1fr)] lg:pb-2">
        <div className="lg:h-full">{video}</div>
        <div className="min-h-0 lg:h-full">{panel}</div>
      </div>
    </div>
  );
}

export function BoardView({
  seekRequest,
  onTime,
  onPick,
  onRetry,
  onOpenPlan,
}: {
  seekRequest: { t: number; n: number } | null;
  onTime: (t: number) => void;
  onPick: (id: string) => void;
  onRetry: () => void;
  onOpenPlan: () => void;
}) {
  const { view } = useRoom();
  const ready = view.stage === "done" && Boolean(view.discussion?.length);
  const video = <Player variant="stage" seekRequest={seekRequest} onTime={onTime} fill />;

  if (ready) return <ReadyBoard video={video} onPick={onPick} onOpenPlan={onOpenPlan} />;

  return (
    <BoardLayout
      states={Object.fromEntries(view.board.map((c) => [c.id, view.stage === "failed" || view.notes?.[c.id] ? "idle" : "thinking"] as [string, PuppetState]))}
      video={video}
      panel={
        <div className="cutout flex h-full flex-col items-center justify-center px-6 py-6 text-center" aria-live="polite">
          {view.stage === "failed" ? (
            <>
              <p className="font-bold text-warn">The review stopped partway.</p>
              <p className="mt-1 text-sm text-warn">{view.error}</p>
              <button onClick={onRetry} className="mt-3 rounded-full bg-accent px-5 py-2 text-sm font-bold text-accent-ink">
                Try again
              </button>
            </>
          ) : view.stage === "uploading" ? (
            <>
              <p className="text-ink">This upload didn&apos;t finish, so there&apos;s nothing to review.</p>
              <Link href="/" className="mt-3 inline-block rounded-full bg-accent px-5 py-2 text-sm font-bold text-accent-ink">
                Start again
              </Link>
            </>
          ) : (
            <>
              <p className="font-bold text-ink">
                {STAGE_LABELS[view.stage]}
                {view.stageDetail ? <span className="font-semibold text-ink-soft"> · {view.stageDetail}</span> : null}
              </p>
              <div className="mt-3 flex justify-center gap-1.5" aria-hidden>
                {STEPS.map((s, i) => (
                  <span
                    key={s}
                    className={`h-1.5 w-6 rounded-full ${i < STEPS.indexOf(view.stage) ? "bg-accent" : i === STEPS.indexOf(view.stage) ? "animate-pulse bg-accent/60" : "bg-line"}`}
                  />
                ))}
              </div>
              <p className="mt-3 text-xs text-ink-soft">The panel is watching. This usually takes a few minutes, and you can leave and come back.</p>
            </>
          )}
        </div>
      }
    />
  );
}

function ReadyBoard({ video, onPick, onOpenPlan }: { video: React.ReactNode; onPick: (id: string) => void; onOpenPlan: () => void }) {
  const { view, card } = useRoom();
  const turns = view.discussion!;
  const texts = useMemo(() => turns.map((t) => t.text), [turns]);
  const d = useDiscussion(texts, `panel.played.${view.id}`);
  const current = d.ended ? null : turns[d.idx];
  const listRef = useRef<HTMLOListElement>(null);

  const states = Object.fromEntries(
    view.board.map((c) => [c.id, d.playing && current?.reviewerId === c.id && d.typed < current.text.length ? "speaking" : "idle"] as [string, PuppetState]),
  );

  // Keep the line being spoken in view inside the panel (the page itself never scrolls).
  useEffect(() => {
    const list = listRef.current;
    const el = list?.querySelector<HTMLElement>(`[data-turn="${d.idx}"]`);
    if (list && el) list.scrollTo({ top: el.offsetTop - list.offsetTop - 8, behavior: "smooth" });
  }, [d.idx, d.typed]);

  const shown = turns.slice(0, Math.min(turns.length, d.idx + 1));

  return (
    <BoardLayout
      states={states}
      onPick={onPick}
      video={video}
      panel={
        <div className="cutout flex h-full max-h-[70vh] flex-col overflow-hidden lg:max-h-none">
          <ol ref={listRef} className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 pt-4 pb-2 sm:px-5" aria-live="polite">
            {shown.map((t, i) => {
              const c = card(t.reviewerId);
              if (!c) return null;
              const other = t.respondsTo ? card(t.respondsTo) : null;
              const live = i === d.idx && !d.ended;
              const text = live && d.playing ? t.text.slice(0, d.typed) : t.text;
              return (
                <li key={i} data-turn={i} className={`flex gap-3 transition-opacity ${live ? "opacity-100" : "opacity-60"}`}>
                  <Avatar card={c} size={38} state={live && d.playing && d.typed < t.text.length ? "speaking" : "idle"} />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm">
                      <span className="font-extrabold text-ink">{c.name}</span>
                      {other && t.stance !== "opens" && t.stance !== "closes" && (
                        <span className="font-semibold text-ink-soft">
                          {" "}
                          {t.stance === "agrees" ? "agrees with" : t.stance === "disagrees" ? "pushes back on" : "builds on"} {other.name.split(" ")[0]}
                        </span>
                      )}
                    </p>
                    <p className="mt-0.5 leading-relaxed text-ink">{text}</p>
                    {t.evidenceIds.length > 0 && (!live || !d.playing || d.typed >= t.text.length) && <TimeChip ids={t.evidenceIds} className="mt-1" />}
                  </div>
                </li>
              );
            })}
            {d.ended && (
              <li className="py-2 text-center">
                <p className="font-bold text-ink">That&apos;s the panel&apos;s take.</p>
                <button onClick={onOpenPlan} className="mt-2 rounded-full bg-accent px-5 py-2 text-sm font-bold text-accent-ink">
                  See your revision plan
                </button>
              </li>
            )}
          </ol>

          <div className="flex items-center justify-center gap-2 border-t border-line px-4 py-2.5">
            <button onClick={d.prev} disabled={d.idx === 0} aria-label="Previous point" className="grid h-9 w-9 place-items-center rounded-full text-ink-soft hover:bg-paper-deep hover:text-ink disabled:opacity-30">
              <Prev className="h-4 w-4" />
            </button>
            <button
              onClick={d.playing ? d.pause : d.play}
              aria-label={d.playing ? "Pause the discussion" : d.ended ? "Play the discussion again" : "Play the discussion"}
              className="grid h-10 w-10 place-items-center rounded-full bg-accent text-accent-ink"
            >
              {d.playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
            </button>
            <button onClick={d.next} disabled={d.ended} aria-label="Next point" className="grid h-9 w-9 place-items-center rounded-full text-ink-soft hover:bg-paper-deep hover:text-ink disabled:opacity-30">
              <Next className="h-4 w-4" />
            </button>
            <span className="ml-2 text-xs font-semibold text-ink-faint tabular-nums">
              {Math.min(d.idx + 1, turns.length)} / {turns.length}
            </span>
          </div>
        </div>
      }
    />
  );
}
