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

function databaseHint(why) {
  const text = String(why).toLowerCase();
  if (/address already in use|eaddrinuse/.test(text)) {
    return "Port 54329 is already taken. Stop the other program using it, then try again.";
  }
  if (/postmaster\.pid|lock file|another postgres|being used by another process/.test(text)) {
    return "The built-in database looks like it was left running. Stop Panel with Ctrl + C. If it still fails, delete the data/pg folder (that deletes reviews stored in the built-in database) and run npm run setup again.";
  }
  if (/locale|lc_all|lc_ctype|invalid locale/.test(text)) {
    return "Postgres couldn't start because of a locale. On Ubuntu, `locale -a` should list en_US.utf8 or C.utf8 (those are the names the built-in database looks for). Then run npm run setup again.";
  }
  if (/permission denied|eacces/.test(text)) {
    return "Panel couldn't write the database files under data/pg. Fix that folder's permissions and run npm run setup again.";
  }
  if (/no space left|enospc/.test(text)) {
    return "The disk is full. Free some space and run npm run setup again.";
  }
  return "Run npm run setup, then npm run dev again. Database files are in data/pg and the server only listens on 127.0.0.1:54329. Deleting data/pg removes reviews stored in the built-in database.";
}

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
  if (!fs.existsSync(path.join(dir, "PG_VERSION"))) {
    try {
      await pg.initialise();
    } catch (e) {
      const why = e instanceof Error ? e.message : typeof e === "string" ? e : "";
      throw new LocalDatabaseError(`The local database couldn't be created${why ? ` (${why})` : ""}. ${databaseHint(why)}`);
    }
  }
  try {
    await pg.start();
  } catch (e) {
    const why = e instanceof Error ? e.message : typeof e === "string" ? e : "";
    throw new LocalDatabaseError(`The local database couldn't start${why ? ` (${why})` : ""}. ${databaseHint(why)}`);
  }
  const client = pg.getPgClient();
  await client.connect();
  const exists = await client.query("SELECT 1 FROM pg_database WHERE datname = 'panel'");
  await client.end();
  if (!exists.rowCount) await pg.createDatabase("panel");
  return { url: LOCAL_DATABASE_URL, stop: () => pg.stop() };
}
