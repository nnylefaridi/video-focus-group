import Link from "next/link";
import { AccountMenu } from "../account/AccountMenu";

/**
 * Hosted mode: the first-screen control at the top right. Signed out, a solid
 * Log in / Sign up button. Signed in, the account name and avatar, which opens
 * a Log out menu. Absolutely positioned so it doesn't add height or cause the
 * first screen to scroll.
 */
export function FlowHeader({ showLogin, account }: { showLogin: boolean; account?: { name: string } | null }) {
  if (account) return <AccountMenu name={account.name} />;
  if (!showLogin) return null;
  return (
    <Link
      href="/login?next=/"
      className="absolute top-4 right-4 z-10 whitespace-nowrap rounded-full bg-accent px-5 py-2 text-sm font-bold text-accent-ink shadow-lift transition-all hover:brightness-110 sm:right-8"
    >
      Log in / Sign up
    </Link>
  );
}
