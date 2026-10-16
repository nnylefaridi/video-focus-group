"use client";

import { useEffect, useState } from "react";
import { Figure } from "./Figure";
import { lookFor } from "./looks";

export type PuppetState = "idle" | "speaking" | "thinking";

/**
 * A paper cutout on a popsicle stick. The whole puppet pivots around the bottom
 * of the stick; when speaking it wags in that reviewer's rhythm, with the
 * occasional emphatic bounce or shake, like a child puppeteering from below.
 */
export function Puppet({
  id,
  name,
  state = "idle",
  stick = 0.5,
  delay = 0,
  className = "",
}: {
  id: string;
  name: string;
  state?: PuppetState;
  /** Stick length below the figure, as a fraction of the figure's height. */
  stick?: number;
  delay?: number;
  className?: string;
}) {
  const look = lookFor(id);
  const [jolt, setJolt] = useState<0 | 1 | 2>(0);

  useEffect(() => {
    if (state !== "speaking") return;
    let t: ReturnType<typeof setTimeout>;
    let clear: ReturnType<typeof setTimeout>;
    const schedule = () => {
      t = setTimeout(() => {
        setJolt(Math.random() < 0.6 ? 1 : 2);
        clear = setTimeout(() => setJolt(0), 520);
        schedule();
      }, 1600 + Math.random() * 2200);
    };
    schedule();
    return () => {
      clearTimeout(t);
      clearTimeout(clear);
      setJolt(0);
    };
  }, [state]);

  // Pivot at the bottom of the stick, which extends below the figure's box.
  const origin = `50% ${100 + stick * 100}%`;
  return (
    <div
      className={`puppet ${className}`}
      data-state={state}
      data-style={look.wag}
      style={{
        transformOrigin: origin,
        ["--delay" as string]: `${delay}s`,
        ["--idle-dur" as string]: `${5 + (delay % 2)}s`,
      }}
    >
      <div className="puppet-jolt relative" data-jolt={jolt || undefined} style={{ transformOrigin: origin }}>
        {/* the popsicle stick, behind the cutout */}
        <div
          aria-hidden
          className="absolute left-1/2 -translate-x-1/2 rounded-b-full"
          style={{
            top: "80%",
            width: "7%",
            height: `${stick * 100 + 20}%`,
            background: "var(--wood)",
            boxShadow: "inset -2px 0 0 rgb(150 110 60 / 0.18), 0 2px 4px rgb(40 52 70 / 0.15)",
          }}
        />
        <Figure look={look} title={name} className="relative block h-auto w-full drop-shadow-sm" />
      </div>
    </div>
  );
}
