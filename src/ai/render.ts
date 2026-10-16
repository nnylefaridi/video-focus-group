import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import type Anthropic from "@anthropic-ai/sdk";
import type { Frame, Ledger } from "@/core/evidence";
import type { IntentFields } from "@/core/intent";
import type { ExpertProfile } from "@/core/expert";

const f1 = (n: number) => n.toFixed(1);
const f2 = (n: number) => n.toFixed(2);

/** A frame with its id and timestamp burned into the corner, so order can't be confused. */
export async function labeledFrame(dir: string, frame: Frame): Promise<Anthropic.Beta.BetaImageBlockParam> {
  const img = sharp(fs.readFileSync(path.join(dir, frame.file)));
  const meta = await img.metadata();
  const w = meta.width ?? 640;
  const label = `${frame.id} @ ${f2(frame.t)}s`;
  const fontSize = Math.max(18, Math.round(w / 22));
  const boxW = Math.round(fontSize * 0.62 * label.length + fontSize);
  const boxH = Math.round(fontSize * 1.6);
  const svg = Buffer.from(
    `<svg width="${boxW}" height="${boxH}" xmlns="http://www.w3.org/2000/svg"><rect width="${boxW}" height="${boxH}" fill="#000" opacity="0.72"/><text x="${fontSize / 2}" y="${fontSize * 1.15}" font-family="Helvetica" font-size="${fontSize}" fill="#fff">${label}</text></svg>`,
  );
  const data = await img.composite([{ input: svg, top: 0, left: 0 }]).jpeg({ quality: 80 }).toBuffer();
  return { type: "image", source: { type: "base64", media_type: "image/jpeg", data: data.toString("base64") } };
}

/** Frames given to reviewers as images: the hook, each shot, and a steady sample; capped. */
export function pickReviewerFrames(ledger: Ledger, cap = 60): Frame[] {
  const chosen = new Map<string, Frame>();
  const add = (f?: Frame) => f && chosen.set(f.id, f);
  ledger.frames.filter((f) => f.t < 3).forEach(add);
  for (const s of ledger.shots) add(ledger.frames.find((f) => f.shotId === s.id));
  let last = -Infinity;
  for (const f of [...ledger.frames].sort((a, b) => a.t - b.t)) {
    if (f.t - last >= 2) {
      add(f);
      last = f.t;
    }
  }
  return [...chosen.values()].sort((a, b) => a.t - b.t).slice(0, cap);
}

export function pauses(ledger: Ledger, min = 0.5): string[] {
  const words = ledger.transcript.flatMap((s) => s.words.map((w) => ({ ...w, seg: s.id })));
  const out: string[] = [];
  for (let i = 1; i < words.length; i++) {
    const gap = words[i].start - words[i - 1].end;
    if (gap >= min) out.push(`${f2(words[i - 1].end)}–${f2(words[i].start)}s (${f1(gap)}s) after "${words[i - 1].w}" [${words[i - 1].seg}]`);
  }
  return out;
}

export function renderIntent(f: IntentFields): string {
  const lines = Object.entries(f)
    .filter(([, v]) => v !== undefined && v !== "" && !(Array.isArray(v) && v.length === 0))
    .map(([k, v]) => `- ${k}: ${Array.isArray(v) ? v.join(", ") : String(v)}`);
  return lines.join("\n");
}

