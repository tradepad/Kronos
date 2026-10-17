"use client";
import { useMemo, useState } from "react";
import type { BacktestPayload, LiveSignal, RuntimeConfig, TradeRow } from "@/lib/types";
import { Reliability } from "./Charts";
import { EquityCurve } from "./EquityCurve";
import { clock, fixed, pct, pp, signClass, usd, usdSigned } from "./format";

/* ── Model vote: the Monte Carlo split for the selected market ───────── */
export function VotePanel({ signal }: { signal: LiveSignal | null }) {
  const p = signal?.prediction;
  const up = p ? p.probUp : 0.5;
  const ind = signal?.indicators;
  return (
    <div className="panel">
      <div className="ph">
        <div className="ph-title">Model vote / {signal?.short ?? "—"}</div>
        <div className="ph-meta">{p ? `${p.sampleCount} DRAWS` : "NO SIGNAL"}</div>
      </div>
      <div className="vote">
        <div className="vote-top">
          <span className={`big live-num ${p ? (up >= 0.5 ? "up" : "down") : ""}`} style={{ fontSize: 34 }}>
            {p ? `${up >= 0.5 ? "▲" : "▼"} ${pct(Math.max(up, 1 - up))} ${up >= 0.5 ? "UP" : "DOWN"}` : "—"}
          </span>
          <span className="num muted live-num" style={{ fontSize: 12 }}>
            {p ? `P(UP) ${pct(up)}` : ""}
          </span>
        </div>
        <div className="vote-bar" role="img" aria-label={`Probability up ${pct(up)}`}>
          <div style={{ width: `${up * 100}%`, background: "var(--up)" }} />
          <div style={{ flex: 1, background: "var(--down-dim)" }} />
        </div>
        <div style={{ display: "flex", justifyContent: "space-between" }} className="label">
          <span>▲ UP</span>
          <span>DOWN ▼</span>
        </div>
      </div>
      <div className="duo">
        <div>
          <div className="label">Exp. move</div>
          <div className={`v live-num ${signClass(p?.predictedChangePct ?? 0)}`}>
            {p ? `${p.predictedChangePct >= 0 ? "+" : "−"}${Math.abs(p.predictedChangePct).toFixed(3)}%` : "—"}
          </div>
        </div>
        <div>
          <div className="label">Polymarket ↑ / ↓</div>
          <div className="v live-num">
            {signal?.odds ? `${fixed(signal.odds.up, 2)} / ${fixed(signal.odds.down, 2)}` : <span className="dim">no book</span>}
          </div>
        </div>
      </div>
      {ind?.votes && (
        <div className="ind-row" style={{ paddingTop: 12, borderTop: "var(--rule)" }} aria-label="Indicator votes">
          {ind.votes.map((v) => (
            <span
              key={v.name}
              className={`tag ${v.vote === null ? "neutral" : v.vote === "UP" ? "" : "cold"}`}
              title={v.value === null ? "inactive" : `value ${v.value.toFixed(4)}`}
            >
              {v.name} {v.vote === null ? "·" : v.vote === "UP" ? "▲" : "▼"}
            </span>
          ))}
          <span className={`tag ${ind.confirmed ? "solid" : "neutral"}`}>
            {ind.agreeing}/{ind.totalActive} AGREE
          </span>
        </div>
      )}
    </div>
  );
}

