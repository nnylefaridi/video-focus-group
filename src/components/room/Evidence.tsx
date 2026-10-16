"use client";

import { useState, type ReactNode } from "react";
import { deriveSpan, evidenceKind, formatTime, type Ledger } from "@/core/evidence";
import { useRoom } from "./context";
import { Book } from "../Icons";

function ledgerOf(view: ReturnType<typeof useRoom>["view"]): Ledger | null {
  return view.ledger as unknown as Ledger | null;
}

export function useSpan(ids: string[]) {
  const { view } = useRoom();
  const l = ledgerOf(view);
  return l ? deriveSpan(l, ids) : null;
}

/** A time chip derived from evidence ids. Clicking seeks the player. */
export function TimeChip({ ids, className = "" }: { ids: string[]; className?: string }) {
  const { seek } = useRoom();
  const span = useSpan(ids);
  if (!span) return null;
  const label = span.end - span.start >= 0.5 ? `${formatTime(span.start)}–${formatTime(span.end)}` : formatTime(span.start);
  return (
    <button
      onClick={() => seek(span.start)}
      className={`inline-flex items-center rounded-full bg-paper-deep px-2.5 py-0.5 font-mono text-[0.78rem] text-ink-soft tabular-nums transition-colors hover:bg-line hover:text-ink ${className}`}
      aria-label={`Jump to ${formatTime(span.start)}`}
    >
      {label}
    </button>
  );
}

