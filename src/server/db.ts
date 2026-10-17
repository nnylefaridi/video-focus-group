import fs from "node:fs";
import path from "node:path";

/**
 * The app's database: Supabase Postgres, reached with DATABASE_URL (the pooler
 * connection string from the Supabase dashboard). Tests use an in-process Postgres
 * instead (`DATABASE_URL=pglite:memory`), so they need no network or account.
 *
 * Migrations in supabase/migrations run automatically, once, on first use.
 */
export type Row = Record<string, unknown>;
export type Query = <T = Row>(text: string, params?: unknown[]) => Promise<T[]>;
type Tx = { q: Query; exec: (text: string) => Promise<void> };
type Driver = { q: Query; tx: <T>(fn: (t: Tx) => Promise<T>) => Promise<T> };

declare global {
  var __panelDb: Promise<Driver> | undefined;
}

export class NotConfigured extends Error {}

async function postgresDriver(url: string): Promise<Driver> {
  const { default: postgres } = await import("postgres");
  // prepare: false works with both the session and transaction poolers. JSON values are
  // passed as JSON text with a ::jsonb cast, so they must go through as-is, not be encoded again.
  const sql = postgres(url, {
    prepare: false,
    max: 5,
    idle_timeout: 30,
    onnotice: () => {},
    types: { json: { to: 3802, from: [114, 3802], serialize: (x: unknown) => (typeof x === "string" ? x : JSON.stringify(x)), parse: (x: string) => JSON.parse(x) } },
  });
  const q: Query = async (text, params = []) => (await sql.unsafe(text, params as never[])) as never;
  return {
    q,
    tx: async (fn) =>
      (await sql.begin((t) =>
        fn({
          q: async (text, params = []) => (await t.unsafe(text, params as never[])) as never,
          exec: async (text) => void (await t.unsafe(text).simple()),
        }),
      )) as never,
  };
}

async function pgliteDriver(where: string): Promise<Driver> {
  const { PGlite } = await import(/* turbopackIgnore: true */ "@electric-sql/pglite");
  const pg = where === "memory" ? new PGlite() : new PGlite(path.resolve(where));
  const q: Query = async (text, params = []) => (await pg.query(text, params)).rows as never;
  return {
    q,
    tx: (fn) =>
      pg.transaction((t) =>
        fn({
          q: async (text, params = []) => (await t.query(text, params)).rows as never,
          exec: async (text) => void (await t.exec(text)),
        }),
      ),
  };
}

const MIGRATIONS = path.join(/* turbopackIgnore: true */ process.cwd(), "supabase", "migrations");

async function migrate(d: Driver) {
  await d.tx(async (t) => {
    // Web app and worker may start at once; only one applies migrations.
    await t.q("select pg_advisory_xact_lock(724100)");
    await t.exec(
      "create schema if not exists app; create table if not exists app.migrations (name text primary key, at bigint not null); alter table app.migrations enable row level security",
    );
    const done = new Set((await t.q<{ name: string }>("select name from app.migrations")).map((r) => r.name));
    for (const name of fs.readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort()) {
      if (done.has(name)) continue;
      await t.exec(fs.readFileSync(path.join(MIGRATIONS, name), "utf8"));
      await t.q("insert into app.migrations (name, at) values ($1, $2)", [name, Date.now()]);
    }
  });
}

/** The built-in database `npm run dev` starts when DATABASE_URL isn't set (scripts/local-db.mjs). */
const LOCAL_DATABASE_URL = "postgres://panel:panel@127.0.0.1:54329/panel";

async function open(): Promise<Driver> {
  const url = process.env.DATABASE_URL || LOCAL_DATABASE_URL;
  const d = url.startsWith("pglite:") ? await pgliteDriver(url.slice("pglite:".length)) : await postgresDriver(url);
  try {
    await migrate(d);
  } catch (e) {
    if (/ECONNREFUSED|connect/i.test(String((e as { code?: string }).code ?? e)) && url === LOCAL_DATABASE_URL)
      throw new NotConfigured("The local database isn't running. Start Panel with `npm run dev`.");
    throw e;
  }
  return d;
}

/** One connection pool per process (survives dev hot reloads). */
function driver(): Promise<Driver> {
  globalThis.__panelDb ??= open().catch((e) => {
    globalThis.__panelDb = undefined;
    throw e;
  });
  return globalThis.__panelDb;
}

export const q: Query = async (text, params) => (await driver()).q(text, params);

export async function one<T = Row>(text: string, params?: unknown[]): Promise<T | null> {
  return (await q<T>(text, params))[0] ?? null;
}

/** A transaction. `lock(key)` serializes everything else holding the same key until commit. */
export async function tx<T>(fn: (t: Query, lock: (key: string) => Promise<void>) => Promise<T>): Promise<T> {
  return (await driver()).tx((t) => fn(t.q, async (key) => void (await t.q("select pg_advisory_xact_lock(hashtext($1))", [key]))));
}
