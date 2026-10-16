"use client";

import dynamic from "next/dynamic";

/** The flow reads this tab's saved progress on first render, so it renders on the client only. */
export const FlowLoader = dynamic(() => import("./Flow").then((m) => m.Flow), { ssr: false });
