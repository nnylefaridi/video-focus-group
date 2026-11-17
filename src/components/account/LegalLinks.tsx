import Link from "next/link";

/** Small quiet links to the privacy and terms pages. Only for screens after the first. */
export function LegalLinks({ className = "" }: { className?: string }) {
  return (
    <p className={`text-xs text-ink-faint ${className}`}>
      <Link href="/privacy" className="underline underline-offset-2 hover:text-ink">
        Privacy
      </Link>
      {" · "}
      <Link href="/terms" className="underline underline-offset-2 hover:text-ink">
        Terms
      </Link>
    </p>
  );
}
