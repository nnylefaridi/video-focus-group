import { Cup } from "./Icons";

/** A small paper tag in the corner: bottom-right on desktop, top-right on phones (clear of the review tab bar). */
export function CoffeeLink() {
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
