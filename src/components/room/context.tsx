"use client";

import { createContext, useContext } from "react";
import type { ReviewView } from "@/core/view";
import type { ExpertCard } from "@/core/expert";

export type RoomCtx = {
  view: ReviewView;
  seek: (t: number) => void;
  currentTime: number;
  card: (id: string) => ExpertCard | undefined;
  speaking: string | null;
  setSpeaking: (id: string | null) => void;
};

export const RoomContext = createContext<RoomCtx | null>(null);

export function useRoom(): RoomCtx {
  const c = useContext(RoomContext);
  if (!c) throw new Error("useRoom outside RoomContext");
  return c;
}
