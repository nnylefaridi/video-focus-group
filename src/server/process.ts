import fs from "node:fs";
import path from "node:path";
import type { Coverage, Ledger } from "@/core/evidence";
import type { ReviewerNotes } from "@/core/review";
import { probe } from "@/media/probe";
import { audioSignals, denseSample, detectShots, normalize, sampleFrames, transcribe } from "@/media/pipeline";
import { perceiveFrames } from "@/ai/perceive";
import { composeDiscussion, evidenceBlocks, reviewerPass, synthesize } from "@/ai/review";
import { getProfile } from "@/experts/load";
import { getReview, reviewDir, updateReview } from "./reviews";

function originalFile(dir: string): string {
  const f = fs.readdirSync(dir).find((x) => x.startsWith("original."));
  if (!f) throw new Error("The uploaded file is missing.");
  return path.join(dir, f);
}

function coverage(p: { durationSec: number; width: number; height: number; hasAudio: boolean }, ledger: Omit<Ledger, "coverage">): Coverage {
  const notes: string[] = [];
  if (!p.hasAudio) notes.push("The video has no audio track, so nothing about sound or speech can be judged.");
  else if (ledger.transcript.length === 0) notes.push("No speech was detected in the audio.");
  if (ledger.transcript.some((s) => s.lowConfidence)) notes.push("Some transcript segments are low-confidence and may be misheard.");
  if (ledger.audio.some((a) => a.kind === "sound_without_speech"))
    notes.push("Music and sound effects are detected only as 'sound without speech'; their identity, mood and mix are not analyzed.");
  notes.push("Motion, gestures and timing between sampled frames were not seen; claims about them rely on shot boundaries and speech timing only.");
  notes.push("Frame colors and composition were judged from downscaled stills, not full-resolution video.");
  return {
    durationSec: p.durationSec,
    width: p.width,
    height: p.height,
    framesAnalyzed: ledger.frames.length,
    sampling: `Frames sampled every 0.25s for the first 3 seconds, about every 1–2s after that, plus the first and middle frame of each of the ${ledger.shots.length} detected shots (${ledger.frames.length} frames total).`,
    transcript: ledger.transcript.length ? "speech" : "no_speech_detected",
    notes,
  };
}

export async function processReview(id: string) {
  const r = getReview(id);
  if (!r) throw new Error(`Review ${id} not found`);
  const dir = reviewDir(id);
  const stage = (stage: Parameters<typeof updateReview>[1]["stage"], stageDetail: string | null = null) =>
    updateReview(id, { stage, stageDetail });

  const board = r.board.map((rid) => getProfile(rid));
  if (board.some((p) => !p)) throw new Error("A reviewer on this board is no longer available.");
  const profiles = board.filter((p): p is NonNullable<typeof p> => p !== null);

  // 1. Media → ledger (skipped when resuming after a later-stage failure).
  let ledger = r.ledger;
  if (!ledger) {
    stage("ingesting");
    const p = await probe(originalFile(dir));
    await normalize(dir, originalFile(dir), p);

    stage("transcribing");
    const transcript = await transcribe(dir);

    stage("sampling");
    const shots = await detectShots(dir, p.durationSec);
    let frames = await sampleFrames(dir, p.durationSec, shots);
    // A closer look at the hook: 8 fps over the first second and a half.
    frames = [...frames, ...(await denseSample(dir, frames, shots, p.durationSec, 0.75, 0.75))];
    const signals = await audioSignals(dir, p.durationSec, transcript);

    stage("perceiving", `${frames.length} frames`);
    const perception = await perceiveFrames(id, dir, frames, { intent: r.intent, transcript });

    const partial = { shots, frames, transcript, ...signals, perception };
    ledger = { ...partial, coverage: coverage(p, partial) };
    updateReview(id, { ledger });
  }

  // 2. Independent reviewer passes. The first warms the shared evidence cache, the rest run in parallel.
  const notes: Record<string, ReviewerNotes> = { ...(r.notes ?? {}) };
  const validation = { ...(r.validation ?? {}) };
  const pending = profiles.filter((p) => !notes[p.id]);
  if (pending.length) {
    stage("reviewing", `${Object.keys(notes).length} of ${profiles.length} done`);
    const evidence = await evidenceBlocks(dir, ledger, r.intent);
    const runOne = async (p: (typeof profiles)[number]) => {
      const out = await reviewerPass(id, evidence, ledger!, p);
      notes[p.id] = out.notes;
      validation[p.id] = out.report;
      updateReview(id, { notes, validation, stageDetail: `${Object.keys(notes).length} of ${profiles.length} done` });
    };
    await runOne(pending[0]);
    await Promise.all(pending.slice(1).map(runOne));
  }

  // 3. Discussion and synthesis.
  let discussion = r.discussion;
  if (!discussion) {
    stage("discussing");
    const out = await composeDiscussion(id, ledger, r.intent, profiles, notes);
    discussion = out.turns;
    validation.discussion = out.report;
    updateReview(id, { discussion, validation });
  }
  if (!r.synthesis) {
    stage("synthesizing");
    const out = await synthesize(id, profiles, notes, discussion, ledger);
    validation.synthesis = out.report;
    updateReview(id, { synthesis: out.synthesis, validation });
  }
  stage("done");
}
