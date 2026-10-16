"use client";

import { useEffect, useRef } from "react";
import { formatTime } from "@/core/evidence";
import { useRoom } from "./context";

/** A dot on the timeline for one piece of feedback; `key` is the id of its note on the page. */
export type Marker = { t: number; color: string; label: string; key: string };

/**
 * A flat, front-facing video player in a white paper frame. Never skewed or put
 * in perspective. "stage" is the big boardroom player; "compact" adds the
 * reviewer timeline markers for the analysis sections.
 */
export function Player({
  variant,
  seekRequest,
  onTime,
  markers = [],
  onMarker,
}: {
  variant: "stage" | "compact";
  seekRequest: { t: number; n: number } | null;
  onTime: (t: number) => void;
  markers?: Marker[];
  onMarker?: (m: Marker) => void;
}) {
  const { view, seek, currentTime } = useRoom();
  const ref = useRef<HTMLVideoElement>(null);
  const startAt = useRef(currentTime);
  const v = view.video;
  const aspect = v ? v.width / v.height : 16 / 9;
  // Vertical videos get a shorter cap so the caption under the stage player stays in view.
  const maxH = variant === "stage" ? (aspect < 1 ? "min(52vh, 88vw)" : "58vh") : "min(52vh, 88vw)";

  useEffect(() => {
    const el = ref.current;
    if (!el || !seekRequest) return;
    el.currentTime = seekRequest.t;
  }, [seekRequest]);

  const duration = v?.durationSec ?? 0;

  return (
    <div className="mx-auto" style={{ width: `min(100%, calc(${maxH} * ${aspect}))` }}>
      <div className="rounded-[1.1rem] bg-white p-[6px] shadow-lift ring-1 ring-black/5">
        {v?.url ? (
          <video
            ref={ref}
            src={v.url}
            poster={v.poster ?? undefined}
            controls
            playsInline
            preload="metadata"
            onLoadedMetadata={(e) => {
              if (startAt.current > 0) e.currentTarget.currentTime = startAt.current;
            }}
            onTimeUpdate={(e) => onTime(e.currentTarget.currentTime)}
            className="block w-full rounded-[0.8rem] bg-ink"
            style={{ aspectRatio: `${aspect}` }}
          >
            {v.captions && <track kind="captions" src={v.captions} srcLang="en" label="English" />}
          </video>
        ) : (
          <div className="grid w-full place-items-center rounded-[0.8rem] bg-paper-deep text-sm text-ink-soft" style={{ aspectRatio: `${aspect}` }}>
            Preparing your video…
          </div>
        )}
      </div>

      {variant === "compact" && duration > 0 && markers.length > 0 && (
        <div className="mt-3">
          <div
            role="slider"
            tabIndex={0}
            aria-label="Moments the reviewers commented on"
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
            className="relative h-8 cursor-pointer"
          >
            <div className="absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-paper-deep" />
            <div className="absolute top-1/2 left-0 h-1.5 -translate-y-1/2 rounded-full bg-line-strong" style={{ width: `${(currentTime / duration) * 100}%` }} />
            {markers.map((m) => (
              <button
                key={m.key}
                title={m.label}
                aria-label={`${formatTime(m.t)}: ${m.label}`}
                onClick={(e) => {
                  e.stopPropagation();
                  seek(m.t);
                  onMarker?.(m);
                }}
                className="absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white transition-transform hover:scale-125"
                style={{ left: `${(m.t / duration) * 100}%`, background: m.color }}
              />
            ))}
            <div className="absolute top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-full bg-ink" style={{ left: `${(currentTime / duration) * 100}%` }} />
          </div>
          <div className="flex justify-between text-xs font-semibold text-ink-soft tabular-nums">
            <span>{formatTime(currentTime)}</span>
            <span>{formatTime(duration)}</span>
          </div>
        </div>
      )}
    </div>
  );
}
