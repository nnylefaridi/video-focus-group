import { Suspense } from "react";
import { connection } from "next/server";
import { FlowLoader } from "@/components/flow/FlowLoader";
import { isHosted, MAX_UPLOAD_MB } from "@/server/config";
import { getViewer } from "@/server/auth";
import { getPaymentContext } from "@/server/billing";

/**
 * Hosted mode asks people to log in after the board, then how they'll pay, before the
 * upload. Never on this first screen. Local mode asks neither.
 */
async function Start() {
  await connection();
  if (!isHosted()) return <FlowLoader maxUploadMb={MAX_UPLOAD_MB} />;
  const { userId } = await getViewer();
  if (!userId) return <FlowLoader signInFirst />;
  // Only the size limit goes to the browser; where uploads land is the server's business.
  return <FlowLoader hosted payment={await getPaymentContext(userId)} maxUploadMb={MAX_UPLOAD_MB} />;
}

export default function Home() {
  return (
    <Suspense>
      <Start />
    </Suspense>
  );
}
