/**
 * Kelly criterion for Polymarket-style binary bets.
 *
 * Buying YES at `oddsPrice` (0 < price < 1), each share pays $1 if correct.
 * Profit on win = (1 - price), loss on lose = price.
 *
 *   f* = (p*b - q) / b,  where b = (1/price) - 1, q = 1 - p
 *
 * Returns 0 when the bet has no edge — never negative.
 */
export function calculateKelly(probWin: number, oddsPrice: number): number {
  if (oddsPrice <= 0 || oddsPrice >= 1) return 0;
  const b = 1 / oddsPrice - 1;
  const q = 1 - probWin;
  return Math.max(0, (probWin * b - q) / b);
}

/**
 * Binary settlement of a stake bought at `price`, net of round-trip cost.
 * A win returns stake/price shares worth $1 each; a loss forfeits the stake.
 */
export function settleBinary(won: boolean, stake: number, price: number, costBps: number): number {
  if (stake <= 0 || price <= 0 || price >= 1) return 0;
  const gross = won ? stake / price - stake : -stake;
  return gross - stake * (costBps / 10_000);
}
