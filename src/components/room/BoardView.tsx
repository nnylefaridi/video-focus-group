"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { STAGE_LABELS, type ReviewStage } from "@/core/review";
import { Boardroom } from "../board/Boardroom";
import type { PuppetState } from "../puppets/Puppet";
import { Avatar } from "../Avatar";
import { Next, Pause, Play, Prev } from "../Icons";
import { useRoom } from "./context";
import { Player } from "./Player";
import { TimeChip } from "./Evidence";

const STEPS: ReviewStage[] = ["ingesting", "transcribing", "sampling", "perceiving", "reviewing", "discussing", "synthesizing"];
const TYPE_MS = 28;
const HOLD_MS = 1500;

/** Plays the panel discussion turn by turn: the speaker's puppet wags while their line types out under the video. */
function useDiscussion(count: number, lengths: number[], storeKey: string) {
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
    if (typed < lengths[idx]) {
      const t = setTimeout(() => setTyped((n) => Math.min(lengths[idx], n + 2)), TYPE_MS);
      return () => clearTimeout(t);
    }
    const t = setTimeout(() => {
      setIdx((i) => i + 1);
      setTyped(0);
      if (idx + 1 >= count) setPlaying(false);
    }, HOLD_MS);
    return () => clearTimeout(t);
  }, [playing, ended, typed, idx, lengths, count, storeKey]);

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
      setTyped(0);
    },
    next: () => {
      setIdx((i) => Math.min(count, i + 1));
      setTyped(0);
    },
  };
}

/** Video in the middle; for vertical video on wide screens the caption sits beside it so everything stays in view. */
function StageLayout({ video, caption }: { video: React.ReactNode; caption: React.ReactNode }) {
  const { view } = useRoom();
  const vertical = (view.video?.height ?? 9) > (view.video?.width ?? 16);
  if (!vertical) {
    return (
      <div className="mx-auto w-[94%] sm:w-[62%]">
        {video}
        <div className="mx-auto mt-4 max-w-2xl">{caption}</div>
      </div>
    );
  }
  return (
    <div className="mx-auto w-[94%] md:flex md:w-full md:items-end md:justify-center md:gap-6">
      <div className="hidden md:block md:flex-[0.35]" />
      <div className="md:w-auto md:shrink-0">{video}</div>
      <div className="mt-4 md:mt-0 md:mb-1 md:max-w-[460px] md:min-w-[300px] md:flex-[1.65] md:text-[0.94rem]">{caption}</div>
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

  return ready ? (
    <ReadyBoard seekRequest={seekRequest} onTime={onTime} onPick={onPick} onOpenPlan={onOpenPlan} />
  ) : (
    <Boardroom
      board={view.board}
      states={Object.fromEntries(
        view.board.map((c) => [c.id, view.stage === "failed" || view.notes?.[c.id] ? "idle" : "thinking"] as [string, PuppetState]),
      )}
    >
      <StageLayout
        video={<Player variant="stage" seekRequest={seekRequest} onTime={onTime} />}
        caption={
        <div className="cutout px-5 py-4 text-center" aria-live="polite">
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
              <p className="mt-3 text-xs text-ink-soft">This usually takes a few minutes. You can leave and come back.</p>
            </>
          )}
        </div>
        }
      />
    </Boardroom>
  );
}

function ReadyBoard({
  seekRequest,
  onTime,
  onPick,
  onOpenPlan,
}: {
  seekRequest: { t: number; n: number } | null;
  onTime: (t: number) => void;
  onPick: (id: string) => void;
  onOpenPlan: () => void;
}) {
  const { view, card } = useRoom();
  const turns = view.discussion!;
  const lengths = useMemo(() => turns.map((t) => t.text.length), [turns]);
  const d = useDiscussion(turns.length, lengths, `panel.played.${view.id}`);
  const turn = d.ended ? null : turns[d.idx];
  const speaker = turn ? card(turn.reviewerId) : null;
  const other = turn?.respondsTo ? card(turn.respondsTo) : null;

  const states = Object.fromEntries(
    view.board.map((c) => [c.id, d.playing && turn?.reviewerId === c.id && d.typed < turn.text.length ? "speaking" : "idle"] as [string, PuppetState]),
  );

  return (
    <Boardroom board={view.board} states={states} onPick={onPick}>
      <StageLayout
        video={<Player variant="stage" seekRequest={seekRequest} onTime={onTime} />}
        caption={
        <div className="cutout px-4 py-3.5 sm:px-5">
          {turn && speaker ? (
            <div className="flex gap-3">
              <Avatar card={speaker} size={40} />
              <div className="min-w-0 flex-1">
                <p className="text-sm">
                  <span className="font-extrabold text-ink">{speaker.name}</span>
                  {other && turn.stance !== "opens" && turn.stance !== "closes" && (
                    <span className="font-semibold text-ink-soft">
                      {" "}
                      {turn.stance === "agrees" ? "agrees with" : turn.stance === "disagrees" ? "pushes back on" : "builds on"} {other.name.split(" ")[0]}
                    </span>
                  )}
                </p>
                <p className="mt-1 min-h-[3em] leading-relaxed text-ink">
                  {d.playing ? turn.text.slice(0, d.typed) : turn.text}
                </p>
                {turn.evidenceIds.length > 0 && (!d.playing || d.typed >= turn.text.length) && <TimeChip ids={turn.evidenceIds} className="mt-1.5" />}
              </div>
            </div>
          ) : (
            <div className="py-1 text-center">
              <p className="font-bold text-ink">That&apos;s the panel&apos;s take.</p>
              <button onClick={onOpenPlan} className="mt-2 rounded-full bg-accent px-5 py-2 text-sm font-bold text-accent-ink">
                See your revision plan
              </button>
            </div>
          )}

          <div className="mt-3 flex items-center justify-center gap-2 border-t border-line pt-3">
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
    </Boardroom>
  );
}
