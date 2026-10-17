"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import type { LiveSignal, ReliabilityBin } from "@/lib/types";
import { clock, DOWN, niceTicks, pct, price, UP } from "./format";

function useWidth<T extends HTMLElement>(fallback = 600) {
  const ref = useRef<T>(null);
  const [w, setW] = useState(fallback);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(160, Math.floor(e!.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

/**
 * Recent candles plus the Kronos Monte Carlo cloud for the next window:
 * every sampled close as a tick, the 10–90% and 25–75% bands, the mean,
 * and the current close carried forward as the line the market resolves on.
 */
export function ForecastChart({ signal, height = 260 }: { signal: LiveSignal | null; height?: number }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const candles = useMemo(() => (signal?.candles ?? []).slice(-48), [signal]);
  const preds = signal?.prediction?.allPredictions ?? [];
  const cur = signal?.prediction?.currentClose ?? candles[candles.length - 1]?.[4] ?? null;

  const g = useMemo(() => {
    const pad = { l: 8, r: 64, t: 14, b: 22 };
    const projW = Math.max(70, width * 0.16);
    const plotW = width - pad.l - pad.r - projW;
    const h = height - pad.t - pad.b;
    const lows = candles.map((c) => c[3]);
    const highs = candles.map((c) => c[2]);
    let lo = Math.min(...lows, ...preds);
    let hi = Math.max(...highs, ...preds);
    if (!Number.isFinite(lo) || !Number.isFinite(hi)) {
      lo = 0;
      hi = 1;
    }
    const span = hi - lo || 1;
    lo -= span * 0.06;
    hi += span * 0.06;
    const sy = (v: number) => pad.t + h - ((v - lo) / (hi - lo)) * h;
    const cw = candles.length ? plotW / candles.length : plotW;
    const sx = (i: number) => pad.l + i * cw + cw / 2;
    const sorted = [...preds].sort((a, b) => a - b);
    const q = (p: number) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(p * (sorted.length - 1)))]! : NaN);
    return { pad, projW, plotW, h, sy, sx, cw, lo, hi, q, ticks: niceTicks(lo, hi, 4) };
  }, [candles, preds, width, height]);

  if (!signal || candles.length === 0) {
    return (
      <div ref={ref} className="empty" style={{ height }}>
        No candles yet for this market. The bot posts them with each signal — start it with <code>pnpm bot --loop</code>.
      </div>
    );
  }

  const projX0 = g.pad.l + g.plotW + 6;
  const projX1 = projX0 + g.projW - 12;
  const projMid = (projX0 + projX1) / 2;
  const mean = signal.prediction?.predictedCloseAvg ?? null;
  // Forecast bands take the colour of the call: green when the average path ends higher.
  const bandCol = mean !== null && cur !== null && mean < cur ? DOWN : UP;

  return (
    <div ref={ref} style={{ width: "100%" }}>
      <svg
        width={width}
        height={height}
        role="img"
        aria-label={`${signal.short} last ${candles.length} candles and ${preds.length} sampled forecasts; P(up) ${pct(signal.prediction?.probUp ?? null)}`}
        style={{ display: "block" }}
      >
        {g.ticks.map((v) => (
          <g key={v}>
            <line x1={g.pad.l} x2={width - g.pad.r} y1={g.sy(v)} y2={g.sy(v)} stroke="#2a2828" />
            <text x={width - g.pad.r + 6} y={g.sy(v) + 3} fontSize={10} fill="#7d7979">
              {price(v)}
            </text>
          </g>
        ))}
        {/* forecast zone */}
        <rect x={projX0 - 4} y={g.pad.t} width={g.projW - 4} height={g.h} fill="#ec3013" opacity={0.06} />
        <line x1={projX0 - 4} x2={projX0 - 4} y1={g.pad.t} y2={g.pad.t + g.h} stroke="#7c1405" strokeWidth={2} strokeDasharray="3 3" />
        <text x={projMid} y={g.pad.t + g.h + 15} fontSize={10} fill="#ff9783" textAnchor="middle">
          +{signal.horizonMinutes}M
        </text>

        {candles.map((c, i) => {
          const [t, o, hh, l, cl] = c;
          const up = cl >= o;
          const col = up ? UP : DOWN;
          const bw = Math.max(1.5, g.cw * 0.62);
          return (
            <g key={t}>
              <line x1={g.sx(i)} x2={g.sx(i)} y1={g.sy(hh)} y2={g.sy(l)} stroke={col} strokeWidth={1} opacity={0.85} />
              <rect
                x={g.sx(i) - bw / 2}
                y={g.sy(Math.max(o, cl))}
                width={bw}
                height={Math.max(1, Math.abs(g.sy(o) - g.sy(cl)))}
                fill={up ? col : "transparent"}
                stroke={col}
                strokeWidth={1}
              />
            </g>
          );
        })}
        {[0, Math.floor(candles.length / 2), candles.length - 1].map((i) =>
          candles[i] ? (
            <text key={i} x={g.sx(i)} y={g.pad.t + g.h + 15} fontSize={10} fill="#7d7979" textAnchor="middle">
              {clock(candles[i]![0]).slice(0, 5)}
            </text>
          ) : null,
        )}

        {cur !== null && (
          <>
            <line x1={g.pad.l} x2={projX1} y1={g.sy(cur)} y2={g.sy(cur)} stroke="#d7d3d3" strokeDasharray="2 4" strokeWidth={1} />
            <rect x={width - g.pad.r + 2} y={g.sy(cur) - 8} width={g.pad.r - 2} height={16} fill="#d7d3d3" />
            <text x={width - g.pad.r + 6} y={g.sy(cur) + 4} fontSize={10} fill="#121010" fontWeight={800}>
              {price(cur)}
            </text>
          </>
        )}

        {preds.length > 0 && (
          <g>
            <rect
              x={projX0}
              y={g.sy(g.q(0.9))}
              width={projX1 - projX0}
              height={Math.max(1, g.sy(g.q(0.1)) - g.sy(g.q(0.9)))}
              fill={bandCol}
              opacity={0.12}
            />
            <rect
              x={projX0 + (projX1 - projX0) * 0.2}
              y={g.sy(g.q(0.75))}
              width={(projX1 - projX0) * 0.6}
              height={Math.max(1, g.sy(g.q(0.25)) - g.sy(g.q(0.75)))}
              fill={bandCol}
              opacity={0.28}
            />
            {preds.map((p, i) => (
              <line
                key={i}
                x1={projX0 + 3}
                x2={projX1 - 3}
                y1={g.sy(p)}
                y2={g.sy(p)}
                stroke={cur !== null && p >= cur ? UP : DOWN}
                strokeWidth={1}
                opacity={0.55}
              />
            ))}
            {mean !== null && (
              <>
                <line x1={projX0} x2={projX1} y1={g.sy(mean)} y2={g.sy(mean)} stroke="#ffc4b8" strokeWidth={2.5} />
                <line
                  x1={g.sx(candles.length - 1)}
                  x2={projMid}
                  y1={g.sy(candles[candles.length - 1]![4])}
                  y2={g.sy(mean)}
                  stroke="#ffc4b8"
                  strokeWidth={1.5}
                  strokeDasharray="3 3"
                />
              </>
            )}
          </g>
        )}
      </svg>
    </div>
  );
}

