// The built-in database for running Panel on your own computer: a real Postgres
// (from the embedded-postgres package) that lives in data/pg and only accepts
// connections from this computer. Used when DATABASE_URL isn't set, so no
// database needs installing or an account anywhere.
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import EmbeddedPostgres from "embedded-postgres";

// Keep in sync with LOCAL_DATABASE_URL in src/server/db.ts.
const PORT = 54329;
export const LOCAL_DATABASE_URL = `postgres://panel:panel@127.0.0.1:${PORT}/panel`;

/** True when .env.local (or the environment) doesn't point at another database. */
export function wantsLocalDatabase() {
  if (process.env.DATABASE_URL) return false;
  const file = path.join(process.cwd(), ".env.local");
  if (!fs.existsSync(file)) return true;
  return !fs.readFileSync(file, "utf8").split("\n").some((l) => /^DATABASE_URL=\S+/.test(l.trim()));
}

export class LocalDatabaseError extends Error {}

/** True when the local database is already running (Panel is open in another window). */
export const localDatabaseRunning = () =>
  new Promise((resolve) => {
    const s = net.connect(PORT, "127.0.0.1");
    s.once("connect", () => (s.destroy(), resolve(true)));
    s.once("error", () => resolve(false));
  });

/** Starts the local database (creating it the first time) and returns how to stop it. */
export async function startLocalDatabase({ quiet = true } = {}) {
  if (await localDatabaseRunning())
    throw new LocalDatabaseError("Panel is already running in another Terminal window. Use that one, or press Ctrl + C there first.");
  const dir = path.join(process.env.DATA_DIR ?? path.join(process.cwd(), "data"), "pg");
  const pg = new EmbeddedPostgres({
    databaseDir: dir,
    port: PORT,
    user: "panel",
    password: "panel",
    persistent: true,
    postgresFlags: ["-c", "listen_addresses=127.0.0.1"],
    onLog: quiet ? () => {} : console.log,
    onError: (e) => {
      const msg = String(e instanceof Error ? e.message : e);
      // Postgres writes routine startup notes to stderr; only pass on real problems.
      if (/error|fatal|panic/i.test(msg) && !/database system is ready/i.test(msg)) console.error(`[database] ${msg.trim()}`);
    },
  });
  if (!fs.existsSync(path.join(dir, "PG_VERSION"))) await pg.initialise();
  try {
    await pg.start();
  } catch (e) {
    const why = e instanceof Error ? e.message : typeof e === "string" ? e : "";
    throw new LocalDatabaseError(`The local database couldn't start${why ? ` (${why})` : ""}. Try npm run setup, then npm run dev again.`);
  }
  const client = pg.getPgClient();
  await client.connect();
  const exists = await client.query("SELECT 1 FROM pg_database WHERE datname = 'panel'");
  await client.end();
  if (!exists.rowCount) await pg.createDatabase("panel");
  return { url: LOCAL_DATABASE_URL, stop: () => pg.stop() };
}
