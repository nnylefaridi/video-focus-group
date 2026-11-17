"use client";

import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { QUESTION_BY_ID, type QuestionNode } from "@/core/questionnaire/graph";
import { isComplete, nextQuestion, remainingCount, resolve, upsertAnswer, type Answer } from "@/core/questionnaire/engine";
import type { BoardPick } from "@/core/board";
import type { ExpertCard } from "@/core/expert";
import { QuestionStep } from "./QuestionStep";
import { BoardStep } from "./BoardStep";
import { UploadStep } from "./UploadStep";
import { SignInStep } from "./SignInStep";
import { PaymentStep } from "./PaymentStep";
import { SETUP_KEY, StartPay } from "./StartPay";
import type { PaymentContext } from "@/server/billing";
import { Puppet } from "../puppets/Puppet";
import { useFirstScreen } from "../CoffeeLink";

type Step = "questions" | "board" | "upload";

/** The very first screen: the first question, nothing answered yet. Only it and its answer box show. */
export function isFirstScreen(step: Step, answers: Answer[], editing: string | null): boolean {
  return step === "questions" && answers.length === 0 && !editing;
}
/**
 * Hosted mode, signed in: whether to ask how to pay before the upload. Asked when the account
 * has never chosen, when it asks to change, and when the saved choice can't pay yet (say, "own
 * key" picked earlier but no key saved): then nothing is assumed and both options are shown
 * again, unless they picked in this visit and are now finishing its setup.
 */
export function needsPaymentChoice(pay: PaymentContext | null, changing: boolean, pickedThisVisit: boolean): boolean {
  if (!pay) return false;
  return !pay.method || changing || (!pay.ready && !pickedThisVisit);
}

/** Hosted mode: whether the first screen asks how to pay instead of the first question. */
export function startsWithPayment(signedOut: boolean, pay: PaymentContext | null, firstScreen: boolean): boolean {
  if (signedOut) return true;
  return firstScreen && pay !== null && !(pay.method && pay.ready);
}

type Saved = { answers: Answer[]; step: Step; board: string[] | null; editing: string | null };

const KEY = "panel.flow.v1";
/**
 * A copy kept while someone goes to log in, for when they come back in another tab
 * (an email confirmation link opens one). This tab's own session copy comes first.
 */
const PENDING_KEY = "panel.flow.pending.v1";
const PENDING_MS = 24 * 60 * 60 * 1000;

function load(): Saved | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (raw) return JSON.parse(raw) as Saved;
    const pending = localStorage.getItem(PENDING_KEY);
    if (!pending) return null;
    const { at, ...flow } = JSON.parse(pending) as Saved & { at: number };
    return Date.now() - at < PENDING_MS ? flow : null;
  } catch {
    return null;
  }
}

/**
 * Client-only (see FlowLoader): restores an in-progress flow from this tab's session.
 * Hosted mode: `signInFirst` (signed out) or a `payment` that can't pay yet (signed in)
 * puts the payment choice (StartPay) where the first question would be. Local mode passes
 * neither and starts with the first question.
 */
export function Flow({
  signInFirst = false,
  hosted = false,
  payment = null,
  maxUploadMb = 250,
}: {
  signInFirst?: boolean;
  hosted?: boolean;
  payment?: PaymentContext | null;
  maxUploadMb?: number;
}) {
  const [saved] = useState(load);
  const [pay, setPay] = useState(payment);
  /**
   * A new payment context from the server replaces ours. Logging in from this page and coming
   * back is a client navigation that can keep this component, and its state, from before the
   * login, when there was none; without this the payment question would be skipped.
   */
  const [payFromServer, setPayFromServer] = useState(payment);
  if (payment !== payFromServer) {
    setPayFromServer(payment);
    setPay(payment);
  }
  /** Changing the remembered payment choice from the upload step. */
  const [choosingPay, setChoosingPay] = useState(false);
  /** A payment choice made on this visit: its setup (key or top-up) shows next, without asking again. */
  const [pickedPay, setPickedPay] = useState(false);
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

  // Signed in (or no sign-in needed): any copy kept for the way back from logging in is done with.
  useEffect(() => {
    if (signInFirst) return;
    try {
      localStorage.removeItem(PENDING_KEY);
    } catch {}
  }, [signInFirst]);

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

  const firstScreen = isFirstScreen(step, answers, editing);
  /**
   * Hosted mode: the first screen asks how to pay instead of the first question, until the
   * choice can pay (the server checks answers only on the visitor's own key or credits).
   * Signed out, it's asked wherever they are.
   */
  const startPay = startsWithPayment(signInFirst, pay, firstScreen);
  useFirstScreen(firstScreen || startPay);

  // A choice that can pay has nothing left to set up.
  useEffect(() => {
    if (!pay?.ready) return;
    try {
      sessionStorage.removeItem(SETUP_KEY);
    } catch {}
  }, [pay?.ready]);

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
  const askPay = needsPaymentChoice(pay, choosingPay, pickedPay);
  const boardCards = effectiveBoard.map((id) => roster.find((c) => c.id === id)).filter((c): c is ExpertCard => Boolean(c));

  return (
    <main className={`relative mx-auto flex min-h-dvh w-full flex-col px-4 sm:px-8 ${startPay ? "max-w-5xl" : "max-w-3xl"}`}>
      {/* Hosted mode, signed out: a way back into an existing account, on the first screen only. */}
      {signInFirst && startPay && (
        <Link href="/login?next=/" className="absolute top-4 right-4 z-10 rounded-full bg-accent px-5 py-2 text-sm font-bold text-accent-ink shadow-lift transition-all hover:brightness-110 sm:right-8">
          Log in
        </Link>
      )}
      <AnimatePresence mode="wait">
        {startPay && (
          <motion.div key="start-pay" initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="flex flex-1 flex-col justify-center py-10">
            <StartPay pay={pay} onPayment={setPay} />
          </motion.div>
        )}

        {!startPay && step === "questions" && current && (
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

        {!startPay && step === "board" && (
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

        {step === "upload" && signInFirst && (
          <motion.div key="signin" initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="flex flex-1 flex-col justify-center py-16">
            <SignInStep
              board={boardCards}
              onBack={() => setStep("board")}
              onLeave={() => {
                try {
                  localStorage.setItem(PENDING_KEY, JSON.stringify({ answers, step: "upload", board: effectiveBoard, editing: null, at: Date.now() }));
                } catch {
                  /* storage unavailable: this tab's session copy still brings them back */
                }
              }}
            />
          </motion.div>
        )}

        {step === "upload" && !signInFirst && askPay && (
          <motion.div key="pay" initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="flex flex-1 flex-col justify-center py-16">
            <PaymentStep
              board={boardCards}
              current={pay!.ready ? pay!.method : null}
              onBack={() => (choosingPay ? setChoosingPay(false) : setStep("board"))}
              onChosen={(ctx) => {
                setPay(ctx);
                setPickedPay(true);
                setChoosingPay(false);
              }}
            />
          </motion.div>
        )}

        {step === "upload" && !signInFirst && !askPay && (
          <motion.div key="upload" initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="flex flex-1 flex-col justify-center py-16">
            <UploadStep
              answers={answers}
              board={boardCards}
              payment={pay}
              maxUploadMb={maxUploadMb}
              hosted={hosted}
              onChangePayment={pay ? () => setChoosingPay(true) : undefined}
              onPaymentChange={pay ? setPay : undefined}
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