/** 10-bin reliability diagram: predicted P(up) vs observed frequency. */
export function Reliability({ bins, height = 200 }: { bins: ReliabilityBin[]; height?: number }) {
  const [ref, width] = useWidth<HTMLDivElement>(320);
  const pad = { l: 30, r: 10, t: 10, b: 24 };
  const w = width - pad.l - pad.r;
  const h = height - pad.t - pad.b;
  const sx = (v: number) => pad.l + v * w;
  const sy = (v: number) => pad.t + h - v * h;
  const maxN = Math.max(1, ...bins.map((b) => b.count));
  const pts = bins.filter((b) => b.count > 0 && b.meanPred !== null && b.observed !== null);
  return (
    <div ref={ref} style={{ width: "100%" }}>
      <svg width={width} height={height} role="img" aria-label="Reliability diagram: predicted probability against observed frequency" style={{ display: "block" }}>
        {[0, 0.25, 0.5, 0.75, 1].map((v) => (
          <g key={v}>
            <line x1={pad.l} x2={pad.l + w} y1={sy(v)} y2={sy(v)} stroke="#2a2828" />
            <text x={pad.l - 4} y={sy(v) + 3} fontSize={9} fill="#7d7979" textAnchor="end">
              {v * 100}
            </text>
            <text x={sx(v)} y={height - 8} fontSize={9} fill="#7d7979" textAnchor="middle">
              {v * 100}
            </text>
          </g>
        ))}
        {bins.map((b) => (
          <rect
            key={b.lo}
            x={sx(b.lo) + 1}
            y={pad.t + h - (b.count / maxN) * h * 0.35}
            width={Math.max(1, w / bins.length - 2)}
            height={(b.count / maxN) * h * 0.35}
            fill="#3a3737"
          >
            <title>{`${Math.round(b.lo * 100)}–${Math.round(b.hi * 100)}%: ${b.count} predictions`}</title>
          </rect>
        ))}
        <line x1={sx(0)} y1={sy(0)} x2={sx(1)} y2={sy(1)} stroke="#7d7979" strokeDasharray="4 4" />
        {pts.length > 1 && (
          <polyline
            points={pts.map((b) => `${sx(b.meanPred!)},${sy(b.observed!)}`).join(" ")}
            fill="none"
            stroke="#ff563c"
            strokeWidth={2}
          />
        )}
        {pts.map((b) => (
          <rect key={b.lo} x={sx(b.meanPred!) - 3.5} y={sy(b.observed!) - 3.5} width={7} height={7} fill="#ff563c">
            <title>{`predicted ${pct(b.meanPred, 1)} → observed ${pct(b.observed, 1)} (n=${b.count})`}</title>
          </rect>
        ))}
      </svg>
    </div>
  );
}
