import Database from "better-sqlite3";
import { DB_PATH } from "./config";

declare global {
  var __panelDb: Database.Database | undefined;
}

function open(): Database.Database {
  const db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.pragma("busy_timeout = 5000");
  db.pragma("foreign_keys = ON");
  db.exec(`
    CREATE TABLE IF NOT EXISTS reviews (
      id TEXT PRIMARY KEY,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      stage TEXT NOT NULL,
      stage_detail TEXT,
      error TEXT,
      answers TEXT NOT NULL,
      intent TEXT NOT NULL,
      board TEXT NOT NULL,
      title TEXT,
      video TEXT,
      ledger TEXT,
      notes TEXT,
      discussion TEXT,
      synthesis TEXT,
      validation TEXT,
      cost TEXT NOT NULL DEFAULT '{"usd":0,"calls":[]}'
    );
    CREATE TABLE IF NOT EXISTS jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      review_id TEXT NOT NULL REFERENCES reviews(id) ON DELETE CASCADE,
      kind TEXT NOT NULL,
      payload TEXT NOT NULL DEFAULT '{}',
      status TEXT NOT NULL DEFAULT 'pending',
      attempts INTEGER NOT NULL DEFAULT 0,
      error TEXT,
      created_at INTEGER NOT NULL,
      started_at INTEGER,
      finished_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS jobs_status ON jobs(status, id);
    CREATE TABLE IF NOT EXISTS followups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      review_id TEXT NOT NULL REFERENCES reviews(id) ON DELETE CASCADE,
      reviewer_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS followups_thread ON followups(review_id, reviewer_id, id);
  `);
  return db;
}

/** One connection per process (survives dev hot reloads). */
export function db(): Database.Database {
  globalThis.__panelDb ??= open();
  return globalThis.__panelDb;
}
