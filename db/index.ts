import { env } from "cloudflare:workers";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "./schema";

export interface D1RunResult {
  success: boolean;
  meta?: { changes?: number };
}

export interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{
    results: T[];
    success: boolean;
    meta?: { changes?: number };
  }>;
  run(): Promise<D1RunResult>;
}

export interface D1Binding {
  prepare(sql: string): D1PreparedStatement;
  batch(statements: D1PreparedStatement[]): Promise<D1RunResult[]>;
}

export function getD1(): D1Binding {
  const binding = (env as unknown as { DB?: D1Binding }).DB;
  if (!binding) {
    throw new Error("Cloudflare D1 binding `DB` is unavailable.");
  }
  return binding;
}

export function getDb() {
  return drizzle(getD1() as never, { schema });
}

let arenaSchemaPromise: Promise<void> | null = null;

export function ensureArenaSchema() {
  if (!arenaSchemaPromise) {
    const db = getD1();
    arenaSchemaPromise = db
      .batch([
        db.prepare(`CREATE TABLE IF NOT EXISTS players (
          id TEXT PRIMARY KEY NOT NULL,
          name TEXT NOT NULL,
          rating INTEGER NOT NULL DEFAULT 1200,
          wins INTEGER NOT NULL DEFAULT 0,
          losses INTEGER NOT NULL DEFAULT 0,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        )`),
        db.prepare("CREATE INDEX IF NOT EXISTS players_rating_idx ON players (rating)"),
        db.prepare(`CREATE TABLE IF NOT EXISTS match_queue (
          player_id TEXT PRIMARY KEY NOT NULL,
          name TEXT NOT NULL,
          rating INTEGER NOT NULL,
          joined_at INTEGER NOT NULL,
          last_seen INTEGER NOT NULL,
          room_id TEXT
        )`),
        db.prepare("CREATE INDEX IF NOT EXISTS match_queue_waiting_idx ON match_queue (room_id, joined_at)"),
        db.prepare("CREATE INDEX IF NOT EXISTS match_queue_seen_idx ON match_queue (last_seen)"),
        db.prepare(`CREATE TABLE IF NOT EXISTS rooms (
          id TEXT PRIMARY KEY NOT NULL,
          player1_id TEXT NOT NULL,
          player2_id TEXT NOT NULL,
          prompt_index INTEGER NOT NULL,
          status TEXT NOT NULL DEFAULT 'matched',
          player1_ready INTEGER NOT NULL DEFAULT 0,
          player2_ready INTEGER NOT NULL DEFAULT 0,
          starts_at INTEGER,
          player1_score TEXT,
          player2_score TEXT,
          rated INTEGER NOT NULL DEFAULT 0,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        )`),
        db.prepare("CREATE INDEX IF NOT EXISTS rooms_player1_idx ON rooms (player1_id, status)"),
        db.prepare("CREATE INDEX IF NOT EXISTS rooms_player2_idx ON rooms (player2_id, status)"),
        db.prepare("CREATE INDEX IF NOT EXISTS rooms_created_idx ON rooms (created_at)"),
        db.prepare(`CREATE TABLE IF NOT EXISTS signals (
          id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
          room_id TEXT NOT NULL,
          sender_id TEXT NOT NULL,
          recipient_id TEXT NOT NULL,
          payload TEXT NOT NULL,
          created_at INTEGER NOT NULL
        )`),
        db.prepare("CREATE INDEX IF NOT EXISTS signals_recipient_idx ON signals (room_id, recipient_id, id)"),
        db.prepare("CREATE INDEX IF NOT EXISTS signals_created_idx ON signals (created_at)"),
        db.prepare(`CREATE TABLE IF NOT EXISTS turn_grants (
          id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
          room_id TEXT NOT NULL,
          player_id TEXT NOT NULL,
          created_at INTEGER NOT NULL
        )`),
        db.prepare("CREATE INDEX IF NOT EXISTS turn_grants_player_idx ON turn_grants (player_id, created_at)"),
        db.prepare("CREATE INDEX IF NOT EXISTS turn_grants_created_idx ON turn_grants (created_at)"),
      ])
      .then(() => undefined)
      .catch((error) => {
        arenaSchemaPromise = null;
        throw error;
      });
  }
  return arenaSchemaPromise;
}
