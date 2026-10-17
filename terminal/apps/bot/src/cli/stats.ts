/** pnpm db:stats — row counts per table, so nobody needs the sqlite3 CLI. */
import { getDb } from "@kronos/db";

const db = getDb();
const tables = ["backtest_runs", "backfill_runs", "prediction_samples", "trades", "events", "odds_snapshots"] as const;
console.log();
for (const t of tables) {
  const { n } = db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number };
  console.log(`  ${t.padEnd(20)} ${n}`);
}
const bySource = db.prepare(`SELECT source, COUNT(*) AS n FROM prediction_samples GROUP BY source`).all() as { source: string; n: number }[];
if (bySource.length) console.log(`  samples by source    ${bySource.map((r) => `${r.source}=${r.n}`).join("  ")}`);
console.log();
