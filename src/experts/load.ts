import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import { ExpertProfile, type ExpertCard } from "@/core/expert";
import type { BoardCandidate } from "@/core/board";

const DIR = path.join(process.cwd(), "src", "experts", "profiles");

export type LoadResult = { profiles: ExpertProfile[]; errors: { file: string; message: string }[] };

let cache: { stamp: string; result: LoadResult } | null = null;

/** Parsed once per process; re-read automatically when any profile file changes. */
export function loadAllProfiles(): LoadResult {
  const files = fs.readdirSync(DIR).filter((f) => f.endsWith(".yaml")).sort();
  const stamp = files.map((f) => `${f}:${fs.statSync(path.join(DIR, f)).mtimeMs}`).join("|");
  if (cache?.stamp === stamp) return cache.result;
  cache = { stamp, result: readProfiles(files) };
  return cache.result;
}

function readProfiles(files: string[]): LoadResult {
  const profiles: ExpertProfile[] = [];
  const errors: LoadResult["errors"] = [];
  for (const file of files) {
    try {
      const parsed = ExpertProfile.parse(YAML.parse(fs.readFileSync(path.join(DIR, file), "utf8")));
      if (`${parsed.id}.yaml` !== file) throw new Error(`id "${parsed.id}" does not match file name`);
      profiles.push(parsed);
    } catch (e) {
      errors.push({ file, message: e instanceof Error ? e.message : String(e) });
    }
  }
  return { profiles, errors };
}

/** Only verified profiles with verified principles are ever used in reviews. */
export function liveProfiles(): ExpertProfile[] {
  return loadAllProfiles()
    .profiles.filter((p) => p.status === "verified")
    .map((p) => ({ ...p, principles: p.principles.filter((x) => x.status === "verified") }))
    .filter((p) => p.principles.length >= 5);
}

export function getProfile(id: string): ExpertProfile | null {
  return liveProfiles().find((p) => p.id === id) ?? null;
}

export function toCard(p: ExpertProfile): ExpertCard {
  return {
    id: p.id,
    name: p.name,
    field: p.field,
    short: p.short,
    lens: p.lens,
    color: p.art.color,
    initials: p.art.initials,
    categories: p.categories,
    covers: p.covers,
  };
}

export function toCandidate(p: ExpertProfile): BoardCandidate {
  return { id: p.id, name: p.name, categories: p.categories, appliesTo: p.appliesTo, covers: p.covers, tensions: p.tensions };
}
