"use client";

import Link from "next/link";
import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import type { BoardPick } from "@/core/board";
import type { ExpertCard } from "@/core/expert";
import { QUESTION_BY_ID } from "@/core/questionnaire/graph";
import { resolve, inferredQuestions, type Answer } from "@/core/questionnaire/engine";
import { Avatar } from "../Avatar";
import { Boardroom } from "../board/Boardroom";
import { Close, Pencil, Plus } from "../Icons";

type Props = {
  answers: Answer[];
  picks: BoardPick[];
  roster: ExpertCard[];
  board: string[];
  onChangeBoard: (ids: string[]) => void;
  onEdit: (questionId: string) => void;
  onContinue: () => void;
};

const MAX = 4;

export function BoardStep({ answers, picks, roster, board, onChangeBoard, onEdit, onContinue }: Props) {
  const [showAnswers, setShowAnswers] = useState(false);
  const chosen = board.map((id) => roster.find((c) => c.id === id)).filter((c): c is ExpertCard => Boolean(c));
  const others = roster.filter((c) => !board.includes(c.id));
  const reasons = new Map(picks.map((p) => [p.id, p.reasons]));
  const { active } = resolve(answers);
  const inferred = inferredQuestions(answers);

  return (
    <div className="mx-auto w-full max-w-2xl">
      <h1 className="font-display text-[2rem] leading-tight font-extrabold text-ink sm:text-[2.6rem]">Here&apos;s who&apos;ll review it</h1>
      <p className="mt-3 max-w-lg font-semibold text-ink-soft">
        Picked for what you told us. Each one is an AI interpretation built from that person&apos;s published work, so they won&apos;t always agree.
      </p>

      {roster.length === 0 && (
        <p className="mt-8 rounded-2xl bg-warn-soft px-5 py-4 text-warn">No reviewers are available for this kind of video yet.</p>
      )}

      {chosen.length > 0 && (
        <div className="-mx-4 mt-6 sm:-mx-10">
          <Boardroom board={chosen} states={{}} />
        </div>
      )}

      <ul className="mt-6 space-y-3">
        <AnimatePresence initial={false}>
          {chosen.map((c) => (
            <motion.li
              key={c.id}
              layout
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, height: 0, marginTop: 0 }}
              className="cutout flex items-start gap-4 p-4 sm:p-5"
            >
              <Avatar card={c} size={60} />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <h2 className="font-display font-extrabold text-xl text-ink">
                    <Link href={`/reviewers/${c.id}`} className="decoration-line-strong underline-offset-4 hover:underline">
                      {c.name}
                    </Link>
                  </h2>
                  <span className="text-sm font-semibold text-ink-soft">{c.short}</span>
                </div>
                <p className="mt-1.5 text-[0.95rem] leading-relaxed text-ink">{c.lens}</p>
                {(reasons.get(c.id)?.length ?? 0) > 0 && (
                  <p className="mt-2 text-sm text-ink-soft">Because {reasons.get(c.id)!.join(" and ")}.</p>
                )}
              </div>
              <button
                onClick={() => onChangeBoard(board.filter((id) => id !== c.id))}
                disabled={board.length <= 1}
                aria-label={`Remove ${c.name}`}
                className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-ink-soft transition-colors hover:bg-paper-deep hover:text-ink disabled:opacity-30"
              >
                <Close className="h-4 w-4" />
              </button>
            </motion.li>
          ))}
        </AnimatePresence>
      </ul>

      {others.length > 0 && board.length < MAX && (
        <div className="mt-8">
          <h3 className="text-sm font-bold text-ink-soft">Add someone else</h3>
          <ul className="mt-3 grid gap-2.5 sm:grid-cols-2">
            {others.map((c) => (
              <li key={c.id}>
                <button
                  onClick={() => onChangeBoard([...board, c.id])}
                  aria-label={`Add ${c.name}, ${c.short}`}
                  className="cutout group flex h-full w-full items-start gap-3 p-3 text-left transition-all hover:-translate-y-0.5 hover:shadow-lift"
                >
                  <Avatar card={c} size={42} />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center justify-between gap-2">
                      <span className="font-extrabold text-ink">{c.name}</span>
                      <Plus className="h-4 w-4 shrink-0 text-ink-faint transition-colors group-hover:text-accent" />
                    </span>
                    <span className="block text-xs font-bold text-accent">{c.short}</span>
                    <span className="mt-1 block text-[0.82rem] leading-snug text-ink-soft">{c.field}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="cutout mt-10">
        <button
          onClick={() => setShowAnswers((s) => !s)}
          aria-expanded={showAnswers}
          className="flex w-full items-center justify-between px-5 py-4 text-left text-ink"
        >
          <span>Your answers</span>
          <span className="text-sm text-ink-soft">{showAnswers ? "Hide" : "Review or change"}</span>
        </button>
        {showAnswers && (
          <ul className="divide-y divide-line border-t border-line">
            {active.map((a) => {
              const q = QUESTION_BY_ID.get(a.questionId);
              if (!q) return null;
              return (
                <li key={a.questionId} className="flex items-start gap-3 px-5 py-3.5">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-ink-soft">{q.prompt}</p>
                    <p className={`mt-0.5 ${a.skipped ? "text-ink-faint italic" : "text-ink"}`}>{a.display}</p>
                  </div>
                  <button
                    onClick={() => onEdit(a.questionId)}
                    aria-label={`Change answer to: ${q.prompt}`}
                    className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-ink-soft transition-colors hover:bg-paper-deep hover:text-ink"
                  >
                    <Pencil className="h-4 w-4" />
                  </button>
                </li>
              );
            })}
            {inferred.map((q) => (
              <li key={q.id} className="flex items-start gap-3 px-5 py-3.5">
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-ink-soft">{q.prompt}</p>
                  <p className="mt-0.5 text-ink-soft italic">Understood from your earlier answer</p>
                </div>
                <button
                  onClick={() => onEdit(q.id)}
                  aria-label={`Answer: ${q.prompt}`}
                  className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-ink-soft transition-colors hover:bg-paper-deep hover:text-ink"
                >
                  <Pencil className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <button
        onClick={onContinue}
        disabled={chosen.length === 0}
        className="mt-10 w-full rounded-full bg-accent px-6 py-3.5 text-base font-bold text-accent-ink transition-all hover:brightness-110 disabled:bg-paper-deep disabled:text-ink-faint sm:w-auto"
      >
        Next: upload your video
      </button>
    </div>
  );
}
