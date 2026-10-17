"use client";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { EquityPoint } from "@/lib/types";
import { clock, compact, DOWN, niceTicks, UP, usd, usdSigned } from "./format";
import { useReducedMotion } from "./useStream";

interface Props {
  points: EquityPoint[];
  baseline?: number;
  height?: number;
  mode?: "equity" | "pnl";
  /** Shared y-domain for small multiples (in equity units). */
  domain?: [number, number];
  compactAxes?: boolean;
  emptyLabel?: string;
  label: string;
}

const PAD = { l: 52, r: 14, t: 12, b: 24 };
const PAD_COMPACT = { l: 34, r: 8, t: 8, b: 16 };

/** Animated cumulative-equity curve: draws on mount, tweens new points in. */
export function EquityCurve({
  points,
  baseline = 100,
  height = 300,
  mode = "equity",
  domain,
  compactAxes = false,
  emptyLabel = "Waiting for first run",
  label,
}: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const pathRef = useRef<SVGPathElement>(null);
  const [width, setWidth] = useState(800);
  const [hover, setHover] = useState<number | null>(null);
  const reduced = useReducedMotion();
  const uid = useId().replace(/:/g, "");
  const pad = compactAxes ? PAD_COMPACT : PAD;

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(120, Math.floor(e!.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Tween the newest point in over ~400ms instead of snapping.
  const [shown, setShown] = useState(points);
  const prev = useRef(points);
  useEffect(() => {
    const old = prev.current;
    prev.current = points;
    const appended =
      !reduced && old.length >= 2 && points.length === old.length + 1 && old[old.length - 1]!.runId === points[points.length - 2]!.runId;
    if (!appended) {
      setShown(points);
      return;
    }
    const from = old[old.length - 1]!;
    const to = points[points.length - 1]!;
    const t0 = performance.now();
    let raf = 0;
    const step = (now: number) => {
      const k = Math.min(1, (now - t0) / 400);
      const e = 1 - (1 - k) ** 3;
      setShown([...points.slice(0, -1), { ...to, t: from.t + (to.t - from.t) * e, equity: from.equity + (to.equity - from.equity) * e }]);
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [points, reduced]);

  const val = (p: EquityPoint) => (mode === "pnl" ? p.equity - baseline : p.equity);
  const base = mode === "pnl" ? 0 : baseline;

  const g = useMemo(() => {
    const w = width - pad.l - pad.r;
    const h = height - pad.t - pad.b;
    const pts = shown;
    const ys = pts.map(val);
    let y0 = domain ? (mode === "pnl" ? domain[0] - baseline : domain[0]) : Math.min(base, ...ys);
    let y1 = domain ? (mode === "pnl" ? domain[1] - baseline : domain[1]) : Math.max(base, ...ys);
    const span = y1 - y0 || Math.max(1, Math.abs(base) * 0.02);
    y0 -= span * 0.08;
    y1 += span * 0.08;
    if (y0 === y1) {
      y0 -= 1;
      y1 += 1;
    }
    const ts = pts.map((p) => p.t);
    const x0 = ts.length ? Math.min(...ts) : 0;
    const x1 = ts.length ? Math.max(...ts) : 1;
    const sx = (t: number) => pad.l + (pts.length < 2 ? w : ((t - x0) / (x1 - x0 || 1)) * w);
    const sy = (v: number) => pad.t + h - ((v - y0) / (y1 - y0)) * h;
    let d = "";
    pts.forEach((p, i) => {
      d += `${i === 0 || p.gapBefore ? "M" : "L"}${sx(p.t).toFixed(1)},${sy(val(p)).toFixed(1)} `;
    });
    const area = pts.length >= 2 ? `${d} L${sx(x1).toFixed(1)},${sy(base).toFixed(1)} L${sx(x0).toFixed(1)},${sy(base).toFixed(1)} Z` : "";
    // Max drawdown span, for shading.
    let peak = -Infinity;
    let peakI = 0;
    let dd = { abs: 0, a: 0, b: 0 };
    ys.forEach((v, i) => {
      if (v > peak) {
        peak = v;
        peakI = i;
      }
      if (peak - v > dd.abs) dd = { abs: peak - v, a: peakI, b: i };
    });
    return { w, h, sx, sy, d, area, y0, y1, x0, x1, dd, ticks: niceTicks(y0, y1, compactAxes ? 3 : 5) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shown, width, height, domain, mode, baseline, compactAxes]);

  // Draw-on animation: re-run when the series is replaced (not on tweens).
  const drawKey = `${points.length > 0 ? points[0]!.runId : 0}:${mode}:${width}`;
  useEffect(() => {
    const el = pathRef.current;
    if (!el || reduced) return;
    const len = el.getTotalLength();
    el.style.setProperty("--len", String(len));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drawKey, reduced]);

  const last = shown[shown.length - 1];
  const lastVal = last ? val(last) : base;
  const isUp = lastVal >= base;
  const baseFrac = height > 0 ? Math.min(1, Math.max(0, g.sy(base) / height)) : 0.5;
  const xTicks = useMemo(() => {
    if (shown.length < 2) return [] as number[];
    const n = compactAxes ? 2 : Math.max(2, Math.min(6, Math.floor(g.w / 140)));
    return Array.from({ length: n + 1 }, (_, i) => g.x0 + ((g.x1 - g.x0) * i) / n);
  }, [shown.length, g, compactAxes]);
  const spanMs = g.x1 - g.x0;
  const fmtT = (t: number) => {
    const d = new Date(t);
    if (spanMs > 2 * 86400_000) return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
    return clock(t).slice(0, 5);
  };

  const onMove = (e: React.MouseEvent<SVGRectElement>) => {
    if (shown.length < 2) return;
    const rect = (e.target as SVGRectElement).getBoundingClientRect();
    const x = e.clientX - rect.left + pad.l;
    let best = 0;
    let bd = Infinity;
    shown.forEach((p, i) => {
      const dx = Math.abs(g.sx(p.t) - x);
      if (dx < bd) {
        bd = dx;
        best = i;
      }
    });
    setHover(best);
  };
  const hp = hover !== null ? shown[hover] : null;
  const fs = compactAxes ? 9 : 10;

  return (
    <div ref={wrapRef} style={{ position: "relative", width: "100%" }}>
      <svg
        width={width}
        height={height}
        role="img"
        aria-label={`${label}: ${shown.length} points, current ${mode === "pnl" ? usdSigned(lastVal) : usd(lastVal)}`}
        style={{ display: "block", overflow: "visible" }}
      >
        <defs>
          <linearGradient id={`gu${uid}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={UP} stopOpacity="0.4" />
            <stop offset="1" stopColor={UP} stopOpacity="0" />
          </linearGradient>
          <linearGradient id={`gd${uid}`} x1="0" y1="1" x2="0" y2="0">
            <stop offset="0" stopColor={DOWN} stopOpacity="0.45" />
            <stop offset="1" stopColor={DOWN} stopOpacity="0" />
          </linearGradient>
          {/* The line itself: green above the break-even line, red below it. */}
          <linearGradient id={`gs${uid}`} gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2={height}>
            <stop offset={baseFrac} stopColor={UP} />
            <stop offset={baseFrac} stopColor={DOWN} />
          </linearGradient>
          <clipPath id={`ca${uid}`}>
            <rect x={0} y={0} width={width} height={Math.max(0, g.sy(base))} />
          </clipPath>
          <clipPath id={`cb${uid}`}>
            <rect x={0} y={g.sy(base)} width={width} height={Math.max(0, height - g.sy(base))} />
          </clipPath>
          <filter id={`glow${uid}`} x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="3" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* grid + y axis */}
        {g.ticks.map((v) => (
          <g key={v}>
            <line x1={pad.l} x2={width - pad.r} y1={g.sy(v)} y2={g.sy(v)} stroke="#2a2828" strokeWidth={1} />
            <text x={pad.l - 6} y={g.sy(v) + 3} textAnchor="end" fontSize={fs} fill="#7d7979">
              {mode === "pnl" ? (v > 0 ? "+" : v < 0 ? "−" : "") + compact(Math.abs(v)) : compact(v)}
            </text>
          </g>
        ))}
        <line x1={pad.l} x2={pad.l} y1={pad.t} y2={height - pad.b} stroke="#3a3737" strokeWidth={2} />
        <line x1={pad.l} x2={width - pad.r} y1={height - pad.b} y2={height - pad.b} stroke="#3a3737" strokeWidth={2} />
        {xTicks.map((t, i) => (
          <text
            key={i}
            x={g.sx(t)}
            y={height - pad.b + (compactAxes ? 11 : 15)}
            textAnchor={i === 0 ? "start" : i === xTicks.length - 1 ? "end" : "middle"}
            fontSize={fs}
            fill="#7d7979"
          >
            {fmtT(t)}
          </text>
        ))}

        {/* max drawdown shading */}
        {shown.length > 2 && g.dd.abs > 0 && !compactAxes && (
          <rect
            x={g.sx(shown[g.dd.a]!.t)}
            y={pad.t}
            width={Math.max(1, g.sx(shown[g.dd.b]!.t) - g.sx(shown[g.dd.a]!.t))}
            height={g.h}
            fill={DOWN}
            opacity={0.06}
          >
            <title>{`Max drawdown ${usd(g.dd.abs)}`}</title>
          </rect>
        )}

        {/* reference line at the starting bankroll */}
        <line
          x1={pad.l}
          x2={width - pad.r}
          y1={g.sy(base)}
          y2={g.sy(base)}
          stroke="#7d7979"
          strokeDasharray="4 4"
          strokeWidth={1}
        />

        {shown.length >= 2 ? (
          <>
            <path d={g.area} fill={`url(#gu${uid})`} clipPath={`url(#ca${uid})`} />
            <path d={g.area} fill={`url(#gd${uid})`} clipPath={`url(#cb${uid})`} />
            <path
              key={drawKey}
              ref={pathRef}
              className={reduced ? undefined : "equity-path"}
              d={g.d}
              fill="none"
              stroke={`url(#gs${uid})`}
              strokeWidth={compactAxes ? 1.5 : 2.25}
              strokeLinejoin="round"
              strokeLinecap="round"
              filter={compactAxes ? undefined : `url(#glow${uid})`}
            />
            {last && (
              <rect
                x={g.sx(last.t) - 4}
                y={g.sy(lastVal) - 4}
                width={8}
                height={8}
                fill={isUp ? UP : DOWN}
              >
                {!reduced && <animate attributeName="opacity" values="1;0.35;1" dur="1.6s" repeatCount="indefinite" />}
              </rect>
            )}
          </>
        ) : shown.length === 1 ? (
          <rect x={g.sx(shown[0]!.t) - 4} y={g.sy(val(shown[0]!)) - 4} width={8} height={8} fill={val(shown[0]!) >= base ? UP : DOWN} />
        ) : (
          <>
            <line x1={pad.l} x2={width - pad.r} y1={g.sy(base)} y2={g.sy(base)} stroke="#605d5d" strokeWidth={2} />
            <text x={pad.l + 10} y={g.sy(base) - 10} fontSize={compactAxes ? 10 : 12} fill="#9b9797" letterSpacing="0.1em">
              {emptyLabel.toUpperCase()}
            </text>
          </>
        )}

        {/* crosshair */}
        {hp && (
          <g pointerEvents="none">
            <line x1={g.sx(hp.t)} x2={g.sx(hp.t)} y1={pad.t} y2={height - pad.b} stroke="#ff9783" strokeWidth={1} strokeDasharray="2 3" />
            <circle cx={g.sx(hp.t)} cy={g.sy(val(hp))} r={4} fill="#121010" stroke={val(hp) >= base ? UP : DOWN} strokeWidth={2} />
          </g>
        )}
        <rect
          x={pad.l}
          y={pad.t}
          width={Math.max(0, g.w)}
          height={Math.max(0, g.h)}
          fill="transparent"
          onMouseMove={onMove}
          onMouseLeave={() => setHover(null)}
        />
      </svg>
      {hp && (
        <div
          className="tooltip"
          style={{
            left: Math.min(width - 190, Math.max(0, g.sx(hp.t) + 12)),
            top: Math.max(0, g.sy(val(hp)) - 70),
          }}
        >
          <div className="muted">{new Date(hp.t).toLocaleString("en-GB", { hour12: false })}</div>
          <div>EQUITY {usd(hp.equity)}</div>
          <div className={hp.equity >= baseline ? "up" : "down"}>PNL {usdSigned(hp.equity - baseline)}</div>
          {hp.runId > 0 && <div className="muted">RUN #{hp.runId}</div>}
        </div>
      )}
    </div>
  );
}
