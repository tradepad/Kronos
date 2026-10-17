import Database from "better-sqlite3";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { ensureSchema } from "./schema";

export type DB = Database.Database;

/**
 * Resolve a database path. Relative paths are taken from the terminal's
 * root (the folder holding pnpm-workspace.yaml) so the bot, the dashboard
 * and the tests all agree on one file whatever directory they run from.
 */
export function resolveDataPath(p: string): string {
  if (isAbsolute(p)) return p;
  const root = process.env.KRONOS_ROOT ?? findRoot(process.cwd());
  return resolve(root, p);
}

function findRoot(start: string): string {
  let dir = start;
  for (let i = 0; i < 6; i++) {
    if (existsSync(resolve(dir, "pnpm-workspace.yaml"))) return dir;
    const up = dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  return start;
}

export function getDb(path = process.env.KRONOS_DB_PATH ?? "data/kronos.sqlite"): DB {
  const full = resolveDataPath(path);
  mkdirSync(dirname(full), { recursive: true });
  const sqlite = new Database(full);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("busy_timeout = 5000");
  ensureSchema(sqlite);
  return sqlite;
}
