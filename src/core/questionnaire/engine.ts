import { IntentFields } from "../intent";
import { MAX_QUESTIONS, QUESTIONS, QUESTION_BY_ID, priorityOf, type QuestionNode } from "./graph";

/** One stored answer. `fields` is what the answer contributed to the intent. */
export type Answer = {
  questionId: string;
  /** What the person typed or picked, shown back on the summary screen. */
  display: string;
  fields: Partial<IntentFields>;
  skipped?: boolean;
};

const ARRAY_KEYS = new Set(["platforms", "reactions"]);

function mergeFields(base: IntentFields, add: Partial<IntentFields>): IntentFields {
  const out: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(add)) {
    if (v === undefined || v === null || v === "") continue;
    if (ARRAY_KEYS.has(k) && Array.isArray(v)) {
      const prev = (out[k] as string[] | undefined) ?? [];
      out[k] = Array.from(new Set([...prev, ...v]));
    } else {
      out[k] = v;
    }
  }
  return out as IntentFields;
}

/**
 * Replays answers in order, keeping only answers whose question is still
 * visible given everything answered before it. Answers that no longer apply
 * (e.g. comedy questions after switching to an ad) are pruned, not deleted.
 */
export function resolve(answers: Answer[]): { fields: IntentFields; active: Answer[]; inactive: Answer[] } {
  let fields: IntentFields = {};
  const active: Answer[] = [];
  const inactive: Answer[] = [];
  for (const a of answers) {
    const q = QUESTION_BY_ID.get(a.questionId);
    if (!q || (q.showIf && !q.showIf(fields))) {
      inactive.push(a);
      continue;
    }
    active.push(a);
    if (!a.skipped) fields = mergeFields(fields, a.fields);
  }
  return { fields, active, inactive };
}

function isFilled(fields: IntentFields, q: QuestionNode): boolean {
  return q.fills.every((k) => {
    const v = fields[k];
    return Array.isArray(v) ? v.length > 0 : v !== undefined && v !== "";
  });
}

/** Questions that apply to this intent, in order. */
export function visibleQuestions(fields: IntentFields): QuestionNode[] {
  return QUESTIONS.filter((q) => !q.showIf || q.showIf(fields));
}

/** Questions still worth asking, most useful first (before the 5-question cap). */
function candidates(answers: Answer[]): QuestionNode[] {
  const { fields, active } = resolve(answers);
  const answered = new Set(active.map((a) => a.questionId));
  return visibleQuestions(fields)
    .filter((q) => !answered.has(q.id) && !isFilled(fields, q))
    .sort((a, b) => priorityOf(b.id, fields) - priorityOf(a.id, fields));
}

/** How many questions have been shown so far (answered or skipped). */
export function askedCount(answers: Answer[]): number {
  return resolve(answers).active.length;
}

/**
 * The next question to ask, or null when the flow is complete. Never more than
 * five questions in total; which ones depends on what earlier answers revealed
 * (free-text answers can fill several fields at once, and priorities shift with
 * the kind of video and its goal).
 */
export function nextQuestion(answers: Answer[]): QuestionNode | null {
  if (askedCount(answers) >= MAX_QUESTIONS) return null;
  return candidates(answers)[0] ?? null;
}

/** Questions skipped because an earlier answer already covered them, for the summary screen. */
export function inferredQuestions(answers: Answer[]): QuestionNode[] {
  const { fields, active } = resolve(answers);
  const answered = new Set(active.map((a) => a.questionId));
  return visibleQuestions(fields).filter((q) => !answered.has(q.id) && isFilled(fields, q));
}

/** Questions left, for the quiet progress indicator. */
export function remainingCount(answers: Answer[]): number {
  return Math.min(candidates(answers).length, Math.max(0, MAX_QUESTIONS - askedCount(answers)));
}

/** Replace the answer to one question (editing) and drop answers that no longer apply. */
export function upsertAnswer(answers: Answer[], next: Answer): Answer[] {
  const idx = answers.findIndex((a) => a.questionId === next.questionId);
  const updated = idx === -1 ? [...answers, next] : answers.map((a, i) => (i === idx ? next : a));
  return resolve(updated).active;
}

export function isComplete(answers: Answer[]): boolean {
  return nextQuestion(answers) === null && resolve(answers).fields.category !== undefined;
}
