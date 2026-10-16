"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReviewView } from "@/core/view";
import { Avatar } from "../Avatar";
import { RoomContext, type RoomCtx } from "./context";
import { Player } from "./Player";
import { Progress } from "./Progress";
import { Discussion } from "./Discussion";
import { Notes } from "./Notes";
import { Compare, Plan } from "./Compare";
import { Ask } from "./Ask";

const TABS = [
  { id: "discussion", label: "Discussion" },
  { id: "notes", label: "Notes" },
  { id: "compare", label: "Compare" },
  { id: "plan", label: "Plan" },
  { id: "ask", label: "Ask" },
] as const;
type Tab = (typeof TABS)[number]["id"];

export function Room({ id }: { id: string }) {
  const router = useRouter();
  const [view, setView] = useState<ReviewView | null>(null);
  const [missing, setMissing] = useState(false);
  const [tab, setTab] = useState<Tab>("discussion");
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
  const load = () => setReloads((n) => n + 1);

  const seek = useCallback((t: number) => {
    setSeekRequest((s) => ({ t: Math.max(0, t), n: (s?.n ?? 0) + 1 }));
    setCurrentTime(Math.max(0, t));
  }, []);

  const ctx = useMemo<RoomCtx | null>(
    () =>
      view && {
        view,
        seek,
        currentTime,
        card: (rid: string) => view.board.find((b) => b.id === rid),
        speaking,
        setSpeaking,
      },
    [view, seek, currentTime, speaking],
  );

  if (missing)
    return (
      <main className="mx-auto max-w-xl px-4 py-24 text-center">
        <h1 className="font-serif text-3xl text-ink">This review doesn&apos;t exist</h1>
        <Link href="/" className="mt-6 inline-block rounded-full bg-accent px-6 py-2.5 text-accent-ink">
          Start a new one
        </Link>
      </main>
    );
  if (!view || !ctx)
    return (
      <main className="grid min-h-dvh place-items-center">
        <p className="animate-pulse text-ink-soft">Opening your review…</p>
      </main>
    );

  const ready = view.stage === "done" && view.synthesis && view.discussion;

  return (
    <RoomContext.Provider value={ctx}>
      <main className="mx-auto w-full max-w-6xl px-4 pt-5 pb-16 sm:px-6 lg:grid lg:grid-cols-[minmax(0,400px)_minmax(0,1fr)] lg:gap-10 lg:pt-8">
        <aside className="sticky top-0 z-10 -mx-4 bg-paper px-4 pt-1 pb-3 sm:-mx-6 sm:px-6 lg:top-8 lg:mx-0 lg:self-start lg:px-0 lg:pb-0">
          {view.video?.url ? (
            <Player seekRequest={seekRequest} onTime={setCurrentTime} />
          ) : (
            <div className="hidden lg:block" />
          )}
        </aside>

        <section className="min-w-0">
          <div className="flex items-center justify-between gap-4 text-sm text-ink-soft">
            <Link href="/reviews" className="rounded-full py-1 hover:text-ink">
              All reviews
            </Link>
            <Link href="/" className="rounded-full py-1 hover:text-ink">
              New review
            </Link>
          </div>

          <h1 className="mt-4 font-serif text-[1.75rem] leading-tight text-ink sm:text-[2.1rem]">{view.title}</h1>

          {ready && (
            <div className="mt-5 flex items-end gap-4">
              {view.board.map((c) => (
                <Avatar key={c.id} card={c} size={52} label state={speaking === c.id ? "speaking" : "idle"} />
              ))}
            </div>
          )}

          {view.stage === "uploading" ? (
            <div className="mt-8 rounded-2xl bg-paper-deep p-5">
              <p className="text-ink">This upload didn&apos;t finish, so there&apos;s nothing to review.</p>
              <Link href="/" className="mt-4 inline-block rounded-full bg-accent px-5 py-2 text-accent-ink">
                Start again
              </Link>
            </div>
          ) : view.stage === "failed" ? (
            <div className="mt-8 rounded-2xl bg-warn-soft p-5">
              <p className="font-medium text-warn">The review stopped partway.</p>
              <p className="mt-1 text-warn">{view.error}</p>
              <button
                onClick={async () => {
                  await fetch(`/api/reviews/${id}/retry`, { method: "POST" });
                  load();
                }}
                className="mt-4 rounded-full bg-accent px-5 py-2 text-accent-ink"
              >
                Try again
              </button>
            </div>
          ) : !ready ? (
            <Progress />
          ) : (
            <>
              <div role="tablist" aria-label="Review sections" className="mt-7 flex gap-1 overflow-x-auto border-b border-line">
                {TABS.map((t) => (
                  <button
                    key={t.id}
                    role="tab"
                    aria-selected={tab === t.id}
                    onClick={() => setTab(t.id)}
                    className={`relative shrink-0 px-3.5 pt-1 pb-3 text-[0.95rem] transition-colors ${tab === t.id ? "text-ink" : "text-ink-soft hover:text-ink"}`}
                  >
                    {t.label}
                    {tab === t.id && <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-ink" />}
                  </button>
                ))}
              </div>
              <div role="tabpanel" className="pt-7">
                {tab === "discussion" && <Discussion turns={view.discussion!} />}
                {tab === "notes" && <Notes />}
                {tab === "compare" && <Compare s={view.synthesis!} />}
                {tab === "plan" && <Plan s={view.synthesis!} />}
                {tab === "ask" && <Ask />}
              </div>
              <p className="mt-12 text-xs text-ink-faint">
                Reviewers are AI interpretations based on each person&apos;s published work. They did not watch or endorse this video.
              </p>
            </>
          )}

          {finished && (
            <div className="mt-6 text-xs">
              {confirmDelete ? (
                <span className="text-ink-soft">
                  Delete this review and its video?{" "}
                  <button
                    onClick={async () => {
                      await fetch(`/api/reviews/${id}`, { method: "DELETE" });
                      router.push("/reviews");
                    }}
                    className="text-warn underline underline-offset-2"
                  >
                    Delete
                  </button>{" "}
                  <button onClick={() => setConfirmDelete(false)} className="underline underline-offset-2">
                    Cancel
                  </button>
                </span>
              ) : (
                <button onClick={() => setConfirmDelete(true)} className="text-ink-faint underline decoration-line-strong underline-offset-2 hover:text-ink-soft">
                  Delete this review
                </button>
              )}
            </div>
          )}
        </section>
      </main>
    </RoomContext.Provider>
  );
}
