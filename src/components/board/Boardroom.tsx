"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import type { ExpertCard } from "@/core/expert";
import { Puppet, type PuppetState } from "../puppets/Puppet";
import { FIGURE_ASPECT } from "../puppets/Figure";

/*
  The paper puppet theatre: sage paper chairs, popsicle-stick puppets behind a
  folded origami table, and name cards on the table edge. Everything is laid out
  in a coordinate space 1000 units wide so it scales as one picture.
*/

const W = 1000;
// Top edge of the table top (left → right), in table units (table is 1000×420).
const EDGE: [number, number][] = [
  [24, 250],
  [140, 92],
  [340, 26],
  [660, 26],
  [860, 92],
  [976, 250],
];

function edgeY(x: number): number {
  for (let i = 0; i < EDGE.length - 1; i++) {
    const [x0, y0] = EDGE[i];
    const [x1, y1] = EDGE[i + 1];
    if (x >= x0 && x <= x1) return y0 + ((x - x0) / (x1 - x0)) * (y1 - y0);
  }
  return EDGE[0][1];
}

const SEATS: Record<number, number[]> = {
  1: [500],
  2: [370, 630],
  3: [250, 500, 750],
  4: [195, 400, 600, 805],
};

function useNarrow(ref: React.RefObject<HTMLElement | null>) {
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setNarrow(e.contentRect.width < 640));
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return narrow;
}

function OrigamiTable() {
  // An octagonal paper table top with a folded band for its thickness.
  const FRONT: [number, number][] = [
    [976, 250],
    [872, 366],
    [128, 366],
    [24, 250],
  ];
  const top = [...EDGE, ...FRONT.slice(1, 3)];
  const center: [number, number] = [500, 220];
  const fills = ["#FFFFFF", "#F0F1EE", "#F8F8F6", "#E8EAE6", "#F5F6F3", "#ECEDE9", "#FAFAF9", "#EEF0EC"];
  const band = 46;
  const skirt: [number, number][][] = [
    [[24, 250], [128, 366], [128, 366 + band], [24, 250 + band]],
    [[128, 366], [500, 366], [500, 366 + band], [128, 366 + band]],
    [[500, 366], [872, 366], [872, 366 + band], [500, 366 + band]],
    [[872, 366], [976, 250], [976, 250 + band], [872, 366 + band]],
  ];
  const skirtFills = ["#D7DAD4", "#E4E7E2", "#DEE1DB", "#D2D6CF"];
  const pts = (ps: [number, number][]) => ps.map(([x, y]) => `${x},${y}`).join(" ");
  return (
    <svg viewBox="0 0 1000 420" preserveAspectRatio="none" className="absolute inset-0 h-full w-full" aria-hidden>
      {skirt.map((p, i) => (
        <polygon key={`s${i}`} points={pts(p)} fill={skirtFills[i]} stroke="#D3D7D1" strokeWidth="1" />
      ))}
      {top.map((p, i) => {
        const q = top[(i + 1) % top.length];
        return <polygon key={i} points={pts([center, p, q])} fill={fills[i % fills.length]} stroke="#E1E4DF" strokeWidth="1.2" strokeLinejoin="round" />;
      })}
      <path d="M140 92 L270 366 M860 92 L730 366 M340 26 L420 366 M660 26 L580 366" stroke="#E2E5E0" strokeWidth="1" />
      <polyline points={pts(top.concat([top[0]]))} fill="none" stroke="#FFFFFF" strokeWidth="3" strokeLinejoin="round" />
      <polyline points={pts(FRONT)} fill="none" stroke="#CDD2CB" strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  );
}

