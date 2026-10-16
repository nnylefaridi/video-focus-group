"use client";

import { useEffect, useMemo, useRef } from "react";
import { deriveSpan, formatTime, type Ledger } from "@/core/evidence";
import { useRoom } from "./context";

type Marker = { t: number; color: string; label: string; key: string };

export function Player({ seekRequest, onTime }: { seekRequest: { t: number; n: number } | null; onTime: (t: number) => void }) {
  const { view, seek, currentTime, card } = useRoom();
  const ref = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const v = ref.current;
    if (!v || !seekRequest) return;
    v.currentTime = seekRequest.t;
    v.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [seekRequest]);
  const duration = view.video?.durationSec ?? 0;
  const vertical = (view.video?.height ?? 16) > (view.video?.width ?? 9);

  const markers = useMemo<Marker[]>(() => {
    if (!view.ledger || !view.notes) return [];
    const l = view.ledger as unknown as Ledger;
    return Object.entries(view.notes).flatMap(([rid, n]) =>
      n.observations.flatMap((o) => {
        const s = deriveSpan(l, o.evidenceIds);
        return s ? [{ t: s.start, color: card(rid)?.color ?? "#ccc", label: `${card(rid)?.name}: ${o.claim}`, key: `${rid}-${o.id}` }] : [];
      }),
    );
  }, [view.ledger, view.notes, card]);

  return (
    <div>
      <div className={`overflow-hidden rounded-2xl bg-ink ${vertical ? "mx-auto max-h-[36vh] w-fit lg:max-h-[68vh]" : ""}`}>
        {view.video?.url ? (
          <video
            ref={ref}
            src={view.video.url}
            poster={view.video.poster ?? undefined}
            controls
            playsInline
            preload="metadata"
            onTimeUpdate={(e) => onTime(e.currentTarget.currentTime)}
            className={`block ${vertical ? "max-h-[36vh] lg:max-h-[68vh]" : "w-full"}`}
          />
        ) : (
          <div className="grid aspect-[9/16] max-h-[36vh] place-items-center text-sm text-paper/70">Preparing video…</div>
        )}
      </div>

      {duration > 0 && (
        <div className="mt-4">
          <div
            role="slider"
            tabIndex={0}
            aria-label="Timeline"
            aria-valuemin={0}
            aria-valuemax={Math.round(duration)}
            aria-valuenow={Math.round(currentTime)}
            aria-valuetext={formatTime(currentTime)}
            onKeyDown={(e) => {
              if (e.key === "ArrowRight") seek(Math.min(duration, currentTime + 1));
              if (e.key === "ArrowLeft") seek(Math.max(0, currentTime - 1));
            }}
            onClick={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              seek(((e.clientX - r.left) / r.width) * duration);
            }}
            className="relative h-9 cursor-pointer"
          >
            <div className="absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-paper-deep" />
            <div className="absolute top-1/2 left-0 h-1.5 -translate-y-1/2 rounded-full bg-line-strong" style={{ width: `${(currentTime / duration) * 100}%` }} />
            {view.ledger?.shots.slice(1).map((s) => (
              <div key={s.id} className="absolute top-1/2 h-3 w-px -translate-y-1/2 bg-line-strong" style={{ left: `${(s.start / duration) * 100}%` }} />
            ))}
            {markers.map((m) => (
              <button
                key={m.key}
                title={m.label}
                aria-label={`${formatTime(m.t)}: ${m.label}`}
                onClick={(e) => {
                  e.stopPropagation();
                  seek(m.t);
                }}
                className="absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-paper transition-transform hover:scale-125"
                style={{ left: `${(m.t / duration) * 100}%`, background: m.color }}
              />
            ))}
            <div className="absolute top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-full bg-ink" style={{ left: `${(currentTime / duration) * 100}%` }} />
          </div>
          <div className="flex justify-between font-mono text-xs text-ink-soft tabular-nums">
            <span>{formatTime(currentTime)}</span>
            <span>{formatTime(duration)}</span>
          </div>
        </div>
      )}
    </div>
  );
}
