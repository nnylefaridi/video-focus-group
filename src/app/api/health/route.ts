import { connection } from "next/server";
import { kickAfterResponse } from "@/server/kick";

/**
 * For the host's health check: says the website is up. The answer reads no settings and touches
 * no database. Once it's sent, it wakes the review runner, so a host that slept or restarted
 * picks up reviews that were left unfinished, even when nobody has the review page open.
 */
export async function GET() {
  await connection();
  kickAfterResponse();
  return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}
