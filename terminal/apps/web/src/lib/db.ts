import "server-only";
import { getDb, type DB } from "@kronos/db";

// One connection per server process (WAL lets the bot write meanwhile).
const g = globalThis as unknown as { __kronosDb?: DB };

export function db(): DB {
  g.__kronosDb ??= getDb();
  return g.__kronosDb;
}
