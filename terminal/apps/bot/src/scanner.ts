import {
  computeIndicators,
  enabledMarkets,
  fetchCandles,
  fetchFundingRate,
  fetchPolymarketOdds,
  makePredictor,
  settleBinary,
  tail,
  volatilityRegime,
  atrPct,
  type Candle,
  type CandleTuple,
  type Config,
  type Direction,
  type LiveSignal,
  type TrackedMarket,
  findMarket,
} from "@kronos/core";
import {
  insertEvent,
  insertOddsSnapshot,
  insertSamples,
  insertTrade,
  openTrades,
  readRuntimeConfig,
  resolveSample,
  resolveTrade,
  tradeStats,
  unresolvedLiveSamples,
  type DB,
} from "@kronos/db";
import { decideWithVolatility } from "./backtest";
import { log } from "./args";

const DECISION_MARGIN_MS = 5_000; // decide at least 5s before the window opens

const toTuple = (c: Candle): CandleTuple => [c.timestamp.getTime(), c.open, c.high, c.low, c.close, c.volume];
const pct = (x: number) => `${(x * 100).toFixed(0)}%`;

export interface ScanResult {
  signals: LiveSignal[];
  bets: number;
}

/**
 * One scan over every enabled market. Predicts each market once per
 * window: the first cycle that sees a new target slug runs the model; later
 * cycles in the same window only refresh the real-odds tape.
 */
export class Scanner {
  private decided = new Map<string, string>(); // marketId → slug already decided
  private readonly db: DB;
  private readonly baseCfg: () => Config;

  constructor(db: DB, cfgFactory: () => Config) {
    this.db = db;
    this.baseCfg = cfgFactory;
  }

  async cycle(opts: { force?: boolean; markets?: TrackedMarket[] } = {}): Promise<ScanResult> {
    const cfg = this.baseCfg(); // re-reads runtime-config.json every cycle
    const runtime = readRuntimeConfig();
    const markets = opts.markets ?? enabledMarkets();
    const candleCache = new Map<string, Promise<{ candles: Candle[]; source: string }>>();
    const signals: LiveSignal[] = [];
    let betsThisCycle = 0;

    for (const market of markets) {
      const now = new Date();
      const { slug, windowStart } = market.polymarketSlug(now);
      const windowEnd = new Date(windowStart.getTime() + market.horizonMinutes * 60_000);

      // Real odds every cycle: this is the tape that will one day replace simulated prices.
      const odds = await fetchPolymarketOdds(slug).catch(() => null);
      if (odds && Object.keys(odds.outcomes).length) {
        insertOddsSnapshot(this.db, {
          marketId: market.id,
          slug,
          upPrice: odds.outcomes.UP?.yesPrice ?? null,
          downPrice: odds.outcomes.DOWN?.yesPrice ?? null,
          upMid: odds.mid.UP ?? null,
          downMid: odds.mid.DOWN ?? null,
        });
      }
      if (!opts.force && this.decided.get(market.id) === slug) continue;

      // Compute the deadline BEFORE predicting, and refuse to act if we overshoot.
      const deadline = windowStart.getTime() - DECISION_MARGIN_MS;
      const stats = tradeStats(this.db, cfg.initialBankroll);
      const base: LiveSignal = {
        marketId: market.id,
        marketName: market.name,
        short: market.short,
        horizonMinutes: market.horizonMinutes,
        slug,
        windowStart: windowStart.toISOString(),
        windowEnd: windowEnd.toISOString(),
        decidedAt: new Date().toISOString(),
        predictorName: cfg.predictor === "kronos" ? `kronos-${cfg.modelName}` : "heuristic",
        mock: cfg.predictor !== "kronos",
        candleSource: "",
        prediction: null,
        odds: odds
          ? {
              real: true,
              up: odds.outcomes.UP?.yesPrice ?? null,
              down: odds.outcomes.DOWN?.yesPrice ?? null,
              upMid: odds.mid.UP ?? null,
              downMid: odds.mid.DOWN ?? null,
              question: odds.question,
            }
          : null,
        decision: null,
        indicators: null,
        atrPct: null,
        regime: null,
        fundingRate: null,
        candles: [],
        bankroll: stats.bankroll,
        paused: runtime.paused,
        error: null,
      };

      try {
        const key = `${market.bybitSymbol}:${market.bybitInterval}`;
        if (!candleCache.has(key)) {
          candleCache.set(key, fetchCandles(cfg, { symbol: market.bybitSymbol, interval: market.bybitInterval }));
        }
        const { candles, source } = await candleCache.get(key)!;
        base.candleSource = source;
        base.candles = tail(candles, 72).map(toTuple);

        const predictor = makePredictor(cfg, { horizonMinutes: market.horizonMinutes });
        const prediction = await predictor.predict(candles, cfg);
        const funding = await fetchFundingRate(market.bybitSymbol);
        const indicators = computeIndicators(candles, prediction.direction, cfg, { fundingRate: funding });

        // Correlation shrink: BTC and ETH up/down are nearly the same bet.
        const shrinkFactor = 1 / (1 + betsThisCycle + stats.openCount);
        let decision = decideWithVolatility(prediction, odds, cfg, stats.bankroll, indicators, candles, { shrinkFactor });
        if (decision.bet && runtime.paused) decision = { ...decision, bet: false, betUsd: 0, skipReason: "Paused from dashboard" };
        if (decision.bet && Date.now() > deadline) {
          decision = { ...decision, bet: false, betUsd: 0, skipReason: "Missed window deadline" };
        }

        Object.assign(base, {
          prediction,
          decision,
          indicators,
          atrPct: Number.isFinite(atrPct(candles, cfg.atrPeriod)) ? atrPct(candles, cfg.atrPeriod) : null,
          regime: volatilityRegime(candles, cfg.atrPeriod),
          fundingRate: funding,
          mock: prediction.mock,
          predictorName: predictor.name,
        });

        insertSamples(this.db, [
          {
            timestamp: new Date().toISOString(),
            source: "live",
            marketId: market.id,
            predictorName: predictor.name,
            modelProb: prediction.direction === "UP" ? prediction.probUp : prediction.probDown,
            direction: prediction.direction,
            regime: base.regime,
            slug,
          },
        ]);

        if (decision.bet && decision.marketPrice !== null) {
          betsThisCycle++;
          insertTrade(this.db, {
            openedAt: new Date().toISOString(),
            marketId: market.id,
            slug,
            direction: decision.direction,
            modelProb: decision.modelProb,
            marketPrice: decision.marketPrice,
            edge: decision.edge,
            stakeUsd: decision.betUsd,
            kellyRaw: decision.kellyRaw,
            windowStart: windowStart.toISOString(),
            windowEnd: windowEnd.toISOString(),
            oddsReal: true,
          });
          insertEvent(this.db, {
            kind: "bet",
            marketId: market.id,
            message: `${market.short} ${decision.direction} $${decision.betUsd.toFixed(2)} @ ${decision.marketPrice.toFixed(2)} · p ${pct(decision.modelProb)} · edge ${(decision.edge * 100).toFixed(1)}pp (paper)`,
          });
        } else {
          insertEvent(this.db, {
            kind: "skip",
            marketId: market.id,
            message: `${market.short} ${prediction.direction} ${pct(prediction.confidence)} · ${decision.skipReason ?? "skipped"}`,
          });
        }
        log(
          `${market.short.padEnd(8)} ${prediction.direction.padEnd(4)} p↑ ${pct(prediction.probUp).padStart(4)}  ` +
            `mkt ${decision.marketPrice?.toFixed(2) ?? " —  "}  ${decision.bet ? `BET $${decision.betUsd}` : decision.skipReason}` +
            `${prediction.mock ? "  [heuristic]" : ""}`,
        );
      } catch (err) {
        base.error = (err as Error).message;
        insertEvent(this.db, { kind: "error", marketId: market.id, message: `${market.short}: ${base.error.slice(0, 240)}` });
        log(`${market.short.padEnd(8)} ERROR ${base.error}`);
      }

      insertEvent(this.db, { kind: "cycle", marketId: market.id, message: `${market.short} cycle`, payload: base });
      this.decided.set(market.id, slug);
      signals.push(base);
    }
    return { signals, bets: betsThisCycle };
  }

