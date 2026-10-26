export const usd = (x: number | null | undefined, digits = 2): string => {
  if (x === null || x === undefined || !Number.isFinite(x)) return "—";
  const s = Math.abs(x).toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
  return `${x < 0 ? "−" : ""}$${s}`;
};
export const usdSigned = (x: number | null | undefined, digits = 2): string => {
  if (x === null || x === undefined || !Number.isFinite(x)) return "—";
  return `${x > 0 ? "+" : x < 0 ? "−" : "±"}$${Math.abs(x).toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
};
export const pct = (x: number | null | undefined, digits = 0): string =>
  x === null || x === undefined || !Number.isFinite(x) ? "—" : `${(x * 100).toFixed(digits)}%`;
export const pctSigned = (x: number | null | undefined, digits = 1): string =>
  x === null || x === undefined || !Number.isFinite(x) ? "—" : `${x > 0 ? "+" : x < 0 ? "−" : "±"}${Math.abs(x * 100).toFixed(digits)}%`;
export const pp = (x: number | null | undefined, digits = 1): string =>
  x === null || x === undefined || !Number.isFinite(x) ? "—" : `${x > 0 ? "+" : x < 0 ? "−" : "±"}${Math.abs(x * 100).toFixed(digits)}pp`;
export const fixed = (x: number | null | undefined, digits = 2): string =>
  x === null || x === undefined || !Number.isFinite(x) ? "—" : x.toFixed(digits);
export const price = (x: number | null | undefined): string => {
  if (x === null || x === undefined || !Number.isFinite(x)) return "—";
  return x >= 1000 ? x.toLocaleString("en-US", { maximumFractionDigits: 1 }) : x.toFixed(x >= 10 ? 2 : 4);
};
/** Gain / loss colours for SVG, where CSS classes don't reach. Keep in step with --up / --down. */
export const UP = "#2ee59d";
export const DOWN = "#ff563c";

export const signClass = (x: number | null | undefined) => (x === null || x === undefined || x === 0 ? "" : x > 0 ? "up" : "down");
export const hhmmss = (ms: number): string => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return [Math.floor(s / 3600), Math.floor(s / 60) % 60, s % 60].map((x) => String(x).padStart(2, "0")).join(":");
};
export const clock = (iso: string | number): string => {
  const d = new Date(iso);
  return d.toLocaleTimeString("en-GB", { hour12: false });
};
export const ago = (iso: string | null | undefined, now = Date.now()): string => {
  if (!iso) return "never";
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
};
/** "Nice" axis ticks. */
export function niceTicks(lo: number, hi: number, count = 5): number[] {
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return [];
  if (lo === hi) {
    lo -= 1;
    hi += 1;
  }
  const span = hi - lo;
  const raw = span / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => span / s <= count) ?? 10 * mag;
  const out: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + step * 1e-9; v += step) out.push(Number(v.toFixed(10)));
  return out;
}
export const compact = (x: number): string => {
  const a = Math.abs(x);
  if (a >= 1e6) return `${(x / 1e6).toFixed(1)}M`;
  if (a >= 1e3) return `${(x / 1e3).toFixed(a >= 1e4 ? 0 : 1)}K`;
  return a >= 100 ? x.toFixed(0) : a >= 10 ? x.toFixed(1) : x.toFixed(2);
};

/** Above / below a threshold (accuracy vs 50%), coloured like a gain or loss. */
export const aboveClass = (x: number | null | undefined, line: number) =>
  x === null || x === undefined || !Number.isFinite(x) || x === line ? "" : x > line ? "up" : "down";
