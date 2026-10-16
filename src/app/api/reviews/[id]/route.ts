import fs from "node:fs";
import path from "node:path";
import { connection } from "next/server";
import { getReview, deleteReview, reviewDir } from "@/server/reviews";
import { signedMediaUrl } from "@/server/media";
import { getProfile, toCard } from "@/experts/load";
import { STAGE_LABELS } from "@/core/review";
import type { ReviewView, PrincipleRef } from "@/core/view";

export async function GET(_req: Request, ctx: RouteContext<"/api/reviews/[id]">) {
  await connection();
  const { id } = await ctx.params;
  const r = getReview(id);
  if (!r) return Response.json({ error: "Not found" }, { status: 404 });

  const profiles = r.board.map((rid) => getProfile(rid)).filter((p) => p !== null);
  const principles: Record<string, PrincipleRef> = {};
  for (const p of profiles) {
    const sources = new Map(p.sources.map((s) => [s.id, s]));
    for (const pr of p.principles) {
      principles[pr.id] = {
        reviewerId: p.id,
        statement: pr.statement,
        confidence: pr.confidence,
        sources: pr.refs.map((ref) => {
          const s = sources.get(ref.source);
          return { title: s?.title ?? ref.source, url: s?.url ?? "", locator: ref.locator ?? null, kind: s?.kind ?? "secondary" };
        }),
      };
    }
  }

  // The normalized video is playable as soon as it exists, even while the review is still running.
  const ready = fs.existsSync(path.join(reviewDir(id), "video.mp4")) && fs.existsSync(path.join(reviewDir(id), "poster.jpg"));
  const view: ReviewView = {
    id: r.id,
    createdAt: r.createdAt,
    stage: r.stage,
    stageLabel: STAGE_LABELS[r.stage],
    stageDetail: r.stageDetail,
    error: r.error,
    title: r.title,
    intent: r.intent,
    answers: r.answers,
    board: profiles.map(toCard),
    video:
      r.video && ready
        ? { url: signedMediaUrl(id, "video.mp4"), poster: signedMediaUrl(id, "poster.jpg"), ...r.video }
        : r.video
          ? { url: null, poster: null, ...r.video }
          : null,
    ledger: r.ledger
      ? { ...r.ledger, frames: r.ledger.frames.map((f) => ({ ...f, url: signedMediaUrl(id, f.file) })) }
      : null,
    notes: r.notes,
    discussion: r.discussion,
    synthesis: r.synthesis,
    principles,
    costUsd: Math.round(r.cost.usd * 1000) / 1000,
  };
  return Response.json(view);
}

export async function DELETE(_req: Request, ctx: RouteContext<"/api/reviews/[id]">) {
  const { id } = await ctx.params;
  if (!getReview(id)) return Response.json({ error: "Not found" }, { status: 404 });
  deleteReview(id);
  return Response.json({ ok: true });
}