/** The ledger as text. Everything here has an id the model can cite. */
export function renderLedger(ledger: Ledger, opts: { perception?: boolean } = {}): string {
  const c = ledger.coverage;
  const parts: string[] = [];
  parts.push(
    `VIDEO: ${f1(c.durationSec)}s, ${c.width}x${c.height} (${c.height > c.width ? "vertical" : c.height === c.width ? "square" : "horizontal"})`,
  );
  parts.push(`SHOTS (scene cuts detected automatically):\n${ledger.shots.map((s) => `${s.id} ${f2(s.start)}–${f2(s.end)}s`).join("\n")}`);
  parts.push(
    ledger.transcript.length
      ? `TRANSCRIPT (speech-to-text; may contain recognition errors):\n${ledger.transcript
          .map((s) => `${s.id} [${f2(s.start)}–${f2(s.end)}s]${s.lowConfidence ? " (low confidence)" : ""} ${s.text}`)
          .join("\n")}`
      : "TRANSCRIPT: no speech detected.",
  );
  const p = pauses(ledger);
  if (p.length) parts.push(`PAUSES IN SPEECH ≥0.5s:\n${p.join("\n")}`);
  if (ledger.audio.length)
    parts.push(
      `AUDIO SPANS:\n${ledger.audio
        .map((a) => `${a.id} ${f2(a.start)}–${f2(a.end)}s ${a.kind === "silence" ? "near-silence" : "sound without speech (music or effects; not identified)"}`)
        .join("\n")}`,
    );
  if (ledger.speechRate.some(([, r]) => r > 0))
    parts.push(`SPEECH RATE (words per second, 2s windows): ${ledger.speechRate.map(([t, r]) => `${t}s:${r}`).join("  ")}`);
  if (opts.perception !== false && ledger.perception.length) {
    const byId = new Map(ledger.perception.map((x) => [x.frameId, x]));
    parts.push(
      `FRAMES (sampled stills and what was seen in each):\n${[...ledger.frames]
        .sort((a, b) => a.t - b.t)
        .map((f) => {
          const x = byId.get(f.id);
          if (!x) return `${f.id} @${f2(f.t)}s [${f.shotId ?? "-"}] (not described)`;
          return `${f.id} @${f2(f.t)}s [${f.shotId ?? "-"}]${f.dense ? " (close look)" : ""} ${x.description} | on-screen text: ${x.onScreenText || "none"} | captions: ${x.captionsVisible ? "yes" : "no"} | people: ${x.people} | framing: ${x.framing}${x.productVisible === null ? "" : ` | product visible: ${x.productVisible ? "yes" : "no"}`}`;
        })
        .join("\n")}`,
    );
  }
  parts.push(`COVERAGE AND LIMITS:\n- ${c.sampling}\n${c.notes.map((n) => `- ${n}`).join("\n")}`);
  return parts.join("\n\n");
}

/** The reviewer's profile, rendered for the prompt. Only verified principles are included. */
export function renderProfile(p: ExpertProfile): string {
  const src = new Map(p.sources.map((s) => [s.id, s]));
  const principles = p.principles
    .filter((x) => x.status === "verified")
    .map((x) => {
      const refs = x.refs.map((r) => `${src.get(r.source)?.title ?? r.source}${r.locator ? `, ${r.locator}` : ""}`).join("; ");
      return `- [${x.id}] ${x.statement} (confidence: ${x.confidence.replace("_", " ")}; source: ${refs})${x.excerpt ? `\n  Verified excerpt you may quote exactly: "${x.excerpt}"` : ""}${x.context ? `\n  Context: ${x.context}` : ""}`;
    })
    .join("\n");
  const frameworks = p.frameworks
    .map((f) => `- ${f.name}: ${f.steps.join(" → ")}\n  How it maps onto a video (interpretation, not their words): ${f.videoApplication}`)
    .join("\n");
  const criteria = p.criteria
    .sort((a, b) => b.priority - a.priority)
    .map((c) => `- ${c.dimension} (priority ${c.priority}/5): good = ${c.good} | bad = ${c.bad}`)
    .join("\n");
  return `REVIEWER: ${p.name} — ${p.field}
Lens: ${p.lens}
Background: ${p.bio}

DOCUMENTED PRINCIPLES (cite these ids):
${principles}

FRAMEWORKS:
${frameworks || "(none)"}

WHAT THEY JUDGE, IN PRIORITY ORDER:
${criteria}

THE QUESTIONS THEY ASK FIRST:
${p.reasoningPattern.map((q, i) => `${i + 1}. ${q}`).join("\n")}

HOW THEY TALK:
Tone: ${p.voice.tone}
${p.voice.speech.map((s) => `- ${s}`).join("\n")}
Habits: ${p.voice.habits.join("; ")}
Words they lean on (use one or two naturally, never as a catchphrase or a quote): ${p.voice.words.join(", ")}
Never: ${p.voice.avoid.join("; ")}

OUTSIDE THEIR LANE:
${p.limitations.map((l) => `- ${l}`).join("\n") || "- (none listed)"}`;
}