/** Frames and transcript lines a claim is based on: "what they saw". */
export function SeenEvidence({ ids }: { ids: string[] }) {
  const { view, seek } = useRoom();
  if (!view.ledger) return null;
  const frames = ids.map((id) => view.ledger!.frames.find((f) => f.id === id)).filter((f) => f !== undefined);
  const lines = ids.map((id) => view.ledger!.transcript.find((s) => s.id === id)).filter((s) => s !== undefined);
  const audio = ids.map((id) => view.ledger!.audio.find((a) => a.id === id)).filter((a) => a !== undefined);
  if (!frames.length && !lines.length && !audio.length) return null;
  return (
    <div className="mt-3 space-y-2">
      {frames.length > 0 && (
        <div className="flex gap-2 overflow-x-auto pb-1">
          {frames.slice(0, 6).map((f) => (
            <button
              key={f.id}
              onClick={() => seek(f.t)}
              className="group relative shrink-0 overflow-hidden rounded-lg border border-line"
              aria-label={`Frame at ${formatTime(f.t)}`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={f.url} alt="" className="h-20 w-auto object-cover transition-opacity group-hover:opacity-90" loading="lazy" />
              <span className="absolute right-1 bottom-1 rounded bg-ink/70 px-1 font-mono text-[0.65rem] text-paper">{formatTime(f.t)}</span>
            </button>
          ))}
        </div>
      )}
      {lines.map((s) => (
        <button key={s.id} onClick={() => seek(s.start)} className="block w-full rounded-lg bg-paper px-3 py-2 text-left text-sm text-ink-soft transition-colors hover:bg-paper-deep">
          <span className="mr-2 font-mono text-[0.72rem]">{formatTime(s.start)}</span>“{s.text}”
        </button>
      ))}
      {audio.map((a) => (
        <p key={a.id} className="text-sm text-ink-soft">
          <span className="mr-2 font-mono text-[0.72rem]">{formatTime(a.start)}</span>
          {a.kind === "silence" ? "Near-silence" : "Sound without speech (music or effects)"}
        </p>
      ))}
    </div>
  );
}

/** A short label for a principle chip: its first clause, cut at a word boundary. */
function chipLabel(statement: string): string {
  const first = statement.split(/[.;:,(]/)[0].trim();
  if (first.length <= 44) return first;
  const cut = first.slice(0, 44);
  return `${cut.slice(0, cut.lastIndexOf(" "))}…`;
}

const CONFIDENCE: Record<string, string> = {
  well_documented: "Well documented",
  stated_once: "Stated in one source",
  disputed_source: "From a source of uncertain authenticity",
};

/** A principle chip that opens the documented statement and its sources. */
export function PrincipleChips({ ids }: { ids: string[] }) {
  const { view } = useRoom();
  const [open, setOpen] = useState<string | null>(null);
  const valid = ids.filter((id) => view.principles[id]);
  if (!valid.length) return null;
  const p = open ? view.principles[open] : null;
  return (
    <div className="mt-3">
      <div className="flex flex-wrap gap-1.5">
        {valid.map((id) => (
          <button
            key={id}
            onClick={() => setOpen(open === id ? null : id)}
            aria-expanded={open === id}
            className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors ${
              open === id ? "border-line-strong bg-paper-deep text-ink" : "border-line text-ink-soft hover:text-ink"
            }`}
          >
            <Book className="h-3.5 w-3.5" />
            {chipLabel(view.principles[id].statement)}
          </button>
        ))}
      </div>
      {p && (
        <div className="mt-2 rounded-xl bg-paper px-4 py-3 text-sm">
          <p className="text-xs text-ink-soft">From their published work · {CONFIDENCE[p.confidence]}</p>
          <p className="mt-1 text-ink">{p.statement}</p>
          <ul className="mt-2 space-y-1">
            {p.sources.map((s, i) => (
              <li key={i} className="text-ink-soft">
                <a href={s.url} target="_blank" rel="noreferrer" className="underline decoration-line-strong underline-offset-2 hover:text-ink">
                  {s.title}
                </a>
                {s.locator ? `, ${s.locator}` : ""}
                {s.kind === "secondary" ? " (summary)" : ""}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export function BasisLabel({ basis }: { basis: "documented" | "application" | "general" }) {
  const text = basis === "documented" ? "From their published work" : basis === "application" ? "Their ideas, applied to your video" : "General observation";
  return <span className="text-xs text-ink-soft">{text}</span>;
}

/** One line of model text: **bold**, [F012]-style citations as time chips, {principle-id} hidden (shown as chips below). */
function Inline({ text }: { text: string }) {
  const parts: ReactNode[] = [];
  const re = /\*\*([^*]+)\*\*|\[([FTSA]\d+(?:,\s*[FTSA]\d+)*)\]|\{([a-z0-9-]+)\}/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let k = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    if (m[1]) parts.push(<strong key={k++} className="font-extrabold">{m[1]}</strong>);
    if (m[2]) {
      const ids = m[2].split(/,\s*/).filter((id) => evidenceKind(id));
      if (ids.length) parts.push(<TimeChip key={k++} ids={ids} className="mx-0.5 align-baseline" />);
    }
    last = re.lastIndex;
  }
  if (last < text.length) parts.push(text.slice(last));
  return <>{parts}</>;
}

/** Renders a reviewer's chat answer: paragraphs and simple bullet lists, with citations turned into time chips. */
export function CitedText({ text }: { text: string }) {
  const blocks: ReactNode[] = [];
  let bullets: string[] = [];
  const flush = () => {
    if (!bullets.length) return;
    blocks.push(
      <ul key={blocks.length} className="my-1.5 list-disc space-y-1 pl-5">
        {bullets.map((b, i) => (
          <li key={i}>
            <Inline text={b} />
          </li>
        ))}
      </ul>,
    );
    bullets = [];
  };
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    const bullet = line.match(/^[-*•]\s+(.*)$/);
    if (bullet) {
      bullets.push(bullet[1]);
      continue;
    }
    flush();
    if (line)
      blocks.push(
        <p key={blocks.length} className="my-1.5">
          <Inline text={line.replace(/^#+\s*/, "")} />
        </p>,
      );
  }
  flush();
  return <>{blocks}</>;
}

export function principleIdsIn(text: string): string[] {
  return [...text.matchAll(/\{([a-z0-9-]+)\}/g)].map((m) => m[1]);
}
