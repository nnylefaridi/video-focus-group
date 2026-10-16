/**
 * Validates every reviewer profile in src/experts/profiles.
 *   npm run kb:validate              structure + references
 *   npm run kb:validate -- --urls    also checks that every source URL responds
 */
import { loadAllProfiles } from "../src/experts/load";

const checkUrls = process.argv.includes("--urls");
const { profiles, errors } = loadAllProfiles();
const problems: string[] = errors.map((e) => `${e.file}: ${e.message}`);
const warnings: string[] = [];
const ids = new Set(profiles.map((p) => p.id));

for (const p of profiles) {
  const where = `${p.id}`;
  const sourceIds = new Set(p.sources.map((s) => s.id));
  const seen = new Set<string>();
  for (const pr of p.principles) {
    if (seen.has(pr.id)) problems.push(`${where}: duplicate principle id ${pr.id}`);
    seen.add(pr.id);
    for (const r of pr.refs) if (!sourceIds.has(r.source)) problems.push(`${where}: ${pr.id} cites unknown source "${r.source}"`);
    if (pr.excerpt && !pr.refs.some((r) => p.sources.find((s) => s.id === r.source)?.kind === "primary"))
      warnings.push(`${where}: ${pr.id} has a verbatim excerpt but no primary source`);
    if (pr.excerpt && pr.excerpt.split(/\s+/).length > 30) problems.push(`${where}: ${pr.id} excerpt is longer than ~25 words`);
  }
  for (const f of p.frameworks) {
    for (const r of f.refs) if (!sourceIds.has(r.source)) problems.push(`${where}: framework ${f.id} cites unknown source "${r.source}"`);
  }
  const verified = p.principles.filter((x) => x.status === "verified");
  for (const d of p.covers) {
    if (!verified.some((x) => x.dimensions.includes(d))) problems.push(`${where}: covers "${d}" but no verified principle has that dimension`);
    if (!p.criteria.some((c) => c.dimension === d)) warnings.push(`${where}: covers "${d}" but has no criterion for it`);
  }
  if (p.status === "verified" && verified.length < 5) problems.push(`${where}: verified profiles need at least 5 verified principles`);
  for (const t of p.tensions) if (!ids.has(t.with)) warnings.push(`${where}: tension with "${t.with}" (no profile yet)`);
}

if (checkUrls) {
  const urls = [...new Set(profiles.flatMap((p) => p.sources.map((s) => s.url)))];
  await Promise.all(
    urls.map(async (u) => {
      try {
        const res = await fetch(u, { method: "GET", redirect: "follow", signal: AbortSignal.timeout(15000), headers: { "user-agent": "Mozilla/5.0" } });
        if (res.status >= 400 && res.status !== 403 && res.status !== 429) problems.push(`URL ${u} returned ${res.status}`);
      } catch (e) {
        warnings.push(`URL ${u} could not be reached (${(e as Error).message})`);
      }
    }),
  );
}

console.log(`Profiles: ${profiles.length} loaded (${profiles.filter((p) => p.status === "verified").length} verified)`);
for (const p of profiles) {
  const v = p.principles.filter((x) => x.status === "verified").length;
  console.log(`  ${p.status === "verified" ? "✓" : "·"} ${p.name.padEnd(22)} ${v}/${p.principles.length} principles verified, ${p.sources.length} sources`);
}
if (warnings.length) console.log(`\nWarnings:\n${warnings.map((w) => `  - ${w}`).join("\n")}`);
if (problems.length) {
  console.error(`\nProblems:\n${problems.map((w) => `  - ${w}`).join("\n")}`);
  process.exit(1);
}
console.log("\nAll profiles valid.");
