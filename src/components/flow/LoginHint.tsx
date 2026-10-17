import Link from "next/link";

/** Shown under a limit message when logging in would give the person their own allowance. The flow resumes where it was. */
export function LoginHint() {
  return (
    <Link href="/login?next=/" className="ml-1 font-bold underline underline-offset-2">
      Log in
    </Link>
  );
}