  /**
   * Settle paper trades and label live samples once their window has
   * closed. Polymarket's own resolution wins when it is published; the
   * exchange candle (close ≥ open over the window) is the fallback.
   */
  async resolve(cfg: Config): Promise<number> {
    let resolved = 0;
    const cutoff = Date.now() - 60_000;
    const outcomeCache = new Map<string, Promise<{ dir: Direction; changePct: number | null } | null>>();
    const outcome = (marketId: string, slug: string) => {
      if (!outcomeCache.has(slug)) outcomeCache.set(slug, this.windowOutcome(cfg, marketId, slug));
      return outcomeCache.get(slug)!;
    };

    for (const t of openTrades(this.db)) {
      if (Date.parse(t.windowEnd) > cutoff) continue;
      const o = await outcome(t.marketId, t.slug);
      if (!o) continue;
      const won = o.dir === t.direction;
      const pnl = settleBinary(won, t.stakeUsd, t.marketPrice, cfg.roundTripCostBps);
      resolveTrade(this.db, t.id, won, pnl);
      insertEvent(this.db, {
        kind: "resolve",
        marketId: t.marketId,
        message: `${findMarket(t.marketId)?.short ?? t.marketId} ${t.direction} ${won ? "WON" : "LOST"} ${pnl >= 0 ? "+" : "−"}$${Math.abs(pnl).toFixed(2)} (paper)`,
      });
      resolved++;
    }
    for (const s of unresolvedLiveSamples(this.db)) {
      const market = findMarket(s.marketId);
      const startUnix = Number(s.slug?.split("-").pop());
      if (!market || !Number.isFinite(startUnix)) continue;
      if ((startUnix + market.horizonMinutes * 60) * 1000 > cutoff) continue;
      const o = await outcome(s.marketId, s.slug!);
      if (o) resolveSample(this.db, s.id, o.dir, o.changePct);
    }
    return resolved;
  }

  private async windowOutcome(cfg: Config, marketId: string, slug: string) {
    const market = findMarket(marketId);
    if (!market) return null;
    const startMs = Number(slug.split("-").pop()) * 1000;
    // 1. Polymarket's own settlement.
    const odds = await fetchPolymarketOdds(slug).catch(() => null);
    if (odds?.closed) {
      const up = odds.mid.UP ?? odds.outcomes.UP?.yesPrice;
      if (up !== undefined && (up >= 0.99 || up <= 0.01)) return { dir: (up >= 0.99 ? "UP" : "DOWN") as Direction, changePct: null };
    }
    // 2. Exchange candle covering the window.
    try {
      const { candles } = await fetchCandles(cfg, {
        symbol: market.bybitSymbol,
        interval: String(market.horizonMinutes),
        limit: Math.ceil((Date.now() - startMs) / (market.horizonMinutes * 60_000)) + 3,
      });
      const c = candles.find((x) => x.timestamp.getTime() === startMs);
      if (!c) return null;
      return { dir: (c.close >= c.open ? "UP" : "DOWN") as Direction, changePct: ((c.close - c.open) / c.open) * 100 };
    } catch {
      return null;
    }
  }
}
