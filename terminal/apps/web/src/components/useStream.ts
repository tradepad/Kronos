"use client";
import { useEffect, useRef, useState } from "react";
import type { BacktestPayload, LiveSignal, StatusPayload, SummaryPayload, TapePayload } from "@/lib/types";

export interface StreamState {
  summary: SummaryPayload | null;
  signals: LiveSignal[];
  status: StatusPayload | null;
  backtest: BacktestPayload | null;
  tape: TapePayload | null;
  connected: boolean;
  lastMessageAt: number | null;
}

/**
 * EventSource with automatic reconnect. `connected` drops when the stream
 * errors OR goes quiet for 8s, so the UI can grey out instead of showing
 * stale numbers as live.
 */
export function useStream(): StreamState & { refreshBacktest: () => void } {
  const [state, setState] = useState<StreamState>({
    summary: null,
    signals: [],
    status: null,
    backtest: null,
    tape: null,
    connected: false,
    lastMessageAt: null,
  });
  const last = useRef<number>(0);

  useEffect(() => {
    let es: EventSource | null = null;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let delay = 1000;
    const on = <K extends keyof StreamState>(key: K) => (ev: MessageEvent) => {
      last.current = Date.now();
      delay = 1000;
      try {
        const data = JSON.parse(ev.data) as StreamState[K];
        setState((s) => ({ ...s, [key]: data, connected: true, lastMessageAt: last.current }));
      } catch {
        /* ignore malformed frame */
      }
    };
    const connect = () => {
      es = new EventSource("/api/stream");
      es.addEventListener("summary", on("summary"));
      es.addEventListener("signal", on("signals"));
      es.addEventListener("status", on("status"));
      es.addEventListener("backtest", on("backtest"));
      es.addEventListener("tape", on("tape"));
      es.onerror = () => {
        setState((s) => ({ ...s, connected: false }));
        es?.close();
        retry = setTimeout(connect, delay);
        delay = Math.min(delay * 2, 15_000);
      };
    };
    connect();
    const watchdog = setInterval(() => {
      if (last.current && Date.now() - last.current > 8000) setState((s) => (s.connected ? { ...s, connected: false } : s));
    }, 2000);
    return () => {
      es?.close();
      clearTimeout(retry);
      clearInterval(watchdog);
    };
  }, []);

  const refreshBacktest = () => {
    void fetch("/api/backtest", { cache: "no-store" })
      .then((r) => r.json())
      .then((b: BacktestPayload) => setState((s) => ({ ...s, backtest: b })))
      .catch(() => undefined);
  };
  return { ...state, refreshBacktest };
}

export function useNow(intervalMs = 1000): number {
  // Starts at 0 so server and client render identically; ticks after mount.
  const [now, setNow] = useState(0);
  useEffect(() => {
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const fn = (e: MediaQueryListEvent) => setReduced(e.matches);
    mq.addEventListener("change", fn);
    return () => mq.removeEventListener("change", fn);
  }, []);
  return reduced;
}
