import { q } from "./db";

export type FollowupMessage = { id: number; role: "user" | "assistant"; text: string; createdAt: number };

export async function getThread(reviewId: string, reviewerId: string): Promise<FollowupMessage[]> {
  const rows = await q<{ id: string; role: "user" | "assistant"; content: string; created_at: string }>(
    "SELECT id, role, content, created_at FROM app.followups WHERE review_id = $1 AND reviewer_id = $2 ORDER BY id",
    [reviewId, reviewerId],
  );
  return rows.map((r) => ({ id: Number(r.id), role: r.role, text: JSON.parse(r.content).text, createdAt: Number(r.created_at) }));
}

export async function addMessage(reviewId: string, reviewerId: string, role: "user" | "assistant", text: string) {
  await q("INSERT INTO app.followups (review_id, reviewer_id, role, content, created_at) VALUES ($1, $2, $3, $4, $5)", [
    reviewId,
    reviewerId,
    role,
    JSON.stringify({ text }),
    Date.now(),
  ]);
}
