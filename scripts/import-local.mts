/**
 * One-time move of reviews made before the Supabase database existed (data/app.db)
 * into your account, with their follow-up chats and spend history. Their media is
 * then copied to storage by the worker. Safe to run twice: existing rows are skipped.
 *   npm run db:import-local -- --email you@example.com
 */
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { one, tx } from "../src/server/db";
import { enqueue } from "../src/server/jobs";
import { DATA_DIR } from "../src/server/config";

const args = process.argv.slice(2);
const email = args[args.indexOf("--email") + 1];
if (!args.includes("--email") || !email) {
  console.error("Usage: npm run db:import-local -- --email you@example.com  (sign up in the app with that email first)");
  process.exit(1);
}
const file = path.join(DATA_DIR, "app.db");
if (!fs.existsSync(file)) {
  console.log(`Nothing to import: ${file} doesn't exist.`);
  process.exit(0);
}
const user = await one<{ id: string }>("SELECT id FROM auth.users WHERE lower(email) = lower($1)", [email]);
if (!user) throw new Error(`No account with the email ${email}. Sign up in the app first, then run this again.`);

const old = new Database(file, { readonly: true, fileMustExist: true });
const has = (t: string) => Boolean(old.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(t));
const reviews = old.prepare("SELECT * FROM reviews WHERE stage != 'uploading'").all() as Record<string, string | number | null>[];
const followups = has("followups") ? (old.prepare("SELECT * FROM followups").all() as Record<string, string | number>[]) : [];
const spend = has("spend") ? (old.prepare("SELECT * FROM spend").all() as Record<string, string | number | null>[]) : [];

const imported = await tx(async (t) => {
  const ids: string[] = [];
  for (const r of reviews) {
    const rows = await t(
      `INSERT INTO app.reviews (id, created_at, updated_at, user_id, stage, stage_detail, error, answers, intent, board, title, video, ledger, notes, discussion, synthesis, validation, cost)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10::jsonb,$11,$12::jsonb,$13::jsonb,$14::jsonb,$15::jsonb,$16::jsonb,$17::jsonb,$18::jsonb)
       ON CONFLICT (id) DO NOTHING RETURNING id`,
      [r.id, r.created_at, r.updated_at, user.id, r.stage, r.stage_detail, r.error, r.answers, r.intent, r.board, r.title, r.video, r.ledger, r.notes, r.discussion, r.synthesis, r.validation, r.cost],
    );
    if (!rows.length) continue;
    ids.push(String(r.id));
    for (const f of followups.filter((x) => x.review_id === r.id)) {
      await t("INSERT INTO app.followups (review_id, reviewer_id, role, content, created_at) VALUES ($1,$2,$3,$4,$5)", [f.review_id, f.reviewer_id, f.role, f.content, f.created_at]);
    }
  }
  // Spend history keeps this month's budget honest. Only copied once.
  const copied = await t("SELECT 1 FROM app.spend WHERE label = 'imported' LIMIT 1");
  if (!copied.length) {
    for (const s of spend) {
      await t("INSERT INTO app.spend (at, label, model, usd, review_id) VALUES ($1,$2,$3,$4,$5)", [s.at, s.label, s.model, s.usd, s.review_id]);
    }
    await t("INSERT INTO app.spend (at, label, model, usd) VALUES ($1, 'imported', 'none', 0)", [Date.now()]);
  }
  return ids;
});
for (const id of imported) await enqueue(id, "store");
console.log(`Imported ${imported.length} review(s) into ${email}${imported.length ? "; the worker is copying their media to storage" : ""}.`);
process.exit(0);
