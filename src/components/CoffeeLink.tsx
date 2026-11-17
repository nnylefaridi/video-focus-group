"use client";

import { usePathname } from "next/navigation";
import { useEffect, useSyncExternalStore } from "react";
import { Cup } from "./Icons";

// Whether the flow on the start page has moved past its first screen (the first question,
// nothing answered yet). That screen is only the question and its answer box, so the tag
// stays off it. The server always renders the start page as that first screen.
let pastFirstScreen = false;
const listeners = new Set<() => void>();
const subscribe = (l: () => void) => (listeners.add(l), () => void listeners.delete(l));
function setPastFirstScreen(v: boolean) {
  if (v === pastFirstScreen) return;
  pastFirstScreen = v;
  listeners.forEach((l) => l());
}

/** Used by the flow: tells the tag whether the first screen is showing. */
export function useFirstScreen(first: boolean) {
  useEffect(() => {
    setPastFirstScreen(!first);
    return () => setPastFirstScreen(false);
  }, [first]);
}

export function showCoffeeLink(pathname: string, pastFirst: boolean): boolean {
  return pathname !== "/" || pastFirst;
}

/** A small paper tag in the corner: bottom-right on desktop, top-right on phones (clear of the review tab bar). */
export function CoffeeLink() {
  const pathname = usePathname();
  const pastFirst = useSyncExternalStore(subscribe, () => pastFirstScreen, () => false);
  if (!showCoffeeLink(pathname, pastFirst)) return null;
  return (
    <a
      href="https://buymeacoffee.com/nylefaridi"
      target="_blank"
      rel="noopener noreferrer"
      className="cutout fixed top-3 right-3 z-30 inline-flex rotate-[-1.5deg] items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-extrabold text-ink-soft transition-all hover:rotate-0 hover:text-ink hover:shadow-lift lg:top-auto lg:right-5 lg:bottom-5 lg:px-3.5 lg:py-2 lg:text-[0.8rem]"
    >
      <Cup className="h-4 w-4 text-accent" />
      Buy me a coffee
    </a>
  );
}
