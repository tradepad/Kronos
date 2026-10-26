import type { RunInput } from "@kronos/db";

const pct = (x: number | null) => (x === null ? "—" : `${(x * 100).toFixed(1)}%`);
const usd = (x: number) => `${x >= 0 ? "+" : "−"}$${Math.abs(x).toFixed(2)}`;

export function printRun(r: RunInput, id: number, table: string): void {
  const rows: [string, string][] = [
    ["row", `${table} #${id}`],
    ["predictor", r.predictorName],
    ["windows", String(r.rawPredictions)],
    ["raw accuracy", `${pct(r.rawAccuracy)}  (model, ungated)`],
    ["raw pnl", `${usd(r.rawPnl)}  ($1 flat, sim odds)`],
    ["bets placed", `${r.betsPlaced}  (${r.betsWon}W / ${r.betsLost}L)`],
    ["gated win rate", pct(r.betsPlaced ? r.winRate : null)],
    ["gated pnl", `${usd(r.totalPnl)}  (SIMULATED odds — upper bound)`],
    ["brier / log loss", `${r.brier?.toFixed(4) ?? "—"} / ${r.logLoss?.toFixed(4) ?? "—"}`],
    ["regime", r.regime ?? "—"],
    ["duration", `${(r.durationMs / 1000).toFixed(1)}s`],
  ];
  for (const [k, v] of rows) console.log(`  ${k.padEnd(18)} ${v}`);
  const skips = Object.entries(r.variants?.skips ?? {}).sort((a, b) => b[1] - a[1]);
  if (skips.length) console.log(`  ${"gate verdicts".padEnd(18)} ${skips.map(([k, v]) => `${k}: ${v}`).join(" · ")}`);
}
