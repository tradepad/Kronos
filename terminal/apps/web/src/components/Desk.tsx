"use client";
import { useMemo, useState } from "react";
import type { LiveSignal } from "@/lib/types";
import { ForecastChart } from "./Charts";
import { EquityCurve } from "./EquityCurve";
import { ago, clock, fixed, hhmmss, pct, pp, price, signClass, usd, usdSigned } from "./format";
import { CalibrationPanel, GatePanel, Lifetime, RunsTable, SettingsDrawer, StrategyPanel, TradesTable, VotePanel } from "./Panels";
import { useNow, useStream } from "./useStream";

const RANGES = { "1H": 3600e3, "24H": 86400e3, "7D": 7 * 86400e3, "30D": 30 * 86400e3, ALL: Infinity } as const;
type Range = keyof typeof RANGES;

export function Desk() {
  const s = useStream();
  const now = useNow(1000);
  const [selected, setSelected] = useState<string>("btc-updown-5m");
  const [range, setRange] = useState<Range>("ALL");
  const [drawer, setDrawer] = useState(false);

  const source = s.summary?.source ?? s.status?.config.backtestSource ?? "worker";
  const bt = s.summary?.backtest;
  const paper = s.summary?.paper;
  const bot = s.status?.bot;
  const sidecar = bot?.sidecar;
  const signal = s.signals.find((x) => x.marketId === selected) ?? s.signals[0] ?? null;

  const equity = useMemo(() => {
    const pts = s.backtest?.equity ?? [];
    if (range === "ALL" || pts.length === 0) return pts;
    const end = pts[pts.length - 1]!.t;
    return pts.filter((p) => p.t >= end - RANGES[range]);
  }, [s.backtest, range]);
  const rangePnl = equity.length > 1 ? equity[equity.length - 1]!.equity - equity[0]!.equity : (equity[0]?.pnl ?? 0);
  const totalPnl = bt?.totalPnl ?? 0;
  const barMax = Math.max(1e-9, ...(s.backtest?.runPnls ?? []).map((r) => Math.abs(r.pnl)));

  const modelLabel = bot?.predictor ?? (sidecar?.ok ? `kronos (${sidecar.loadedVariants.join(",") || "loading"})` : "—");
  const modelSub = sidecar?.ok
    ? `${(sidecar.device ?? "?").toUpperCase()} · ${bot?.sampleCount ?? "?"} SAMPLES`
    : bot?.predictor === "heuristic"
      ? "BASELINE · NO MODEL"
      : "SIDECAR OFFLINE";

  return (
    <main className={`desk${s.connected ? "" : " stale"}`} aria-busy={!s.connected}>
      {/* ── KPI row ─────────────────────────────────────────────── */}
      <section className="grid kpis" aria-label="Key figures">
        <div className="kpi brand">
          <div className="brand-row">
            <div className="brand-mark" aria-hidden />
            <div className="brand-name">KRONOS DESK</div>
            <span className="tag">v0.1</span>
            <button className="icon-btn" aria-label="Open settings" onClick={() => setDrawer(true)}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                <path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6" />
              </svg>
            </button>
          </div>
          <div className="brand-meta">
            <span>// POLYMARKET</span>
            <span>5M · 15M</span>
            <span className={`live${s.connected ? "" : " off"}`}>{s.connected ? "STREAM" : "RECONNECTING"}</span>
            <span className={`live${bot?.online ? "" : " off"}`}>{bot?.online ? "BOT ONLINE" : "BOT OFFLINE"}</span>
            <span className={source === "backfill" ? "tag solid" : "tag"} title="Which backtest table the dashboard is reading">
              SRC {source.toUpperCase()}
            </span>
          </div>
        </div>
        <Kpi label="PAPER BANKROLL" value={usd(paper?.bankroll)} sub={`${usdSigned(paper?.realizedPnl)} REALISED · ${paper?.openCount ?? 0} OPEN`} tone={signClass(paper?.realizedPnl)} />
        <Kpi label={`BACKTEST PNL · ${source.toUpperCase()}`} value={usdSigned(totalPnl)} sub={`${bt?.runs ?? 0} RUNS · SIM ODDS`} tone={signClass(totalPnl)} />
        <Kpi label="GATED WIN RATE" value={bt && bt.betsPlaced ? pct(bt.winRate, 1) : "—"} sub={`${bt?.betsPlaced ?? 0} BETS · ROI ${pct(bt?.roi ?? null, 1)}`} />
        <Kpi label="RAW ACCURACY" value={bt && bt.rawPredictions ? pct(bt.rawAccuracy, 1) : "—"} sub={`${(bt?.rawPredictions ?? 0).toLocaleString()} CALLS · UNGATED`} tone={bt && bt.rawPredictions ? (bt.rawAccuracy >= 0.5 ? "up" : "down") : ""} />
        <Kpi label="BRIER · LOG LOSS" value={fixed(s.backtest?.calibration.brier ?? bt?.avgBrier ?? null, 3)} sub={`LOG ${fixed(s.backtest?.calibration.logLoss ?? bt?.avgLogLoss ?? null, 3)} · COIN 0.250`} />
        <Kpi label="MODEL" value={modelLabel.toUpperCase()} sub={modelSub} small />
      </section>

      {/* ── Body ────────────────────────────────────────────────── */}
      <section className="grid body">
        {/* Left */}
        <div className="col">
          <div className="panel">
            <div className="ph">
              <div className="ph-title">Signal radar</div>
              <div className="ph-meta">
                <span className={`live${bot?.online ? "" : " off"}`}>{bot?.online ? "LIVE" : "IDLE"}</span>
              </div>
            </div>
            {s.signals.length === 0 ? (
              <div className="empty">
                <strong>No live signals yet.</strong> The scanner writes one per market each window. Start it with{" "}
                <code>pnpm bot --loop</code>.
              </div>
            ) : (
              s.signals.map((sig) => (
                <MarketRow key={sig.marketId} sig={sig} active={sig.marketId === signal?.marketId} onPick={() => setSelected(sig.marketId)} now={now} />
              ))
            )}
          </div>

          <WindowClock signal={signal} now={now} paperOpen={paper?.openStake ?? 0} odds={s.status?.oddsSnapshots ?? 0} />

          <div className="panel grow">
            <div className="ph">
              <div className="ph-title">Event tape</div>
              <div className="ph-meta">{s.tape?.events.length ?? 0} RECENT</div>
            </div>
            <div className="tape" role="log" aria-live="polite">
              {(s.tape?.events ?? []).length === 0 ? (
                <div className="empty">Bets, skips, settlements and backfill runs land here as they happen.</div>
              ) : (
                s.tape!.events.map((e) => (
                  <div key={e.id} className="tape-row">
                    <div>
                      <div className={`tape-kind ${e.kind}`}>{e.kind.toUpperCase()}</div>
                      <div className="tape-time">{clock(e.timestamp)}</div>
                    </div>
                    <div className="tape-text">{e.message}</div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        {/* Center */}
        <div className="col">
          <div className="panel">
            <div className="ph">
              <div className="ph-title">Equity pulse / {source === "backfill" ? "35-day backfill sweep" : "live backtest worker"}</div>
              <div className="ph-meta">
                <div className="seg" role="group" aria-label="Time range">
                  {(Object.keys(RANGES) as Range[]).map((r) => (
                    <button key={r} aria-pressed={range === r} onClick={() => setRange(r)}>
                      {r}
                    </button>
                  ))}
                </div>
                <span className={`live${s.connected ? "" : " off"}`}>LIVE</span>
              </div>
            </div>
            <div className="hero">
              <div style={{ display: "flex", alignItems: "flex-end", gap: 24, flexWrap: "wrap" }}>
                <div className={`hero-num live-num ${signClass(range === "ALL" ? totalPnl : rangePnl)}`}>
                  {usdSigned(range === "ALL" ? totalPnl : rangePnl, 2)}
                </div>
                <div className="hero-side">
                  <span className={signClass(bt?.roi ?? 0)}>
                    {(bt?.roi ?? 0) >= 0 ? "▲" : "▼"} {pct(bt?.roi ?? null, 1)} ROI ON {usd(bt?.totalWagered ?? 0, 0)}
                  </span>
                  <span className="muted">
                    SHARPE {fixed(s.backtest?.sharpe ?? null, 2)} · DIRECTIONAL ONLY
                  </span>
                </div>
              </div>
              <div className="chips">
                <span className="tag warn">SIMULATED ODDS</span>
                {signal?.regime && <span className="tag neutral">VOL {signal.regime.toUpperCase()}</span>}
                <span className={source === "backfill" ? "tag solid" : "tag"}>{source.toUpperCase()}</span>
              </div>
            </div>
            <div className="chart-wrap live-num">
              <EquityCurve points={equity} height={300} label="Cumulative backtest equity" />
            </div>
            <div className="bars live-num" aria-label="Per-run PnL, most recent 120 runs">
              {(s.backtest?.runPnls ?? []).map((r, i) => (
                <div
                  key={i}
                  title={`${new Date(r.t).toLocaleString("en-GB", { hour12: false })}  ${usdSigned(r.pnl)}`}
                  style={{
                    height: `${Math.max(3, (Math.abs(r.pnl) / barMax) * 100)}%`,
                    background: r.pnl > 0 ? "var(--up)" : r.pnl < 0 ? "var(--down)" : "var(--color-neutral-700)",
                    opacity: 0.35 + 0.65 * (i / Math.max(1, (s.backtest?.runPnls.length ?? 1) - 1)),
                  }}
                />
              ))}
            </div>
            <div className="meter">
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
                <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
                  <span className={`big live-num ${bt && bt.rawPredictions ? (bt.rawAccuracy >= 0.5 ? "up" : "down") : ""}`} style={{ fontSize: 26 }}>
                    {bt && bt.rawPredictions ? pct(bt.rawAccuracy, 1) : "—"}
                  </span>
                  <span className="label" style={{ color: "var(--color-neutral-200)" }}>
                    Model hit rate vs coin flip
                  </span>
                </div>
                <span className="label">{(bt?.rawPredictions ?? 0).toLocaleString()} UNGATED CALLS</span>
              </div>
              <div className="meter-track">
                <div className="fill" style={{ width: `${(bt?.rawAccuracy ?? 0) * 100}%` }} />
                <div className="mark" style={{ left: "50%" }} title="50% = coin flip" />
              </div>
            </div>
            <div className="strip">
              <Stat label="MAX DRAWDOWN" value={usd(s.backtest?.maxDrawdown ?? 0)} tone="down" />
              <Stat label="RAW PNL · $1 FLAT" value={usdSigned(bt?.rawPnl ?? 0)} tone={signClass(bt?.rawPnl ?? 0)} />
              <Stat label="WINDOWS TESTED" value={(bt?.windows ?? 0).toLocaleString()} />
              <Stat label="LAST RUN" value={ago(bt?.lastRunAt ?? null, now)} />
            </div>
          </div>

          <div className="panel">
            <div className="ph">
              <div className="ph-title">Kronos forecast / {signal?.short ?? "—"} next window</div>
              <div className="ph-meta">
                {signal?.prediction && (
                  <span>
                    {signal.prediction.sampleCount} SAMPLES · SPREAD {price(signal.prediction.predictionSpread)}
                  </span>
                )}
                {signal?.mock && <span className="tag neutral">HEURISTIC BASELINE</span>}
              </div>
            </div>
            <div style={{ padding: "8px 16px 12px" }} className="live-num">
              <ForecastChart signal={signal} />
            </div>
          </div>
        </div>

        {/* Right */}
        <div className="col right">
          <VotePanel signal={signal} />
          <CalibrationPanel backtest={s.backtest} />
          <GatePanel backtest={s.backtest} />
          <StrategyPanel backtest={s.backtest} />
        </div>
      </section>

      <section className="grid wide">
        <Lifetime backtest={s.backtest} source={source} />
      </section>

      <section className="grid tables">
        <RunsTable backtest={s.backtest} />
        <TradesTable trades={s.tape?.trades ?? []} />
      </section>

      <footer className="foot">
        <span>
          PAPER TRADING ONLY — no order is ever sent to Polymarket or any exchange. Backtest PnL uses SIMULATED odds
          (0.50 ± 4%) and is an upper bound, not a forecast.
        </span>
        <span>
          {s.status?.oddsSnapshots ?? 0} real Polymarket price snapshots recorded · server {s.status ? clock(s.status.serverTime) : "—"}
        </span>
      </footer>

      {drawer && s.status && <SettingsDrawer config={s.status.config} onClose={() => setDrawer(false)} onSaved={s.refreshBacktest} />}
    </main>
  );
}

function Kpi({ label, value, sub, tone = "", small = false }: { label: string; value: string; sub: string; tone?: string; small?: boolean }) {
  return (
    <div className="kpi">
      <div className="label">{label}</div>
      <div className={`val live-num ${tone}`} style={small ? { fontSize: 18 } : undefined}>
        {value}
      </div>
      <div className="sub">{sub}</div>
    </div>
  );
}

function Stat({ label, value, tone = "" }: { label: string; value: string; tone?: string }) {
  return (
    <div>
      <div className="label">{label}</div>
      <div className={`v live-num ${tone}`}>{value}</div>
    </div>
  );
}

function MarketRow({ sig, active, onPick, now }: { sig: LiveSignal; active: boolean; onPick: () => void; now: number }) {
  const p = sig.prediction;
  const d = sig.decision;
  const dir = p?.direction ?? null;
  const code = sig.short.split(" ")[0]!;
  const meta = sig.error
    ? `⚠ ${sig.error}`
    : d?.bet
      ? `BET $${d.betUsd.toFixed(2)} @ ${d.marketPrice?.toFixed(2)} (paper)`
      : (d?.skipReason ?? "waiting");
  const stale = now > 0 && Date.parse(sig.windowEnd) < now;
  return (
    <>
      <button className="mkt" aria-pressed={active} onClick={onPick} title={sig.slug}>
        <div className={`mkt-code${dir === "DOWN" ? " cold" : ""}`}>{code}</div>
        <div style={{ minWidth: 0 }}>
          <div className="mkt-title">
            {sig.short}{" "}
            {dir && (
              <span className={dir === "UP" ? "up" : "down"}>
                {dir === "UP" ? "▲ UP" : "▼ DOWN"} {pct(p?.confidence ?? null)}
              </span>
            )}
            {stale && <span className="dim"> · stale</span>}
          </div>
          <div className="mkt-meta" title={meta}>
            {meta}
          </div>
        </div>
        <div className={`mkt-ring${d?.bet ? " bet" : sig.error ? " err" : ""}`} aria-label={d?.bet ? "bet placed" : "no bet"} />
      </button>
      {active && (
        <div className="mkt-stats" style={{ background: "color-mix(in srgb, var(--color-accent) 8%, var(--color-neutral-900))" }}>
          <div>
            <span className="k">P(SIDE)</span>
            <span className="v">{pct(d?.modelProb ?? null, 0)}</span>
          </div>
          <div>
            <span className="k">MKT</span>
            <span className="v">{d?.marketPrice != null ? d.marketPrice.toFixed(2) : sig.odds ? "—" : "N/A"}</span>
          </div>
          <div>
            <span className="k">EDGE</span>
            <span className={`v ${signClass(d?.edge ?? 0)}`}>{d && d.marketPrice != null ? pp(d.edge, 1) : "—"}</span>
          </div>
          <div>
            <span className="k">KELLY</span>
            <span className="v">{d && d.kellyAdjusted ? pct(d.kellyAdjusted, 1) : "—"}</span>
          </div>
        </div>
      )}
    </>
  );
}

function WindowClock({ signal, now, paperOpen, odds }: { signal: LiveSignal | null; now: number; paperOpen: number; odds: number }) {
  // Roll forward to the window that is open/next right now, even between signals.
  const minutes = signal?.horizonMinutes ?? 5;
  const ms = minutes * 60_000;
  const nextStart = Math.ceil(now / ms) * ms;
  const remaining = nextStart - now;
  const progress = now ? 1 - remaining / ms : 0;
  return (
    <div className="panel">
      <div className="ph">
        <div className="ph-title">Window clock</div>
        <div className="ph-meta">{signal?.short ?? "BTC 5M"}</div>
      </div>
      <div className="clock">
        <div className="clock-head">
          <span>NEXT {minutes}M WINDOW OPENS</span>
          <span className="live">LIVE</span>
        </div>
        <div className="clock-time" aria-live="off">
          {now ? hhmmss(remaining) : "--:--:--"}
        </div>
        <div className="clock-bar">
          <div style={{ width: `${progress * 100}%` }} />
        </div>
        <div className="clock-slug">{signal ? `${signal.slug} · decided ${clock(signal.decidedAt)}` : "no signal yet"}</div>
      </div>
      <div className="duo">
        <div>
          <div className="label">Cap deployed</div>
          <div className="v live-num">{usd(paperOpen)}</div>
        </div>
        <div>
          <div className="label">Odds tape</div>
          <div className="v live-num up">{odds.toLocaleString()}</div>
        </div>
      </div>
    </div>
  );
}
