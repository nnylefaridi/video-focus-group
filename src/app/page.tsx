import { Suspense } from "react";
import { connection } from "next/server";
import { FlowLoader } from "@/components/flow/FlowLoader";
import { isHosted, MAX_UPLOAD_MB } from "@/server/config";
import { getViewer } from "@/server/auth";
import { accountChip } from "@/server/account-label";
import { getPaymentContext } from "@/server/billing";

/**
 * Hosted mode asks how people will pay on this first screen, in place of the first question
 * (logging in on the way), because the server checks answers only on their own key or
 * credits. Local mode starts with the first question.
 */
async function Start() {
  await connection();
  if (!isHosted()) return <FlowLoader maxUploadMb={MAX_UPLOAD_MB} />;
  const viewer = await getViewer();
  if (!viewer.userId) return <FlowLoader signInFirst />;
  // Only the size limit goes to the browser; where uploads land is the server's business.
  return <FlowLoader hosted payment={await getPaymentContext(viewer.userId)} maxUploadMb={MAX_UPLOAD_MB} account={await accountChip(viewer)} />;
}

export default function Home() {
  return (
    <Suspense>
      <Start />
    </Suspense>
  );
}
