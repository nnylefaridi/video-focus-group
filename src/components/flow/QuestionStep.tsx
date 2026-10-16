"use client";

import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import type { QuestionNode } from "@/core/questionnaire/graph";
import type { Answer } from "@/core/questionnaire/engine";
import type { IntentFields } from "@/core/intent";
import { ArrowLeft, ArrowUp, Spinner } from "../Icons";

type Props = {
  question: QuestionNode;
  answers: Answer[];
  existing: Answer | null;
  onSubmit: (a: Answer) => void;
  onBack: (() => void) | null;
  remaining: number | null;
};

function mergeSets(sets: Partial<IntentFields>[]): Partial<IntentFields> {
  const out: Record<string, unknown> = {};
  for (const s of sets) {
    for (const [k, v] of Object.entries(s)) {
      out[k] = Array.isArray(v) ? [...((out[k] as unknown[]) ?? []), ...v] : v;
    }
  }
  return out as Partial<IntentFields>;
}

export function QuestionStep({ question, answers, existing, onSubmit, onBack, remaining }: Props) {
  return (
    <div className="mx-auto w-full max-w-xl">
      <div className="mb-8 flex h-6 items-center justify-between text-sm text-ink-soft">
        {onBack ? (
          <button onClick={onBack} className="-ml-2 inline-flex items-center gap-1.5 rounded-full px-2 py-1 transition-colors hover:text-ink">
            <ArrowLeft className="h-4 w-4" /> Back
          </button>
        ) : (
          <span />
        )}
        {remaining !== null && remaining > 0 && <span>{remaining === 1 ? "Last one" : `About ${remaining} more`}</span>}
      </div>

      <h1 className="font-serif text-[2rem] leading-[1.15] tracking-[-0.01em] text-ink sm:text-[2.5rem]">{question.prompt}</h1>
      {question.helper && <p className="mt-3 text-base text-ink-soft">{question.helper}</p>}

      <div className="mt-8">
        {question.answer.kind === "text" ? (
          <TextAnswer question={question} answers={answers} existing={existing} onSubmit={onSubmit} />
        ) : (
          <ChoiceAnswer question={question} existing={existing} onSubmit={onSubmit} />
        )}
      </div>

      {question.optional && (
        <button
          onClick={() => onSubmit({ questionId: question.id, display: "Skipped", fields: {}, skipped: true })}
          className="mt-5 rounded-full px-1 text-sm text-ink-soft underline decoration-line-strong underline-offset-4 transition-colors hover:text-ink"
        >
          Skip this one
        </button>
      )}
    </div>
  );
}

function TextAnswer({ question, answers, existing, onSubmit }: Omit<Props, "onBack" | "remaining">) {
  const spec = question.answer.kind === "text" ? question.answer : null;
  const [value, setValue] = useState(existing && !existing.skipped ? existing.display : "");
  const [focused, setFocused] = useState(false);
  /** Suggestions wait for a deliberate click/tap, so the auto-focused first screen stays bare. */
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);

  useEffect(() => {
    // Desktop: the cursor is ready in the box. Phones: don't pop the keyboard uninvited.
    if (window.matchMedia("(pointer: fine)").matches) ref.current?.focus();
  }, []);

  async function send() {
    const raw = value.trim();
    if (!raw || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/interpret", { method: "POST", body: JSON.stringify({ questionId: question.id, raw, answers }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Something went wrong.");
      onSubmit({ questionId: question.id, display: raw, fields: data.fields });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
      setBusy(false);
    }
  }

  const showSuggestions = focused && touched && !value && (spec?.suggestions?.length ?? 0) > 0;

  return (
    <div>
      <div className="relative rounded-[1.4rem] border border-line bg-card shadow-soft transition-colors focus-within:border-line-strong">
        <label htmlFor="answer" className="sr-only">
          {question.prompt}
        </label>
        <textarea
          id="answer"
          ref={ref}
          rows={2}
          value={value}
          maxLength={2000}
          onChange={(e) => setValue(e.target.value)}
          onFocus={() => setFocused(true)}
          onPointerDown={() => setTouched(true)}
          onBlur={() => setTimeout(() => setFocused(false), 150)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          placeholder={spec?.placeholder}
          className="block max-h-64 w-full resize-none bg-transparent px-5 pt-4 pb-14 text-lg leading-relaxed text-ink outline-none placeholder:text-ink-faint"
        />
        <button
          onClick={send}
          disabled={!value.trim() || busy}
          aria-label="Continue"
          className="absolute right-3 bottom-3 grid h-10 w-10 place-items-center rounded-full bg-accent text-accent-ink transition-all hover:brightness-110 disabled:bg-paper-deep disabled:text-ink-faint"
        >
          {busy ? <Spinner className="h-5 w-5" /> : <ArrowUp className="h-5 w-5" />}
        </button>
      </div>

      <AnimatePresence>
        {showSuggestions && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="mt-3 flex flex-wrap gap-2"
          >
            {spec!.suggestions!.map((s) => (
              <button
                key={s}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  setValue(s);
                  ref.current?.focus();
                }}
                className="rounded-full border border-line bg-card px-3.5 py-1.5 text-sm text-ink-soft transition-colors hover:border-line-strong hover:text-ink"
              >
                {s}
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>

      {error && (
        <p role="alert" className="mt-3 rounded-xl bg-warn-soft px-4 py-2.5 text-sm text-warn">
          {error}
        </p>
      )}
    </div>
  );
}

function ChoiceAnswer({ question, existing, onSubmit }: Pick<Props, "question" | "existing" | "onSubmit">) {
  const spec = question.answer.kind === "choice" ? question.answer : null;
  const initial = existing && !existing.skipped ? existing.display.split(", ") : [];
  const [selected, setSelected] = useState<string[]>(spec?.multi ? initial : []);
  if (!spec) return null;

  const pick = (label: string) => {
    if (!spec.multi) {
      const opt = spec.options.find((o) => o.label === label)!;
      onSubmit({ questionId: question.id, display: opt.label, fields: opt.set });
      return;
    }
    setSelected((s) => (s.includes(label) ? s.filter((x) => x !== label) : [...s, label]));
  };

  return (
    <div>
      <div className="flex flex-wrap gap-2.5" role={spec.multi ? "group" : "radiogroup"} aria-label={question.prompt}>
        {spec.options.map((o) => {
          const on = selected.includes(o.label) || (!spec.multi && initial.includes(o.label));
          return (
            <button
              key={o.label}
              role={spec.multi ? "checkbox" : "radio"}
              aria-checked={on}
              onClick={() => pick(o.label)}
              className={`rounded-full border px-5 py-2.5 text-base transition-all ${
                on ? "border-accent bg-accent-soft text-ink" : "border-line bg-card text-ink hover:border-line-strong hover:shadow-soft"
              }`}
            >
              {o.label}
            </button>
          );
        })}
      </div>
      {spec.multi && (
        <button
          disabled={selected.length === 0}
          onClick={() =>
            onSubmit({
              questionId: question.id,
              display: selected.join(", "),
              fields: mergeSets(spec.options.filter((o) => selected.includes(o.label)).map((o) => o.set)),
            })
          }
          className="mt-6 rounded-full bg-accent px-6 py-2.5 text-base text-accent-ink transition-all hover:brightness-110 disabled:bg-paper-deep disabled:text-ink-faint"
        >
          Continue
        </button>
      )}
    </div>
  );
}
