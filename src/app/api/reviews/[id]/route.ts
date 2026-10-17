import fs from "node:fs";
import path from "node:path";
import { connection } from "next/server";
import { deleteReview, reviewDir, type ReviewRecord } from "@/server/reviews";
import { signedMediaUrl } from "@/server/media";
import { storedMediaUrls } from "@/server/storage";
import { accessibleReview } from "@/server/auth";
import { getProfile, toCard } from "@/experts/load";
import { STAGE_LABELS } from "@/core/review";
import type { ReviewView, PrincipleRef } from "@/core/view";

/**
 * Media URLs: the local working copy when it's there (fast), otherwise the copy in
 * Supabase Storage for reviews kept in an account.
 */
async function mediaResolver(r: ReviewRecord) {
  const dir = reviewDir(r.id);
  const stored = new Set(r.storedFiles);
  const wanted = ["video.mp4", "poster.jpg", "captions.vtt", ...(r.ledger?.frames.map((f) => f.file) ?? [])];
  const remote = r.userId ? wanted.filter((f) => stored.has(f) && !fs.existsSync(path.join(dir, f))) : [];
  const signed = remote.length
    ? await storedMediaUrls(r.userId!, r.id, remote).catch((e) => (console.error("[storage]", e), new Map<string, string>()))
    : new Map<string, string>();
  const remoteSet = new Set(remote);
  const has = (f: string) => (remoteSet.has(f) ? signed.has(f) : fs.existsSync(path.join(dir, f)));
  const url = (f: string) => (remoteSet.has(f) ? (signed.get(f) ?? "") : signedMediaUrl(r.id, f));
  return { has, url };
}

export async function GET(_req: Request, ctx: RouteContext<"/api/reviews/[id]">) {
  await connection();
  const { id } = await ctx.params;
  const found = await accessibleReview(id);
  if (!found) return Response.json({ error: "Not found" }, { status: 404 });
  const r = found.review;
  const media = await mediaResolver(r);

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
  const ready = media.has("video.mp4") && media.has("poster.jpg");
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
        ? {
            url: media.url("video.mp4"),
            poster: media.url("poster.jpg"),
            captions: media.has("captions.vtt") ? media.url("captions.vtt") : null,
            ...r.video,
          }
        : r.video
          ? { url: null, poster: null, captions: null, ...r.video }
          : null,
    ledger: r.ledger
      ? { ...r.ledger, frames: r.ledger.frames.map((f) => ({ ...f, url: media.url(f.file) })) }
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
  if (!(await accessibleReview(id))) return Response.json({ error: "Not found" }, { status: 404 });
  await deleteReview(id);
  return Response.json({ ok: true });
}
