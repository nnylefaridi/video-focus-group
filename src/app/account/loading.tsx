/**
 * The account pages read the visitor's session, which is only known at request time. Next.js needs a
 * Suspense boundary around anything like that so the rest of the build can be prepared ahead; this
 * file is that boundary for /account and the pages under it. It shows nothing while they load.
 */
export default function Loading() {
  return null;
}
