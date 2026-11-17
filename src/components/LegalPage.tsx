import Link from "next/link";

/** Shell for the privacy and terms pages: a plain reading page in the app's paper style. */
export function LegalPage({ title, updated, children }: { title: string; updated: string; children: React.ReactNode }) {
  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-12 sm:py-16">
      <Link href="/" className="text-sm text-ink-soft hover:text-ink">
        Back
      </Link>
      <h1 className="mt-6 font-display text-[2rem] font-extrabold text-ink">{title}</h1>
      <p className="mt-1 text-sm text-ink-faint">Last updated {updated}</p>
      <div className="mt-6 space-y-8 text-ink-soft">{children}</div>
    </main>
  );
}

export function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="font-display text-lg font-extrabold text-ink">{title}</h2>
      {children}
    </section>
  );
}

export function Points({ items }: { items: React.ReactNode[] }) {
  return (
    <ul className="list-disc space-y-1.5 pl-5">
      {items.map((x, i) => (
        <li key={i}>{x}</li>
      ))}
    </ul>
  );
}
