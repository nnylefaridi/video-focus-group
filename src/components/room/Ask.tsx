"use client";

import { useEffect, useRef, useState } from "react";
import { Avatar } from "../Avatar";
import { ArrowUp, Eye, Spinner } from "../Icons";
import { useRoom } from "./context";
import { CitedText, PrincipleChips, principleIdsIn } from "./Evidence";
import { formatTime } from "@/core/evidence";

type Msg = { role: "user" | "assistant"; text: string };

/** Follow-up conversation with one reviewer. Answers stream in; the reviewer can take a closer look at a moment. */
export function Ask() {
  const { view, card, currentTime, setSpeaking } = useRoom();
  const [who, setWho] = useState(view.board[0]?.id ?? "");
  const [threads, setThreads] = useState<Record<string, Msg[]>>({});
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const c = card(who);
  const msgs = threads[who] ?? [];

  useEffect(() => {
    if (!who || threads[who]) return;
    fetch(`/api/reviews/${view.id}/chat?reviewer=${encodeURIComponent(who)}`)
      .then((r) => r.json())
      .then((d: { messages: { role: Msg["role"]; text: string }[] }) => setThreads((t) => ({ ...t, [who]: d.messages ?? [] })))
      .catch(() => setThreads((t) => ({ ...t, [who]: [] })));
  }, [who, threads, view.id]);

  useEffect(() => endRef.current?.scrollIntoView({ block: "nearest" }), [msgs.length, busy]);

  async function send(text: string) {
    const message = text.trim();
    if (!message || busy || !who) return;
    setBusy(true);
    setError(null);
    setDraft("");
    setThreads((t) => ({ ...t, [who]: [...(t[who] ?? []), { role: "user", text: message }, { role: "assistant", text: "" }] }));
    setSpeaking(who);
    const append = (s: string, replace = false) =>
      setThreads((t) => {
        const list = [...(t[who] ?? [])];
        const last = list[list.length - 1];
        list[list.length - 1] = { ...last, text: replace ? s : last.text + s };
        return { ...t, [who]: list };
      });
    try {
      const res = await fetch(`/api/reviews/${view.id}/chat`, { method: "POST", body: JSON.stringify({ reviewerId: who, message }) });
      if (!res.ok || !res.body) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error ?? "The reviewer couldn't answer just now.");
      }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          if (!line) continue;
          const ev = JSON.parse(line);
          if (ev.type === "text") {
            setStatus(null);
            append(ev.text);
          } else if (ev.type === "inspecting") setStatus(`Taking a closer look around ${formatTime(ev.seconds)}…`);
          else if (ev.type === "done") append(ev.text, true);
          else if (ev.type === "error") throw new Error(ev.error);
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
      setThreads((t) => ({ ...t, [who]: (t[who] ?? []).filter((m, i, a) => !(i === a.length - 1 && m.role === "assistant" && !m.text)) }));
    } finally {
      setBusy(false);
      setStatus(null);
      setSpeaking(null);
    }
  }

  if (!c) return null;

  return (
    <div>
      <div className="flex flex-wrap gap-3" role="radiogroup" aria-label="Who to ask">
        {view.board.map((b) => (
          <button
            key={b.id}
            role="radio"
            aria-checked={who === b.id}
            onClick={() => setWho(b.id)}
            disabled={busy}
            className={`flex items-center gap-2 rounded-full border py-1 pr-4 pl-1 transition-colors ${who === b.id ? "border-accent bg-accent-soft" : "border-line hover:border-line-strong"}`}
          >
            <Avatar card={b} size={30} />
            <span className="text-sm text-ink">{b.name}</span>
          </button>
        ))}
      </div>

      <div className="mt-6 space-y-4">
        {msgs.length === 0 && (
          <p className="text-ink-soft">
            Ask {c.name.split(" ")[0]} anything about this video: why they flagged something, how they&apos;d fix a moment, or to look closer at a specific second.
          </p>
        )}
        {msgs.map((m, i) =>
          m.role === "user" ? (
            <div key={i} className="ml-auto max-w-[85%] rounded-2xl rounded-tr-md bg-paper-deep px-4 py-2.5 text-ink">
              {m.text}
            </div>
          ) : (
            <div key={i} className="flex gap-3">
              <Avatar card={c} size={34} state={busy && i === msgs.length - 1 ? "speaking" : "idle"} />
              <div className="min-w-0 flex-1">
                <div className="rounded-2xl rounded-tl-md px-4 py-3 leading-relaxed whitespace-pre-wrap text-ink" style={{ background: `${c.color}38` }}>
                  {m.text ? <CitedText text={m.text} /> : <span className="text-ink-soft">Thinking…</span>}
                </div>
                {!busy && <PrincipleChips ids={principleIdsIn(m.text)} />}
              </div>
            </div>
          ),
        )}
        {status && (
          <p className="flex items-center gap-2 text-sm text-ink-soft">
            <Eye className="h-4 w-4" /> {status}
          </p>
        )}
        <div ref={endRef} />
      </div>

      {error && (
        <p role="alert" className="mt-4 rounded-xl bg-warn-soft px-4 py-2.5 text-sm text-warn">
          {error}
        </p>
      )}

      <div className="mt-5">
        <button
          onClick={() => send(`What do you see happening around ${formatTime(currentTime)}? Take a close look.`)}
          disabled={busy}
          className="mb-3 rounded-full border border-line px-3.5 py-1.5 text-sm text-ink-soft transition-colors hover:border-line-strong hover:text-ink disabled:opacity-50"
        >
          Ask about {formatTime(currentTime)}
        </button>
        <div className="relative rounded-[1.3rem] border border-line bg-card shadow-soft focus-within:border-line-strong">
          <label htmlFor="ask" className="sr-only">
            Ask {c.name}
          </label>
          <textarea
            id="ask"
            rows={2}
            value={draft}
            maxLength={2000}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send(draft);
              }
            }}
            placeholder={`Ask ${c.name.split(" ")[0]}…`}
            className="block w-full resize-none bg-transparent px-4 pt-3.5 pb-12 text-ink outline-none placeholder:text-ink-faint"
          />
          <button
            onClick={() => send(draft)}
            disabled={!draft.trim() || busy}
            aria-label="Send"
            className="absolute right-2.5 bottom-2.5 grid h-9 w-9 place-items-center rounded-full bg-accent text-accent-ink transition-all hover:brightness-110 disabled:bg-paper-deep disabled:text-ink-faint"
          >
            {busy ? <Spinner className="h-4 w-4" /> : <ArrowUp className="h-4 w-4" />}
          </button>
        </div>
      </div>
    </div>
  );
}
