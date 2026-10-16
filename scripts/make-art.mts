/**
 * One-time character art for reviewers. Never runs inside the app.
 *   npm run art                    every reviewer missing art
 *   npm run art -- mrbeast         one reviewer (regenerates)
 * Needs OPENAI_API_KEY in .env.local. IMAGE_MODEL overrides the model (default gpt-image-1).
 *
 * The neutral pose is generated first; the other poses are edits of it, so the
 * character stays consistent. Output: public/reviewers/<id>/{neutral,talk-a,talk-b,thinking,agree,disagree}.png
 * Look at each one on /reviewers/<id> and rerun for anyone you don't like.
 */
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { liveProfiles } from "../src/experts/load";

const KEY = process.env.OPENAI_API_KEY;
const MODEL = process.env.IMAGE_MODEL ?? "gpt-image-1";
if (!KEY) {
  console.error("OPENAI_API_KEY is not set. Add it to .env.local, then run `npm run art` again.");
  process.exit(1);
}

const STYLE =
  "Warm, friendly hand-drawn illustration in a soft gouache-and-colored-pencil storybook style: gentle textured shading, muted warm earthy palette, rounded shapes, kind expression. Head and shoulders, centered, facing slightly toward the viewer, filling most of the frame. Fully transparent background. No text, no logos, no borders, no props, no sparkles or glow.";

const POSES: Record<string, string> = {
  "talk-a": "Same character, same style and framing. Mouth slightly open mid-sentence, engaged and explaining.",
  "talk-b": "Same character, same style and framing. Mouth open a little wider mid-word, eyebrows lifted, animated while talking.",
  thinking: "Same character, same style and framing. Looking slightly up and to the side, thoughtful, mouth closed, as if considering something.",
  agree: "Same character, same style and framing. Warm smile, eyes slightly squinted, nodding in agreement.",
  disagree: "Same character, same style and framing. Skeptical: one eyebrow raised, lips pressed, head tilted slightly.",
};

async function check(res: Response, what: string) {
  if (res.ok) return res.json() as Promise<{ data: { b64_json: string }[] }>;
  const body = await res.text();
  throw new Error(`${what}: ${res.status} ${body.slice(0, 300)}`);
}

async function generate(prompt: string): Promise<Buffer> {
  const res = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: { authorization: `Bearer ${KEY}`, "content-type": "application/json" },
    body: JSON.stringify({ model: MODEL, prompt, size: "1024x1024", background: "transparent", output_format: "png", n: 1 }),
  });
  const data = await check(res, "generate");
  return Buffer.from(data.data[0].b64_json, "base64");
}

async function edit(base: Buffer, prompt: string): Promise<Buffer> {
  const form = new FormData();
  form.append("model", MODEL);
  form.append("prompt", prompt);
  form.append("size", "1024x1024");
  form.append("background", "transparent");
  form.append("output_format", "png");
  form.append("image", new Blob([new Uint8Array(base)], { type: "image/png" }), "neutral.png");
  const res = await fetch("https://api.openai.com/v1/images/edits", { method: "POST", headers: { authorization: `Bearer ${KEY}` }, body: form });
  const data = await check(res, "edit");
  return Buffer.from(data.data[0].b64_json, "base64");
}

async function save(buf: Buffer, file: string) {
  await sharp(buf).resize(320, 320, { fit: "cover" }).png({ compressionLevel: 9 }).toFile(file);
}

const only = process.argv.slice(2);
const profiles = liveProfiles().filter((p) => (only.length ? only.includes(p.id) : !fs.existsSync(path.join("public", "reviewers", p.id, "neutral.png"))));
if (!profiles.length) {
  console.log("Every reviewer already has art. Pass an id to regenerate one.");
  process.exit(0);
}

for (const p of profiles) {
  const dir = path.join(process.cwd(), "public", "reviewers", p.id);
  fs.mkdirSync(dir, { recursive: true });
  console.log(`${p.name}…`);
  try {
    const neutral = await generate(`A recognizable, affectionate caricature of ${p.name} (${p.field}). ${STYLE}`);
    await save(neutral, path.join(dir, "neutral.png"));
    for (const [pose, prompt] of Object.entries(POSES)) {
      await save(await edit(neutral, prompt), path.join(dir, `${pose}.png`));
      console.log(`  ${pose} ✓`);
    }
  } catch (e) {
    // Leave no partial set behind: the app falls back to the monogram until all poses exist.
    fs.rmSync(dir, { recursive: true, force: true });
    console.error(`  failed: ${(e as Error).message}`);
  }
}
console.log("Done. Check each character on /reviewers/<id>.");
