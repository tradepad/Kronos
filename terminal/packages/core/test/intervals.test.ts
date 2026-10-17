import { describe, expect, it } from "vitest";
import { binanceIntervalCode, bybitIntervalCode } from "../src/exchanges/candles";
import { findMarket } from "../src/markets";

describe("exchange interval codes", () => {
  it("maps minutes to each exchange's code", () => {
    expect(["5", "60", "240", "D"]).toEqual([5, 60, 240, 1440].map(bybitIntervalCode));
    expect(["5m", "30m", "1h", "4h", "1d"]).toEqual([5, 30, 60, 240, 1440].map(binanceIntervalCode));
  });
  it("defines the research horizons as disabled markets", () => {
    for (const id of ["btc-updown-30m", "eth-updown-1h", "btc-updown-4h", "eth-updown-1d"]) {
      expect(findMarket(id)?.enabled).toBe(false);
    }
    expect(findMarket("btc-updown-1d")?.bybitInterval).toBe("1440");
  });
});