/* ── Calibration ─────────────────────────────────────────────────────── */
export function CalibrationPanel({ backtest }: { backtest: BacktestPayload | null }) {
  const [which, setWhich] = useState<"backtest" | "live">("backtest");
  const cal = which === "live" ? backtest?.liveCalibration : backtest?.calibration;
  return (
    <div className="panel">
      <div className="ph">
        <div className="ph-title">Calibration</div>
        <div className="seg" role="group" aria-label="Calibration source">
          <button aria-pressed={which === "backtest"} onClick={() => setWhich("backtest")}>
            {backtest?.source === "backfill" ? "BACKFILL" : "WORKER"}
          </button>
          <button aria-pressed={which === "live"} onClick={() => setWhich("live")}>
            LIVE
          </button>
        </div>
      </div>
      {!cal || cal.n === 0 ? (
        <div className="empty">
          No resolved predictions yet. {which === "live" ? "Live calls are scored once their window closes." : "Backtests score every window they test."}
        </div>
      ) : (
        <>
          <div style={{ padding: "12px 16px 4px" }}>
            <Reliability bins={cal.bins} />
          </div>
          <div className="strip" style={{ gridTemplateColumns: "repeat(3, minmax(0,1fr))" }}>
            <div style={{ padding: "10px 16px" }}>
              <div className="label">Brier</div>
              <div className={`v live-num ${cal.brier !== null && cal.brier > 0.25 ? "down" : ""}`} style={{ fontSize: 17 }}>
                {fixed(cal.brier, 3)}
              </div>
            </div>
            <div style={{ padding: "10px 16px" }}>
              <div className="label">Log loss</div>
              <div className="v live-num" style={{ fontSize: 17 }}>
                {fixed(cal.logLoss, 3)}
              </div>
            </div>
            <div style={{ padding: "10px 16px" }}>
              <div className="label">PSI · n</div>
              <div className={`v live-num ${cal.psi !== null && cal.psi > 0.2 ? "down" : ""}`} style={{ fontSize: 17 }}>
                {fixed(cal.psi, 2)} · {cal.n.toLocaleString()}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

/* ── Gate funnel: which gate rejected the most windows ───────────────── */
export function GatePanel({ backtest }: { backtest: BacktestPayload | null }) {
  const [which, setWhich] = useState<"backtest" | "live">("backtest");
  const data = (which === "live" ? backtest?.liveSkips : backtest?.skips) ?? {};
  const rows = Object.entries(data).sort((a, b) => b[1] - a[1]);
  const total = rows.reduce((a, [, n]) => a + n, 0);
  const max = Math.max(1, ...rows.map(([, n]) => n));
  return (
    <div className="panel">
      <div className="ph">
        <div className="ph-title">Gate verdicts</div>
        <div className="seg" role="group" aria-label="Gate source">
          <button aria-pressed={which === "backtest"} onClick={() => setWhich("backtest")}>
            TESTS
          </button>
          <button aria-pressed={which === "live"} onClick={() => setWhich("live")}>
            LIVE
          </button>
        </div>
      </div>
      {rows.length === 0 ? (
        <div className="empty">No windows evaluated yet.</div>
      ) : (
        <div style={{ padding: "6px 0" }}>
          {rows.map(([k, n]) => (
            <div key={k} className="hrow" title={`${n} of ${total} windows`}>
              <span className="name" style={k === "Bet placed" ? { color: "var(--up)" } : undefined}>
                {k.toUpperCase()}
              </span>
              <div className="htrack">
                <div style={{ width: `${(n / max) * 100}%`, background: k === "Bet placed" ? "var(--up)" : "var(--color-neutral-600)" }} />
              </div>
              <span className="n">{pct(n / total)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ── Strategy lab ────────────────────────────────────────────────────── */
const STRAT_LABEL: Record<string, string> = {
  "selective-edge-kelly": "SEL. EDGE",
  "high-confidence-75": "CONF ≥75",
  "fade-confidence-75": "FADE ≥75",
  "always-follow": "ALWAYS",
};
export function StrategyPanel({ backtest }: { backtest: BacktestPayload | null }) {
  const rows = Object.entries(backtest?.strategies ?? {});
  const max = Math.max(1e-9, ...rows.map(([, v]) => Math.abs(v.pnl)));
  return (
    <div className="panel grow">
      <div className="ph">
        <div className="ph-title">Strategy lab</div>
        <span className="tag neutral">{rows.length} TESTED</span>
      </div>
      {rows.length === 0 ? (
        <div className="empty">Every backtest run also scores four research strategies on the same windows.</div>
      ) : (
        <>
          {rows.map(([k, v]) => (
            <div
              key={k}
              className="hrow"
              style={{ gridTemplateColumns: "minmax(0,1.2fr) minmax(0,1fr) 70px 46px" }}
              title={`${v.bets} bets, ${v.wins} wins, wagered ${usd(v.wagered)}`}
            >
              <span className="name">{STRAT_LABEL[k] ?? k}</span>
              <div className="htrack" style={{ position: "relative" }}>
                <div style={{ width: `${(Math.abs(v.pnl) / max) * 100}%`, background: v.pnl >= 0 ? "var(--up)" : "var(--down)" }} />
              </div>
              <span className={`n ${signClass(v.pnl)}`}>{usdSigned(v.pnl, 0)}</span>
              <span className="n muted">{v.bets ? pct(v.wins / v.bets) : "—"}</span>
            </div>
          ))}
          <div className="empty" style={{ paddingTop: 8 }}>
            {rows.length} strategies tested on simulated odds: expect the best to look good by chance. FADE is the contrarian
            twin of CONF ≥75 — if both lose, the signal is noise.
          </div>
        </>
      )}
    </div>
  );
}

/* ── Lifetime 5-minute equity, four small multiples on one y-scale ───── */
const LRANGES = { "1H": 3600e3, "24H": 86400e3, "7D": 7 * 86400e3, "30D": 30 * 86400e3, ALL: Infinity } as const;
export function Lifetime({ backtest, source }: { backtest: BacktestPayload | null; source: "worker" | "backfill" }) {
  const [mode, setMode] = useState<"pnl" | "equity">("pnl");
  const [range, setRange] = useState<keyof typeof LRANGES>("ALL");
  const [busy, setBusy] = useState(false);

  const markets = useMemo(() => {
    const ms = backtest?.lifetime ?? [];
    if (range === "ALL") return ms;
    const end = Math.max(0, ...ms.flatMap((m) => m.points.map((p) => p.t)));
    return ms.map((m) => ({ ...m, points: m.points.filter((p) => p.t >= end - LRANGES[range]) }));
  }, [backtest, range]);
  // Same scale is non-negotiable: independent scales make $2 look like $200.
  const domain = useMemo<[number, number]>(() => {
    const ys = markets.flatMap((m) => m.points.map((p) => p.equity));
    return [Math.min(100, ...ys), Math.max(100, ...ys)];
  }, [markets]);

  const setSource = async (next: "worker" | "backfill") => {
    setBusy(true);
    await fetch("/api/config", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ backtestSource: next }),
    }).catch(() => undefined);
    setBusy(false);
  };
  const exportCsv = () => {
    const lines = ["market,bucket_start_utc,equity,cumulative_pnl"];
    for (const m of markets) for (const p of m.points) lines.push(`${m.marketId},${new Date(p.t).toISOString()},${p.equity.toFixed(4)},${p.pnl.toFixed(4)}`);
    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `kronos-lifetime-${source}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div className="panel">
      <div className="ph" style={{ flexWrap: "wrap" }}>
        <div className="ph-title">Lifetime 5-minute equity / per market</div>
        <div className="ph-meta" style={{ flexWrap: "wrap" }}>
          <div className="seg" role="group" aria-label="Value">
            <button aria-pressed={mode === "pnl"} onClick={() => setMode("pnl")}>
              PNL
            </button>
            <button aria-pressed={mode === "equity"} onClick={() => setMode("equity")}>
              EQUITY
            </button>
          </div>
          <div className="seg" role="group" aria-label="Backtest source">
            <button aria-pressed={source === "worker"} disabled={busy} onClick={() => void setSource("worker")}>
              WORKER
            </button>
            <button aria-pressed={source === "backfill"} disabled={busy} onClick={() => void setSource("backfill")}>
              BACKFILL
            </button>
          </div>
          <div className="seg" role="group" aria-label="Time range">
            {(Object.keys(LRANGES) as (keyof typeof LRANGES)[]).map((r) => (
              <button key={r} aria-pressed={range === r} onClick={() => setRange(r)}>
                {r}
              </button>
            ))}
          </div>
          <button className="btn ghost" style={{ padding: "5px 10px", fontSize: 11 }} onClick={exportCsv}>
            CSV ↓
          </button>
        </div>
      </div>
      <div className="multiples">
        {(markets.length ? markets : []).map((m) => (
          <div key={m.marketId}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6 }}>
              <span className="label" style={{ color: "var(--color-neutral-200)" }}>
                {m.short}
              </span>
              <span className={`num live-num ${signClass(m.totalPnl)}`} style={{ fontSize: 15 }}>
                {usdSigned(m.totalPnl)}
              </span>
            </div>
            <div className="live-num">
              <EquityCurve points={m.points} height={130} mode={mode} domain={domain} compactAxes emptyLabel="No runs yet" label={`${m.short} lifetime equity`} />
            </div>
            <div className="mstats">
              <div>
                WIN<span className="v">{m.bets ? pct(m.winRate) : "—"}</span>
              </div>
              <div>
                SHARPE<span className="v">{fixed(m.sharpe, 1)}</span>
              </div>
              <div>
                MAX DD<span className="v down">{usd(m.maxDrawdown, 0)}</span>
              </div>
              <div>
                STREAK<span className={`v ${signClass(m.streak)}`}>{m.streak > 0 ? `+${m.streak}` : m.streak}</span>
              </div>
              <div>
                RUNS<span className="v">{m.runs}</span>
              </div>
            </div>
          </div>
        ))}
      </div>
      {markets.length === 0 && <div className="empty">No runs in this source yet.</div>}
      <div className="sim-note" style={{ padding: "10px 16px" }}>
        Simulated odds · Sharpe on 5-minute buckets (√105,120) is directional only · gaps are shown as breaks, never interpolated
      </div>
    </div>
  );
}

/* ── Tables ──────────────────────────────────────────────────────────── */
export function RunsTable({ backtest }: { backtest: BacktestPayload | null }) {
  const rows = backtest?.recent ?? [];
  return (
    <div className="panel">
      <div className="ph">
        <div className="ph-title">Backtest runs / {backtest?.source ?? "worker"}</div>
        <span className="sim-note">Simulated odds</span>
      </div>
      <div className="table-wrap">
        {rows.length === 0 ? (
          <div className="empty">
            No runs yet. The worker inside <code>pnpm bot --loop</code> adds one every few seconds; <code>pnpm backfill</code> fills
            weeks of history.
          </div>
        ) : (
          <table className="t">
            <thead>
              <tr>
                <th>MARKET</th>
                <th>PREDICTOR</th>
                <th>WIN</th>
                <th>BETS</th>
                <th>WIN %</th>
                <th>PNL</th>
                <th>ROI</th>
                <th>RAW ACC</th>
                <th>RAW PNL</th>
                <th>BRIER</th>
                <th>REGIME</th>
                <th>FINISHED</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>{r.marketId.replace("-updown-", " ").toUpperCase()}</td>
                  <td>{r.predictorName}</td>
                  <td>{r.nWindows}</td>
                  <td>{r.betsPlaced}</td>
                  <td>{r.betsPlaced ? pct(r.winRate) : "—"}</td>
                  <td className={signClass(r.totalPnl)}>{usdSigned(r.totalPnl)}</td>
                  <td className={signClass(r.roi)}>{r.totalWagered ? pct(r.roi, 1) : "—"}</td>
                  <td className={r.rawAccuracy >= 0.5 ? "up" : "down"}>{pct(r.rawAccuracy)}</td>
                  <td className={signClass(r.rawPnl)}>{usdSigned(r.rawPnl)}</td>
                  <td>{fixed(r.brier, 3)}</td>
                  <td>{r.regime ?? "—"}</td>
                  <td className="muted">{new Date(r.finishedAt).toLocaleString("en-GB", { hour12: false, month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit" })}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

export function TradesTable({ trades }: { trades: TradeRow[] }) {
  return (
    <div className="panel">
      <div className="ph">
        <div className="ph-title">Paper trades</div>
        <span className="tag neutral">NEVER SUBMITTED</span>
      </div>
      <div className="table-wrap">
        {trades.length === 0 ? (
          <div className="empty">
            No paper trades yet. A trade is logged only when all six gates pass against a <strong>real</strong> Polymarket price.
          </div>
        ) : (
          <table className="t">
            <thead>
              <tr>
                <th>WINDOW</th>
                <th>SIDE</th>
                <th>PRICE</th>
                <th>EDGE</th>
                <th>STAKE</th>
                <th>RESULT</th>
              </tr>
            </thead>
            <tbody>
              {trades.map((t) => (
                <tr key={t.id} title={t.slug}>
                  <td>
                    {t.marketId.replace("-updown-", " ").toUpperCase()} <span className="muted">{clock(t.windowStart).slice(0, 5)}</span>
                  </td>
                  <td className={t.direction === "UP" ? "up" : "down"}>{t.direction === "UP" ? "▲ UP" : "▼ DN"}</td>
                  <td>{t.marketPrice.toFixed(2)}</td>
                  <td>{pp(t.edge)}</td>
                  <td>{usd(t.stakeUsd)}</td>
                  <td className={t.pnl === null ? "muted" : signClass(t.pnl)}>{t.pnl === null ? "OPEN" : usdSigned(t.pnl)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

/* ── Settings drawer: live-edits data/runtime-config.json ────────────── */
export function SettingsDrawer({ config, onClose, onSaved }: { config: RuntimeConfig; onClose: () => void; onSaved: () => void }) {
  const [draft, setDraft] = useState<RuntimeConfig>(config);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const set = <K extends keyof RuntimeConfig>(k: K, v: RuntimeConfig[K]) => setDraft((d) => ({ ...d, [k]: v }));
  const save = async () => {
    setSaving(true);
    const r = await fetch("/api/config", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(draft) });
    setSaving(false);
    if (r.ok) {
      setDraft((await r.json()) as RuntimeConfig);
      setSaved(new Date().toLocaleTimeString("en-GB", { hour12: false }));
      onSaved();
    }
  };
  const slider = (k: "minConfidence" | "minEdge" | "kellyFraction" | "maxBetPct", label: string, min: number, max: number, step: number, hint: string, fmt: (v: number) => string) => (
    <label className="field">
      <div className="field-top">
        <span className="label" style={{ color: "var(--color-neutral-200)" }}>
          {label}
        </span>
        <span className="num up">{fmt(draft[k])}</span>
      </div>
      <input type="range" min={min} max={max} step={step} value={draft[k]} onChange={(e) => set(k, Number(e.target.value))} />
      <span className="field-hint">{hint}</span>
    </label>
  );
  return (
    <>
      <div className="scrim" onClick={onClose} />
      <aside className="drawer" role="dialog" aria-modal="true" aria-label="Runtime settings" onKeyDown={(e) => e.key === "Escape" && onClose()}>
        <div className="ph">
          <div className="ph-title">Runtime config</div>
          <button className="icon-btn" aria-label="Close settings" onClick={onClose} autoFocus>
            ✕
          </button>
        </div>
        <div className="drawer-body">
          <p className="field-hint" style={{ margin: 0 }}>
            Writes <code className="num">data/runtime-config.json</code>. The bot reads it at the top of every cycle — no restart.
          </p>
          {slider("minConfidence", "Min confidence", 0.5, 0.95, 0.01, "Gate 1. Skip unless the Monte Carlo split is at least this lopsided.", (v) => pct(v))}
          {slider("minEdge", "Min edge", 0, 0.2, 0.005, "Gate 4. Model probability minus the price you'd pay.", (v) => pp(v))}
          {slider("kellyFraction", "Kelly fraction", 0, 1, 0.05, "Quarter Kelly (0.25) until calibration proves the probabilities.", (v) => `${v.toFixed(2)}×`)}
          {slider("maxBetPct", "Max bet", 0.01, 0.25, 0.01, "Hard cap per bet, as a share of bankroll.", (v) => pct(v))}
          <div className="field">
            <span className="label" style={{ color: "var(--color-neutral-200)" }}>
              Backtest source
            </span>
            <div className="seg" role="group" aria-label="Backtest source">
              <button aria-pressed={draft.backtestSource === "worker"} onClick={() => set("backtestSource", "worker")}>
                WORKER · LIVE ROLLING
              </button>
              <button aria-pressed={draft.backtestSource === "backfill"} onClick={() => set("backtestSource", "backfill")}>
                BACKFILL · HISTORY
              </button>
            </div>
          </div>
          <label className="field" style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
            <input type="checkbox" checked={draft.paused} onChange={(e) => set("paused", e.target.checked)} style={{ accentColor: "var(--color-accent)", width: 18, height: 18 }} />
            <span>
              <span className="label" style={{ color: "var(--color-neutral-200)" }}>
                Pause paper trading
              </span>
              <br />
              <span className="field-hint">Signals keep flowing; no new paper trades are logged.</span>
            </span>
          </label>
          <button className="btn" onClick={() => void save()} disabled={saving}>
            {saving ? "SAVING…" : "SAVE TO RUNTIME CONFIG →"}
          </button>
          {saved && <span className="field-hint">Saved at {saved}. Takes effect on the bot's next cycle.</span>}
        </div>
      </aside>
    </>
  );
}
