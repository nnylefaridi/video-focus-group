import { Suspense } from "react";
import { connection } from "next/server";
import { FlowLoader } from "@/components/flow/FlowLoader";
import { isHosted } from "@/server/config";
import { getViewer } from "@/server/auth";

/** Hosted mode asks people to log in after the board, before the upload. Never on this first screen. */
async function Start() {
  await connection();
  const signInFirst = isHosted() && !(await getViewer()).userId;
  return <FlowLoader signInFirst={signInFirst} />;
}

export default function Home() {
  return (
    <Suspense>
      <Start />
    </Suspense>
  );
}