export function Boardroom({
  board,
  states,
  onPick,
  children,
}: {
  board: ExpertCard[];
  states: Record<string, PuppetState>;
  onPick?: (id: string) => void;
  /** The flat video player (and anything under it), overlapping the front of the table. */
  children?: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const narrow = useNarrow(ref);
  const n = Math.min(4, Math.max(1, board.length));
  const xs = SEATS[n];
  // Stage proportions: taller on phones so the puppets stay big enough to read.
  const ratio = narrow ? 0.78 : 0.5;
  const tableTop = narrow ? 0.52 : 0.45; // where the table starts, as a fraction of stage height
  // Puppet width in stage units (the wider figure leaves room for gesturing hands).
  const puppetW = 1.2 * (narrow ? (n >= 4 ? 245 : n === 3 ? 300 : 320) : n >= 4 ? 190 : n === 3 ? 215 : 235);
  const figH = puppetW * FIGURE_ASPECT;
  const stageH = W * ratio;
  const tableH = stageH * (1 - tableTop);

  const yOnEdge = (x: number) => tableTop * stageH + (edgeY(x) / 420) * tableH;

  return (
    <div ref={ref} className="relative mx-auto w-full">
      <div className="relative w-full" style={{ aspectRatio: `${W} / ${stageH}` }}>
        {board.slice(0, 4).map((c, i) => {
          const x = xs[i];
          const tilt = n === 1 ? 0 : ((x - 500) / 500) * 7;
          // The table hides the lower chest, like puppets peeking over a real table.
          const bottom = yOnEdge(x) + figH * 0.3;
          return (
            <div key={c.id}>
              {/* chair back, a sage paper cutout behind the puppet */}
              <div
                aria-hidden
                className="absolute rounded-t-[42%] rounded-b-md"
                style={{
                  left: `${((x - puppetW * 0.42) / W) * 100}%`,
                  width: `${((puppetW * 0.84) / W) * 100}%`,
                  top: `${((bottom - figH * 0.74) / stageH) * 100}%`,
                  height: `${((figH * 0.62) / stageH) * 100}%`,
                  background: "var(--sage)",
                  boxShadow: "0 0 0 4px #fff, 0 4px 10px -4px rgb(40 52 70 / 0.25)",
                  transform: `rotate(${tilt * 0.6}deg)`,
                }}
              >
                <div className="absolute inset-x-[14%] top-[12%] bottom-0 rounded-t-[40%] bg-[var(--sage-deep)] opacity-25" />
              </div>
              {/* the puppet: bottom of the figure sits just behind the table edge */}
              <button
                type="button"
                onClick={onPick ? () => onPick(c.id) : undefined}
                disabled={!onPick}
                aria-label={onPick ? `Ask ${c.name} a question` : c.name}
                className="absolute z-[2] block cursor-pointer disabled:cursor-default"
                style={{
                  left: `${((x - puppetW / 2) / W) * 100}%`,
                  width: `${(puppetW / W) * 100}%`,
                  top: `${((bottom - figH) / stageH) * 100}%`,
                  // A speaking puppet is raised up from behind the table so its stick shows while it wags.
                  transform: `translateY(${states[c.id] === "speaking" ? "-34%" : "0"}) rotate(${tilt}deg)`,
                  transformOrigin: "50% 160%",
                  transition: "transform 0.5s cubic-bezier(0.34, 1.5, 0.64, 1)",
                }}
              >
                <Puppet id={c.id} name={c.name} state={states[c.id] ?? "idle"} delay={i * 0.7} stick={0.55} />
              </button>
            </div>
          );
        })}

        <div className="absolute inset-x-0 bottom-0 z-[3]" style={{ height: `${(1 - tableTop) * 100}%` }}>
          <OrigamiTable />
        </div>

        {/* name cards on the table edge */}
        {board.slice(0, 4).map((c, i) => {
          // Outer cards slide outward so the video in the middle never covers them.
          const outer = !narrow && Math.abs(xs[i] - 500) > 200;
          const x = outer ? xs[i] + (xs[i] - 500) * 0.36 : xs[i];
          const tilt = n === 1 ? 0 : ((x - 500) / 500) * 9;
          const y = yOnEdge(x) + figH * (outer ? 0.2 : 0.3);
          return (
            <div
              key={c.id}
              className="absolute z-[4] -translate-x-1/2 rounded-lg bg-white px-[0.9em] py-[0.45em] text-center leading-tight"
              style={{
                left: `${(x / W) * 100}%`,
                top: `${(y / stageH) * 100}%`,
                transform: `translateX(-50%) rotate(${tilt}deg)`,
                fontSize: narrow ? "clamp(9px, 2.6vw, 12px)" : "clamp(10px, 1.15vw, 15px)",
                boxShadow: "0 0 0 1px rgb(40 52 70 / 0.06), 0 3px 8px -3px rgb(40 52 70 / 0.3)",
              }}
            >
              <p className="font-extrabold whitespace-nowrap text-ink">{c.name}</p>
              <p className="whitespace-nowrap text-[0.8em] font-semibold text-ink-soft">{c.short}</p>
            </div>
          );
        })}
      </div>

      {children && (
        <div className="relative z-[5]" style={{ marginTop: narrow ? "-9%" : "-14%" }}>
          {children}
        </div>
      )}
    </div>
  );
}
