export const mean = (xs: readonly number[]): number =>
  xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length;

export function stdev(xs: readonly number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - 1));
}

export const tail = <T>(xs: readonly T[], n: number): T[] =>
  n <= 0 ? [] : xs.slice(Math.max(0, xs.length - n));

export function pctChange(xs: readonly number[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < xs.length; i++) {
    const prev = xs[i - 1]!;
    out.push(prev === 0 ? 0 : (xs[i]! - prev) / prev);
  }
  return out;
}

export const clipLower = (xs: readonly number[], lo: number) => xs.map((x) => Math.max(lo, x));
export const clipUpper = (xs: readonly number[], hi: number) => xs.map((x) => Math.min(hi, x));
export const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));

/** Tiny, fast, well-distributed seedable PRNG. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Standard normal draw via Box-Muller, from any uniform RNG. */
export function gaussian(rng: () => number): number {
  let u = 0;
  while (u === 0) u = rng();
  const v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
