import Link from "next/link";
import { Suspense } from "react";
import { connection } from "next/server";
import { listReviews } from "@/server/reviews";
import { getProfile } from "@/experts/load";
import { STAGE_LABELS } from "@/core/review";

async function List() {
  await connection();
  const reviews = listReviews().filter((r) => r.stage !== "uploading");
  if (reviews.length === 0) {
    return (
      <p className="mt-8 text-ink-soft">
        No reviews yet.{" "}
        <Link href="/" className="text-ink underline underline-offset-4">
          Start one
        </Link>
        .
      </p>
    );
  }
  return (
    <ul className="mt-8 space-y-3">
      {reviews.map((r) => (
        <li key={r.id}>
          <Link href={`/r/${r.id}`} className="flex items-center gap-4 rounded-2xl border border-line bg-card p-4 transition-shadow hover:shadow-soft">
            <div className="flex -space-x-2">
              {r.board.map((b) => {
                const p = getProfile(b);
                return p ? (
                  <span key={b} className="grid h-8 w-8 place-items-center rounded-full border-2 border-card text-[0.7rem] font-medium" style={{ background: p.art.color }}>
                    {p.art.initials}
                  </span>
                ) : null;
              })}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-ink">{r.title}</p>
              <p className="text-sm text-ink-soft">
                {new Date(r.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                {r.stage !== "done" ? ` · ${STAGE_LABELS[r.stage]}` : ""}
              </p>
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}

export default function ReviewsPage() {
  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-12 sm:py-16">
      <div className="flex items-center justify-between">
        <h1 className="font-serif text-[2rem] text-ink">Your reviews</h1>
        <Link href="/" className="rounded-full bg-accent px-5 py-2 text-sm text-accent-ink transition-all hover:brightness-110">
          New review
        </Link>
      </div>
      <Suspense>
        <List />
      </Suspense>
    </main>
  );
}
