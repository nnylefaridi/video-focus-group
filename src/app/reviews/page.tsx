import Link from "next/link";
import { Suspense } from "react";
import { headers } from "next/headers";
import { connection } from "next/server";
import { listReviewsFor } from "@/server/reviews";
import { getProfile } from "@/experts/load";
import { STAGE_LABELS } from "@/core/review";
import { spendSummary, usageFor } from "@/server/budget";
import { claimForViewer, getViewer } from "@/server/auth";
import { whoIsCalling } from "@/server/client";
import { SignOut } from "@/components/account/SignOut";

const isOwner = (email: string | null) =>
  Boolean(email && (process.env.OWNER_EMAILS ?? "").split(",").map((e) => e.trim().toLowerCase()).includes(email.toLowerCase()));

function Meter({ label, used, max, note }: { label: string; used: number; max: number; note: string }) {
  const left = Math.max(0, max - used);
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span className="font-bold text-ink">{label}</span>
        <span className="font-semibold text-ink-soft">
          {Math.min(used, max)} of {max} used
        </span>
      </div>
      <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-paper-deep" role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={max} aria-valuenow={Math.min(used, max)}>
        <div className={`h-full rounded-full ${left === 0 ? "bg-warn" : "bg-accent"}`} style={{ width: `${Math.min(100, (used / max) * 100)}%` }} />
      </div>
      <p className="mt-1 text-xs text-ink-faint">{note}</p>
    </div>
  );
}

async function Usage({ email, userId }: { email: string | null; userId: string }) {
  const u = await usageFor(whoIsCalling(await headers(), userId));
  const owner = isOwner(email) ? await spendSummary() : null;
  const m = (n: number) => `$${n.toFixed(2)}`;
  return (
    <section aria-labelledby="usage" className="cutout mt-6 space-y-4 p-5">
      <h2 id="usage" className="font-display text-lg font-extrabold text-ink">
        Your limits
      </h2>
      <Meter label="Reviews today" used={u.reviewsToday} max={u.maxReviewsPerDay} note="Resets at midnight." />
      <Meter label="Answers checked this hour" used={u.answerChecksLastHour} max={u.maxAnswerChecksPerHour} note="Counts the last 60 minutes." />
      <p className="text-sm text-ink-soft">Each review can take up to {u.maxFollowupsPerReview} follow-up questions.</p>
      {owner && (
        <p className="border-t border-line pt-3 text-sm font-semibold text-ink-soft">
          App API spend: {m(owner.today)} of {m(owner.dailyLimit)} today · {m(owner.month)} of {m(owner.monthlyLimit)} this month
        </p>
      )}
    </section>
  );
}

async function List({ userId }: { userId: string }) {
  const reviews = (await listReviewsFor(userId)).filter((r) => r.stage !== "uploading");
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
          <Link href={`/r/${r.id}`} className="flex items-center gap-4 cutout p-4 transition-shadow hover:shadow-soft">
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

/** Signed out: explain why an account is needed, and send them to log in. */
function LoginGate() {
  return (
    <div className="cutout-lift mt-8 -rotate-[0.3deg] p-6 sm:p-8">
      <h2 className="font-display text-xl font-extrabold text-ink">Log in to keep a record of your reviews</h2>
      <p className="mt-2 text-ink-soft">
        Without an account, a review stays with the browser that made it and isn&apos;t listed anywhere. Log in or sign up, and the reviews you&apos;ve made in this browser, with their videos, move into your account.
      </p>
      <Link href="/login?next=/reviews" className="mt-5 inline-block rounded-full bg-accent px-6 py-2.5 font-bold text-accent-ink transition-all hover:brightness-110">
        Log in or sign up
      </Link>
    </div>
  );
}

async function Account() {
  // Limits depend on the current time, so this always renders per request.
  await connection();
  const viewer = await getViewer();
  if (!viewer.userId) return <LoginGate />;
  await claimForViewer(viewer);
  return (
    <>
      <p className="mt-2 text-sm text-ink-soft">
        {viewer.email ? <>Signed in as {viewer.email} · </> : null}
        <SignOut />
      </p>
      <Usage email={viewer.email} userId={viewer.userId} />
      <List userId={viewer.userId} />
    </>
  );
}

export default function ReviewsPage() {
  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-12 sm:py-16">
      <div className="flex items-center justify-between">
        <h1 className="font-display font-extrabold text-[2rem] text-ink">Your reviews</h1>
        <Link href="/" className="rounded-full bg-accent px-5 py-2 text-sm text-accent-ink transition-all hover:brightness-110">
          New review
        </Link>
      </div>
      <Suspense fallback={<p className="mt-8 animate-pulse font-semibold text-ink-soft">Opening your reviews…</p>}>
        <Account />
      </Suspense>
    </main>
  );
}
