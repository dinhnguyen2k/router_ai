/**
 * SQLite schema and connection.
 *
 * Cooldown state is stored per (account, model) rather than per account,
 * following CLIProxyAPI's model: a credential can be rate limited on one model
 * while still serving another, and collapsing that into a single per-account
 * flag would idle credentials that are still usable.
 */

import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

export type Db = Database.Database;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS accounts (
  id                   TEXT PRIMARY KEY,
  name                 TEXT    NOT NULL,
  provider             TEXT    NOT NULL,
  protocol             TEXT    NOT NULL,
  base_url             TEXT    NOT NULL,
  api_key_cipher       TEXT    NOT NULL,
  api_key_masked       TEXT    NOT NULL,
  models               TEXT    NOT NULL DEFAULT '[]',
  enabled              INTEGER NOT NULL DEFAULT 1,
  priority             INTEGER NOT NULL DEFAULT 1,
  weight               INTEGER NOT NULL DEFAULT 50,
  max_concurrent       INTEGER NOT NULL DEFAULT 4,
  daily_token_budget   INTEGER NOT NULL DEFAULT 0,
  today_tokens         INTEGER NOT NULL DEFAULT 0,
  today_requests       INTEGER NOT NULL DEFAULT 0,
  budget_day_start     INTEGER NOT NULL DEFAULT 0,
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  total_requests       INTEGER NOT NULL DEFAULT 0,
  total_success        INTEGER NOT NULL DEFAULT 0,
  total_failures       INTEGER NOT NULL DEFAULT 0,
  prompt_tokens        INTEGER NOT NULL DEFAULT 0,
  completion_tokens    INTEGER NOT NULL DEFAULT 0,
  last_used_at         INTEGER,
  last_error_at        INTEGER,
  last_error           TEXT,
  tags                 TEXT    NOT NULL DEFAULT '[]',
  notes                TEXT,
  created_at           INTEGER NOT NULL,
  updated_at           INTEGER NOT NULL
);

-- One row per credential/model pair currently held out of rotation.
-- model = '' means the whole credential is held out.
CREATE TABLE IF NOT EXISTS cooldowns (
  account_id    TEXT    NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  model         TEXT    NOT NULL DEFAULT '',
  health        TEXT    NOT NULL,
  reason        TEXT    NOT NULL DEFAULT '',
  error_class   TEXT    NOT NULL DEFAULT 'unknown',
  next_retry_at INTEGER NOT NULL,
  backoff_level INTEGER NOT NULL DEFAULT 0,
  updated_at    INTEGER NOT NULL,
  PRIMARY KEY (account_id, model)
);

CREATE TABLE IF NOT EXISTS request_logs (
  id                TEXT PRIMARY KEY,
  created_at        INTEGER NOT NULL,
  protocol          TEXT    NOT NULL,
  model             TEXT    NOT NULL,
  stream            INTEGER NOT NULL DEFAULT 0,
  outcome           TEXT    NOT NULL,
  status            INTEGER,
  account_id        TEXT,
  account_name      TEXT,
  duration_ms       INTEGER NOT NULL DEFAULT 0,
  ttfb_ms           INTEGER,
  attempt_count     INTEGER NOT NULL DEFAULT 1,
  attempts          TEXT    NOT NULL DEFAULT '[]',
  prompt_tokens     INTEGER,
  completion_tokens INTEGER,
  error_class       TEXT,
  error_message     TEXT
);

CREATE INDEX IF NOT EXISTS idx_request_logs_created_at
  ON request_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_request_logs_account
  ON request_logs (account_id, created_at DESC);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

/**
 * Opens the database and brings the schema up to date.
 *
 * WAL is enabled because the gateway writes request logs while the dashboard
 * polls; without it the reader would block behind every log insert.
 */
export function openDatabase(databasePath: string): Db {
  if (databasePath !== ':memory:') {
    fs.mkdirSync(path.dirname(databasePath), { recursive: true });
  }
  const db = new Database(databasePath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  db.exec(SCHEMA);
  return db;
}
