import Link from "next/link";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { accountFor } from "@/server/account";
import { getViewer } from "@/server/auth";
import { API_KEY_ANCHOR } from "@/core/ownkey";
import { CREDITS_ANCHOR, formatMicros, type HistoryEntry, type OpenReservation } from "@/core/credits";
import { ApiKeyPanel } from "@/components/account/ApiKeyPanel";
import { CreditsPanel } from "@/components/account/CreditsPanel";
import { PaymentMethodPanel } from "@/components/account/PaymentMethodPanel";
import { SignOut } from "@/components/account/SignOut";

export const metadata = { title: "Your account · Video Focus Group" };

const when = (at: number) => new Date(at).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
const shown = (n: number) => formatMicros(Math.abs(n));

const KIND_SIGN: Record<HistoryEntry["kind"], string> = { topup: "+", charge: "−", release: "+", adjustment: "−" };

function Reservations({ list }: { list: OpenReservation[] }) {
  if (list.length === 0) return <p className="text-sm text-ink-soft">Nothing is set aside right now.</p>;
  return (
    <ul className="space-y-1.5 text-sm">
      {list.map((r) => (
        <li key={r.id} className="flex items-baseline justify-between gap-3">
          <span className="min-w-0 truncate text-ink">
            <Link href={`/r/${r.reviewId}`} className="underline decoration-line-strong underline-offset-4 hover:text-accent">
              {r.reviewTitle ?? "A review"}
            </Link>
            <span className="text-ink-soft"> · {r.purpose === "followup" ? "follow-up answer" : "review"} running</span>
          </span>
          <span className="shrink-0 font-semibold text-ink-soft">up to {shown(r.amount)}</span>
        </li>
      ))}
    </ul>
  );
}

function History({ list }: { list: HistoryEntry[] }) {
  if (list.length === 0) return <p className="text-sm text-ink-soft">No credit activity yet.</p>;
  return (
    <ul className="divide-y divide-line text-sm">
      {list.map((e) => (
        <li key={e.id} className="flex items-baseline justify-between gap-3 py-2">
          <span className="min-w-0 text-ink">
            {e.reviewId ? (
              <Link href={`/r/${e.reviewId}`} className="underline decoration-line-strong underline-offset-4 hover:text-accent">
                {e.reviewTitle ?? "A review"}
              </Link>
            ) : null}
            {e.reviewId ? <span className="text-ink-soft"> · {e.detail.toLowerCase()}</span> : e.detail}
            <span className="block text-xs text-ink-faint" suppressHydrationWarning>
              {when(e.at)}
            </span>
          </span>
          <span className="shrink-0 font-semibold text-ink">
            {KIND_SIGN[e.kind]}
            {shown(e.amount)}
          </span>
        </li>
      ))}
    </ul>
  );
}

const card = "cutout mt-6 scroll-mt-6 space-y-3 p-5";
const heading = "font-display text-lg font-extrabold text-ink";

/** Hosted mode: the signed-in account's billing, payment choice, API key and sign-out. Local mode has no accounts. */
export default async function AccountPage() {
  await connection();
  const viewer = await getViewer();
  const result = await accountFor(viewer);
  if ("redirect" in result) redirect(result.redirect);
  const { payment, history, reservations } = result.view;
  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-12 sm:py-16">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-[2rem] font-extrabold text-ink">Your account</h1>
        <Link href="/" className="rounded-full bg-accent px-5 py-2 text-sm text-accent-ink transition-all hover:brightness-110">
          New review
        </Link>
      </div>
      <p className="mt-2 text-sm text-ink-soft">
        {viewer.email ? <>Signed in as {viewer.email} · </> : null}
        <SignOut />
      </p>

      <section id={CREDITS_ANCHOR} aria-labelledby="billing" className={card}>
        <h2 id="billing" className={heading}>
          Billing and usage
        </h2>
        {payment.method === "own_key" && <p className="text-sm text-ink-soft">Your reviews use your own Anthropic API key right now, so credits aren&apos;t being spent.</p>}
        <CreditsPanel initial={payment} from="account" />
        <div className="border-t border-line pt-3">
          <h3 className="mb-2 text-sm font-bold text-ink">Set aside for what&apos;s running</h3>
          <Reservations list={reservations} />
        </div>
        <div className="border-t border-line pt-3">
          <h3 className="mb-1 text-sm font-bold text-ink">History</h3>
          <History list={history} />
        </div>
      </section>

      <section aria-labelledby="payment-method" className={card}>
        <h2 id="payment-method" className={heading}>
          How you pay
        </h2>
        <PaymentMethodPanel initial={payment} />
      </section>

      <section id={API_KEY_ANCHOR} aria-labelledby="own-key" className={card}>
        <h2 id="own-key" className={heading}>
          Your Anthropic API key
        </h2>
        <p className="text-sm text-ink-soft">
          {payment.method === "own_key"
            ? "Your reviews and follow-up questions run on this key, billed by Anthropic. Video Focus Group charges nothing for them."
            : "Save one to pay for reviews with your own key. It's only used when you choose that above."}
        </p>
        <ApiKeyPanel initial={payment.key} />
      </section>

      <section aria-labelledby="past-reviews" className={card}>
        <h2 id="past-reviews" className={heading}>
          Past reviews
        </h2>
        <p className="text-sm text-ink-soft">
          Every review you&apos;ve made, with its video and follow-up chats.{" "}
          <Link href="/reviews" className="font-semibold text-ink underline decoration-line-strong underline-offset-4 hover:text-accent">
            See your reviews
          </Link>
        </p>
      </section>
    </main>
  );
}
