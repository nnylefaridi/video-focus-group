import Link from "next/link";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { accountGate } from "@/server/account";
import { getViewer } from "@/server/auth";

export const metadata = { title: "Payment cancelled · Video Focus Group" };

/** Where Stripe Checkout sends people who back out before paying (hosted mode). */
export default async function TopupCancelledPage() {
  await connection();
  const gate = accountGate(await getViewer());
  if ("redirect" in gate) redirect(gate.redirect);
  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-12 sm:py-16">
      <h1 className="font-display text-[2rem] font-extrabold text-ink">Payment cancelled</h1>
      <div className="cutout-lift mt-8 -rotate-[0.3deg] p-6 sm:p-8">
        <p className="text-ink-soft">Nothing was charged, and your balance hasn&apos;t changed.</p>
        <Link href="/account#credits" className="mt-5 inline-block rounded-full bg-accent px-6 py-2.5 font-bold text-accent-ink transition-all hover:brightness-110">
          Back to your account
        </Link>
      </div>
    </main>
  );
}
