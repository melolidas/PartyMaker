import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const dbPath =
  process.env.PARTYMAKER_DB ?? resolve(__dirname, "../data/partymaker.db");

mkdirSync(dirname(dbPath), { recursive: true });

export const db = new Database(dbPath);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
  CREATE TABLE IF NOT EXISTS parties (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT NOT NULL,
    host        TEXT NOT NULL,
    location    TEXT NOT NULL DEFAULT '',
    starts_at   TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS guests (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    party_id   INTEGER NOT NULL REFERENCES parties(id) ON DELETE CASCADE,
    name       TEXT NOT NULL,
    rsvp       TEXT NOT NULL DEFAULT 'pending'
                 CHECK (rsvp IN ('pending', 'yes', 'no', 'maybe')),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_guests_party ON guests(party_id);
`);

export type Rsvp = "pending" | "yes" | "no" | "maybe";

export interface PartyRow {
  id: number;
  name: string;
  host: string;
  location: string;
  starts_at: string;
  description: string;
  created_at: string;
}

export interface GuestRow {
  id: number;
  party_id: number;
  name: string;
  rsvp: Rsvp;
  created_at: string;
}
