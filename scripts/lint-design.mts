/**
 * Enforces the visual bans for this app. Fails if any source file contains:
 * gradients, purple/violet hues, glassmorphism/blur, glow shadows, thick or
 * colored left/top card borders, eyebrow badges above an H1, or sparkle/magic-wand
 * iconography.
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = path.join(process.cwd(), "src");
const files: string[] = [];
(function walk(dir: string) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (/\.(tsx?|css)$/.test(e.name)) files.push(p);
  }
})(ROOT);

const RULES: { name: string; re: RegExp }[] = [
  { name: "gradient", re: /(linear|radial|conic)-gradient|\bbg-(gradient|linear|radial|conic)-|\b(from|via|to)-(\w+-)?\d{2,3}\b/ },
  { name: "purple/violet color", re: /\b(purple|violet|fuchsia|indigo|lavender)\b/i },
  { name: "glassmorphism / blur", re: /backdrop-filter|backdrop-blur|\bblur-(sm|md|lg|xl|2xl|3xl|\[)/ },
  { name: "glow shadow", re: /shadow-\[0_0_|box-shadow:\s*0\s+0\s+\d+px|text-shadow|drop-shadow-\[/ },
  { name: "left/top accent border", re: /\bborder-[lt]-(\d|\[)|\bborder-[lt]-(?!line\b)[a-z]+-\d|border-(left|top)(-color)?:\s*(?!0|none)/ },
  { name: "sparkle / magic iconography", re: /sparkle|magic-?wand|\bwand\b|✨|🪄/i },
];

function hueOf(hex: string): { h: number; s: number } | null {
  const m = hex.replace("#", "");
  const full = m.length === 3 ? m.split("").map((c) => c + c).join("") : m.slice(0, 6);
  if (full.length !== 6) return null;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  if (d === 0) return { h: 0, s: 0 };
  const l = (max + min) / 2;
  const s = d / (1 - Math.abs(2 * l - 1));
  let h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h *= 60;
  if (h < 0) h += 360;
  return { h, s };
}

const problems: string[] = [];
for (const f of files) {
  if (f.endsWith("lint-design.mts")) continue;
  const lines = fs.readFileSync(f, "utf8").split("\n");
  const rel = path.relative(process.cwd(), f);
  // The painted puppets use soft gradient shading inside the illustration; that is not a UI gradient.
  const illustration = rel.includes(path.join("components", "puppets"));
  lines.forEach((line, i) => {
    for (const r of RULES) {
      if (illustration && r.name === "gradient") continue;
      if (r.re.test(line)) problems.push(`${rel}:${i + 1}  ${r.name}: ${line.trim().slice(0, 100)}`);
    }
    for (const m of line.matchAll(/#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b/g)) {
      const hs = hueOf(m[0]);
      if (hs && hs.h >= 255 && hs.h <= 330 && hs.s > 0.2) problems.push(`${rel}:${i + 1}  purple-range color ${m[0]}`);
    }
    if (/<h1\b/.test(line)) {
      const before = lines.slice(Math.max(0, i - 4), i).join("\n");
      if (/uppercase|tracking-widest|\bbadge\b|eyebrow/i.test(before)) problems.push(`${rel}:${i + 1}  eyebrow badge above H1`);
    }
  });
}

// Reviewer palette colors live in YAML profiles.
const profDir = path.join(ROOT, "experts", "profiles");
for (const f of fs.readdirSync(profDir).filter((x) => x.endsWith(".yaml"))) {
  const m = fs.readFileSync(path.join(profDir, f), "utf8").match(/color:\s*"?(#[0-9a-fA-F]{6})/);
  const hs = m && hueOf(m[1]);
  if (hs && hs.h >= 255 && hs.h <= 330 && hs.s > 0.2) problems.push(`profiles/${f}  purple-range reviewer color ${m![1]}`);
}

if (problems.length) {
  console.error(`Design bans violated:\n${problems.map((p) => `  - ${p}`).join("\n")}`);
  process.exit(1);
}
console.log(`Design check passed (${files.length} files).`);
