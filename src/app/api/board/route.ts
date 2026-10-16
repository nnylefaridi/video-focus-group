import { IntentFields } from "@/core/intent";
import { recommendBoard } from "@/core/board";
import { liveProfiles, toCandidate, toCard } from "@/experts/load";

export async function POST(req: Request) {
  const parsed = IntentFields.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid request" }, { status: 400 });
  const profiles = liveProfiles();
  const picks = recommendBoard(profiles.map(toCandidate), parsed.data);
  const roster = profiles.filter((p) => !parsed.data.category || p.categories.includes(parsed.data.category)).map(toCard);
  return Response.json({ picks, roster });
}
