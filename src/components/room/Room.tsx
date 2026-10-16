"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import type { ReviewView } from "@/core/view";
import { RoomContext, type RoomCtx } from "./context";
import { Player, type Marker } from "./Player";
import { deriveSpan, type Ledger } from "@/core/evidence";
import { BoardView } from "./BoardView";
import { Discussion } from "./Discussion";
import { Notes } from "./Notes";
import { Compare, Coverage, Plan } from "./Compare";
import { Ask } from "./Ask";
import { Board, Bubbles, Checklist, Frame } from "../Icons";

const SECTIONS = [
  { id: "board", label: "The Board", Icon: Board },
  { id: "analysis", label: "Video Analysis", Icon: Frame },
  { id: "discussion", label: "Discussion", Icon: Bubbles },
  { id: "plan", label: "Revision Plan", Icon: Checklist },
] as const;
type Section = (typeof SECTIONS)[number]["id"];

export function Room({ id }: { id: string }) {
  const router = useRouter();
  const [view, setView] = useState<ReviewView | null>(null);
  const [missing, setMissing] = useState(false);
  const [section, setSection] = useState<Section>("board");
  const [askFor, setAskFor] = useState<string | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [speaking, setSpeaking] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [seekRequest, setSeekRequest] = useState<{ t: number; n: number } | null>(null);
  const [reloads, setReloads] = useState(0);

  const finished = view?.stage === "done" || view?.stage === "failed" || view?.stage === "uploading";
  useEffect(() => {
    let alive = true;
    const tick = async () => {
      const res = await fetch(`/api/reviews/${id}`, { cache: "no-store" });
      if (!alive) return;
      if (res.status === 404) setMissing(true);
      else if (res.ok) setView(await res.json());
    };
    tick();
    if (finished) return () => void (alive = false);
    const t = setInterval(tick, 2000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [id, finished, reloads]);

  const seek = useCallback((t: number) => {
    setSeekRequest((s) => ({ t: Math.max(0, t), n: (s?.n ?? 0) + 1 }));
    setCurrentTime(Math.max(0, t));
  }, []);

  const ctx = useMemo<RoomCtx | null>(
    () => view && { view, seek, currentTime, card: (rid: string) => view.board.find((b) => b.id === rid), speaking, setSpeaking },
    [view, seek, currentTime, speaking],
  );

  if (missing)
    return (
      <main className="mx-auto max-w-xl px-4 py-24 text-center">
        <h1 className="font-display text-3xl font-extrabold text-ink">This review doesn&apos;t exist</h1>
        <Link href="/" className="mt-6 inline-block rounded-full bg-accent px-6 py-2.5 font-bold text-accent-ink">
          Start a new one
        </Link>
      </main>
    );
  if (!view || !ctx)
    return (
      <main className="grid min-h-dvh place-items-center">
        <p className="animate-pulse font-semibold text-ink-soft">Opening your review…</p>
      </main>
    );

  const ready = view.stage === "done" && Boolean(view.synthesis && view.discussion);
  const go = (s: Section) => {
    setSection(s);
    window.scrollTo({ top: 0, behavior: "instant" });
  };

  const extras = (
    <div className="space-y-1.5 text-xs font-semibold">
      <Link href="/reviews" className="block text-ink-soft hover:text-ink">
        All reviews
      </Link>
      <Link href="/" className="block text-ink-soft hover:text-ink">
        New review
      </Link>
      {finished &&
        (confirmDelete ? (
          <span className="block text-ink-soft">
            Delete it?{" "}
            <button
              onClick={async () => {
                await fetch(`/api/reviews/${id}`, { method: "DELETE" });
                router.push("/reviews");
              }}
              className="text-warn underline underline-offset-2"
            >
              Yes
            </button>{" "}
            <button onClick={() => setConfirmDelete(false)} className="underline underline-offset-2">
              No
            </button>
          </span>
        ) : (
          <button onClick={() => setConfirmDelete(true)} className="block text-ink-faint hover:text-ink-soft">
            Delete this review
          </button>
        ))}
    </div>
  );

  const navButtons = (mobile: boolean) =>
    SECTIONS.map(({ id: s, label, Icon }) => {
      const available = s === "board" || ready;
      const active = section === s;
      return (
        <button
          key={s}
          onClick={() => available && go(s)}
          aria-current={active ? "page" : undefined}
          aria-disabled={!available}
          title={available ? undefined : "Ready when the panel finishes"}
          className={
            mobile
              ? `flex flex-1 flex-col items-center gap-0.5 rounded-xl px-1 py-2 text-[0.68rem] font-bold ${active ? "bg-accent-soft text-accent" : available ? "text-ink-soft" : "text-ink-faint"}`
              : `flex w-full items-center gap-3 rounded-xl px-3.5 py-3 text-left text-[0.95rem] font-bold transition-colors ${
                  active ? "bg-accent-soft text-accent" : available ? "text-ink hover:bg-paper-deep" : "cursor-default text-ink-faint"
                }`
          }
        >
          <Icon className="h-5 w-5 shrink-0" />
          {label}
        </button>
      );
    });

  // Timeline dots for the current section, each tied to the note it should scroll to.
  const ledger = view.ledger as unknown as Ledger | null;
  const colorOf = (rid: string) => view.board.find((b) => b.id === rid)?.color ?? "#b8c0ca";
  const nameOf = (rid: string) => view.board.find((b) => b.id === rid)?.name ?? "";
  const markers: Marker[] = [];
  const at = (ids: string[]) => (ledger ? deriveSpan(ledger, ids)?.start : undefined);
  if (ledger && section === "analysis" && view.notes)
    for (const [rid, n] of Object.entries(view.notes))
      for (const o of n.observations) {
        const t = at(o.evidenceIds);
        if (t !== undefined) markers.push({ t, key: `note-obs-${rid}-${o.id}`, color: colorOf(rid), label: `${nameOf(rid)}: ${o.claim}` });
      }
  if (ledger && section === "discussion" && view.discussion)
    view.discussion.forEach((turn, i) => {
      const t = at(turn.evidenceIds);
      if (t !== undefined) markers.push({ t, key: `note-turn-${i}`, color: colorOf(turn.reviewerId), label: `${nameOf(turn.reviewerId)}: ${turn.text}` });
    });
  if (ledger && section === "plan" && view.synthesis) {
    const p = view.synthesis.plan;
    p.high.forEach((h, i) => {
      const t = at(h.evidenceIds);
      if (t !== undefined) markers.push({ t, key: `note-plan-high-${i}`, color: "var(--accent)", label: h.change });
    });
    p.experiments.forEach((e, i) => {
      const t = at(e.evidenceIds);
      if (t !== undefined) markers.push({ t, key: `note-plan-exp-${i}`, color: "var(--sage-deep)", label: e.idea });
    });
    p.keep.forEach((k, i) => {
      const t = at(k.evidenceIds);
      if (t !== undefined) markers.push({ t, key: `note-plan-keep-${i}`, color: "var(--sage)", label: k.what });
    });
  }

  /** Scroll to the note behind a timeline dot and let it glow for a moment. */
  const focusNote = (m: Marker) => {
    window.dispatchEvent(new CustomEvent("panel:focus", { detail: m.key }));
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        const el = document.getElementById(m.key);
        if (!el) return;
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        el.classList.remove("note-flash");
        void el.offsetWidth;
        el.classList.add("note-flash");
      }),
    );
  };

  const compact = (content: ReactNode) => (
    <div className="mx-auto grid max-w-5xl gap-8 px-4 pt-8 pb-10 sm:px-8 lg:grid-cols-[minmax(0,330px)_minmax(0,1fr)]">
      <div className="lg:sticky lg:top-8 lg:self-start">
        <Player variant="compact" seekRequest={seekRequest} onTime={setCurrentTime} markers={markers} onMarker={focusNote} />
      </div>
      <div className="min-w-0">{content}</div>
    </div>
  );

  return (
    <RoomContext.Provider value={ctx}>
      <div className="min-h-dvh lg:pr-[248px]">
        {section === "board" && (
          <main className="mx-auto max-w-[1180px] px-2 pt-6 pb-8 sm:px-6 lg:pt-10">
            <h1 className="sr-only">{view.title}</h1>
            <BoardView
              seekRequest={seekRequest}
              onTime={setCurrentTime}
              onPick={(rid) => {
                setAskFor(rid);
                go("discussion");
              }}
              onRetry={async () => {
                await fetch(`/api/reviews/${id}/retry`, { method: "POST" });
                setReloads((n) => n + 1);
              }}
              onOpenPlan={() => go("plan")}
            />
          </main>
        )}

        {section === "analysis" &&
          ready &&
          compact(
            <main className="space-y-6">
              <div>
                <h1 className="font-display text-3xl font-extrabold text-ink">Video analysis</h1>
                <p className="mt-1 text-ink-soft">Every moment the panel commented on. Tap a time to jump there.</p>
              </div>
              <Notes />
              <Coverage />
            </main>,
          )}

        {section === "discussion" &&
          ready &&
          compact(
            <main className="space-y-12">
              <section>
                <h1 className="font-display text-3xl font-extrabold text-ink">Discussion</h1>
                <div className="mt-6">
                  <Discussion turns={view.discussion!} />
                </div>
              </section>
              <section>
                <h2 className="font-display text-2xl font-extrabold text-ink">Takeaways</h2>
                <div className="mt-5">
                  <Compare s={view.synthesis!} />
                </div>
              </section>
              <section id="ask">
                <h2 className="font-display text-2xl font-extrabold text-ink">Ask a reviewer</h2>
                <div className="mt-5">
                  <Ask key={askFor ?? "default"} initialWho={askFor} />
                </div>
              </section>
            </main>,
          )}

        {section === "plan" &&
          ready &&
          compact(
            <main>
              <h1 className="font-display text-3xl font-extrabold text-ink">Revision plan</h1>
              <div className="mt-6">
                <Plan s={view.synthesis!} />
              </div>
            </main>,
          )}

        <p className="mx-auto max-w-xl px-6 pb-6 text-center text-xs font-semibold text-ink-faint">
          Reviewers are AI interpretations based on each person&apos;s published work. They did not watch or endorse this video.
        </p>
        <div className="mx-auto max-w-md px-6 pb-28 text-center lg:hidden">{extras}</div>
      </div>

      {/* Desktop: a small paper card on the right. */}
      <aside className="fixed top-10 right-6 z-20 hidden w-[216px] space-y-4 lg:block">
        <nav aria-label="Review sections" className="cutout-lift space-y-1 p-2">
          {navButtons(false)}
        </nav>
        <div className="px-3">{extras}</div>
      </aside>

      {/* Phones and tablets: a paper tab bar along the bottom. */}
      <div className="fixed inset-x-0 bottom-0 z-20 px-3 pb-3 lg:hidden">
        <nav aria-label="Review sections" className="cutout-lift mx-auto flex max-w-md justify-between gap-1 p-1.5">
          {navButtons(true)}
        </nav>
      </div>
    </RoomContext.Provider>
  );
}
