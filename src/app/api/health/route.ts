import { connection } from "next/server";

/** For the host's health check: says the website is up. Reads no settings and touches no database. */
export async function GET() {
  await connection();
  return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}
