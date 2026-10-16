import Link from "next/link";

export default function NotFound() {
  return (
    <main className="mx-auto max-w-xl px-4 py-24 text-center">
      <h1 className="font-serif text-3xl text-ink">There&apos;s nothing here</h1>
      <p className="mt-3 text-ink-soft">That page doesn&apos;t exist, or it was deleted.</p>
      <Link href="/" className="mt-8 inline-block rounded-full bg-accent px-6 py-2.5 text-accent-ink transition-all hover:brightness-110">
        Start a new review
      </Link>
    </main>
  );
}
