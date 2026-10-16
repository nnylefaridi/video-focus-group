"use client";

import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { QUESTION_BY_ID, type QuestionNode } from "@/core/questionnaire/graph";
import { isComplete, nextQuestion, remainingCount, resolve, upsertAnswer, type Answer } from "@/core/questionnaire/engine";
import type { BoardPick } from "@/core/board";
import type { ExpertCard } from "@/core/expert";
import { QuestionStep } from "./QuestionStep";
import { BoardStep } from "./BoardStep";
import { UploadStep } from "./UploadStep";
import { Puppet } from "../puppets/Puppet";

type Step = "questions" | "board" | "upload";
type Saved = { answers: Answer[]; step: Step; board: string[] | null; editing: string | null };

const KEY = "panel.flow.v1";

function load(): Saved | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Saved) : null;
  } catch {
    return null;
  }
}

/** Client-only (see FlowLoader): restores an in-progress flow from this tab's session. */
export function Flow() {
  const [saved] = useState(load);
  const [answers, setAnswers] = useState<Answer[]>(saved?.answers ?? []);
  const [step, setStep] = useState<Step>(saved?.step ?? "questions");
  const [history, setHistory] = useState<string[]>(() => (saved?.answers ?? []).map((a) => a.questionId));
  /** When editing a single answer from the board screen. */
  const [editing, setEditing] = useState<string | null>(saved?.editing ?? null);
  const [boardIds, setBoardIds] = useState<string[] | null>(saved?.board ?? null);
  const [picksState, setPicks] = useState<BoardPick[]>([]);
  const [roster, setRoster] = useState<ExpertCard[]>([]);

  useEffect(() => {
    try {
      sessionStorage.setItem(KEY, JSON.stringify({ answers, step, board: boardIds, editing } satisfies Saved));
    } catch {
      /* storage unavailable: the flow still works for this visit */
    }
  }, [answers, step, boardIds, editing]);

  const { fields } = useMemo(() => resolve(answers), [answers]);

  // Recommend a board whenever the intent changes (once we know the category).
  const picks = fields.category ? picksState : [];
  useEffect(() => {
    if (!fields.category) return;
    const ctrl = new AbortController();
    fetch("/api/board", { method: "POST", body: JSON.stringify(fields), signal: ctrl.signal })
      .then((r) => r.json())
      .then((d: { picks: BoardPick[]; roster: ExpertCard[] }) => {
        setPicks(d.picks);
        setRoster(d.roster);
      })
      .catch(() => {});
    return () => ctrl.abort();
  }, [fields]);

  const current: QuestionNode | null = editing ? (QUESTION_BY_ID.get(editing) ?? null) : nextQuestion(answers);

  const submit = useCallback(
    (a: Answer) => {
      const next = upsertAnswer(answers, a);
      setAnswers(next);
      if (editing) {
        setEditing(null);
        // An edit can open new questions (e.g. switching to an ad). Ask those before returning.
        setStep(isComplete(next) ? "board" : "questions");
        setBoardIds(null);
        return;
      }
      setHistory((h) => [...h, a.questionId]);
      if (isComplete(next)) setStep("board");
    },
    [answers, editing],
  );

  const back = useCallback(() => {
    if (editing) {
      setEditing(null);
      setStep("board");
      return;
    }
    const prev = history.at(-1);
    if (!prev) return;
    setHistory((h) => h.slice(0, -1));
    setAnswers((as) => as.filter((x) => x.questionId !== prev));
  }, [history, editing]);

  const effectiveBoard = boardIds ?? picks.map((p) => p.id);
  const boardCards = effectiveBoard.map((id) => roster.find((c) => c.id === id)).filter((c): c is ExpertCard => Boolean(c));

  return (
    <main className="relative mx-auto flex min-h-dvh w-full max-w-3xl flex-col px-4 sm:px-8">
      <AnimatePresence mode="wait">
        {step === "questions" && current && (
          <motion.div
            key={current.id + (editing ? ":edit" : "")}
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.28, ease: "easeOut" }}
            className="flex flex-1 flex-col justify-center py-16"
          >
            <QuestionStep
              question={current}
              answers={answers}
              existing={answers.find((a) => a.questionId === current.id) ?? null}
              onSubmit={submit}
              onBack={history.length > 0 || editing ? back : null}
              remaining={editing ? null : history.length > 0 ? remainingCount(answers) : null}
            />
          </motion.div>
        )}

        {step === "board" && (
          <motion.div key="board" initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="py-12 sm:py-16">
            <BoardStep
              answers={answers}
              picks={picks}
              roster={roster}
              board={effectiveBoard}
              onChangeBoard={setBoardIds}
              onEdit={(qid) => {
                setEditing(qid);
                setStep("questions");
              }}
              onContinue={() => setStep("upload")}
            />
          </motion.div>
        )}

        {step === "upload" && (
          <motion.div key="upload" initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="flex flex-1 flex-col justify-center py-16">
            <UploadStep
              answers={answers}
              board={boardCards}
              onBack={() => setStep("board")}
              onDone={() => {
                try {
                  sessionStorage.removeItem(KEY);
                } catch {}
              }}
            />
          </motion.div>
        )}
      </AnimatePresence>

      {/* As your board takes shape, its puppets peek up from the bottom edge of the page. */}
      {step === "questions" && !editing && boardCards.length > 0 && (
        <div className="pointer-events-none fixed inset-x-0 bottom-0 flex justify-center overflow-hidden" aria-hidden>
          <div className="flex items-end gap-2 sm:gap-4">
            <AnimatePresence>
              {boardCards.map((c, i) => (
                <motion.div
                  key={c.id}
                  className="w-[76px] sm:w-[96px]"
                  initial={{ y: "110%" }}
                  animate={{ y: "38%" }}
                  exit={{ y: "110%" }}
                  transition={{ delay: i * 0.15, type: "spring", stiffness: 140, damping: 15 }}
                >
                  <Puppet id={c.id} name={c.name} delay={i * 0.6} stick={0.35} />
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        </div>
      )}
    </main>
  );
}
