import { redirect } from "next/navigation";
import { connection } from "next/server";
import { accountGate } from "@/server/account";
import { getViewer } from "@/server/auth";
import { TopupReturn } from "@/components/account/TopupReturn";

export const metadata = { title: "Adding your credits · Video Focus Group" };

/** Where Stripe Checkout sends people after paying (hosted mode). Shows whether the ledger has the credit yet. */
export default async function TopupDonePage({ searchParams }: { searchParams: Promise<{ session_id?: string }> }) {
  await connection();
  const gate = accountGate(await getViewer());
  if ("redirect" in gate) redirect(gate.redirect);
  const { session_id } = await searchParams;
  const session = session_id && /^cs_[A-Za-z0-9_]{1,250}$/.test(session_id) ? session_id : null;
  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-12 sm:py-16">
      <h1 className="font-display text-[2rem] font-extrabold text-ink">Thanks for your payment</h1>
      <TopupReturn session={session} />
    </main>
  );
}
