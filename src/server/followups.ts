import { db } from "./db";

export type FollowupMessage = { id: number; role: "user" | "assistant"; text: string; createdAt: number };

export function getThread(reviewId: string, reviewerId: string): FollowupMessage[] {
  const rows = db()
    .prepare("SELECT id, role, content, created_at FROM followups WHERE review_id = ? AND reviewer_id = ? ORDER BY id")
    .all(reviewId, reviewerId) as { id: number; role: "user" | "assistant"; content: string; created_at: number }[];
  return rows.map((r) => ({ id: r.id, role: r.role, text: JSON.parse(r.content).text, createdAt: r.created_at }));
}

export function addMessage(reviewId: string, reviewerId: string, role: "user" | "assistant", text: string) {
  db()
    .prepare("INSERT INTO followups (review_id, reviewer_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)")
    .run(reviewId, reviewerId, role, JSON.stringify({ text }), Date.now());
}
