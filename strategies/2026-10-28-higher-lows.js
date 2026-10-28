/**
 * =============================================================================
 * Strategy: Higher Lows (market structure)               — tried on 2026-10-28
 * =============================================================================
 * THE IDEA (trend defined by the FLOOR, not by an average):
 *   - Chart readers define an uptrend with no indicators at all: "higher
 *     highs and higher lows". Every trend filter the lab has tried (SMA
 *     cross, MACD, Ichimoku, 200-day line) smooths CLOSES. This one reads
 *     only the lows - the prices where buyers last stepped in.
 *   - Rule: compare two consecutive 20-day windows.
 *       recent floor = lowest LOW of the last 20 days
 *       prior  floor = lowest LOW of the 20 days before that
 *     If the recent floor is HIGHER than the prior floor, buyers are
 *     defending ever-higher prices -> hold BTC. If it is LOWER, the
 *     market has made a lower low (structure broke) -> cash.
 *   - The floor only moves when price sets a genuine new extreme, so it
 *     ignores the day-to-day noise that whipsawed fast filters; a
 *     structure break needs a real low, not just a red candle.
 *
 * WHY IT MIGHT WORK: it is a stop-loss-style rule (exit when the old floor
 *   fails) paired with a re-entry that needs a rising floor, so it exits
 *   downtrends early without being fooled by a single wick, and it never
 *   uses a lagging average.
 * WHY IT MIGHT FAIL: the signal is slow by construction - a lower low only
 *   prints after price has already fallen below the old floor, so the exit
 *   sells well off the top, and the re-entry waits for a higher low to
 *   form, buying well off the bottom. Both ends give back return.
 *
 * HOW TO CHANGE THINGS: tweak the constant below and re-run:
 *   node backtest/run.js strategies/2026-10-28-higher-lows.js
 *   - WINDOW: length of each floor window in days (shorter = more signals,
 *     more whipsaw; longer = slower, closer to a 200-day style filter)
 * =============================================================================
 */

const WINDOW = 20; // days per floor window; we compare two back-to-back windows

/** Lowest LOW over `days` candles ending at `end` (inclusive). */
function floor(candles, end, days) {
  let lo = Infinity;
  for (let i = end - days + 1; i <= end; i++) lo = Math.min(lo, candles[i].low);
  return lo;
}

module.exports = {
  name: "Higher Lows 20d",
  description:
    "Market structure: hold BTC while the lowest low of the last 20 days is above the lowest low of the 20 days before (rising floor), cash when the floor breaks lower",

  decide({ candles, index, position }) {
    // Warm-up: need two full windows of history.
    if (index < WINDOW * 2 - 1) return "hold";

    const recentFloor = floor(candles, index, WINDOW);
    const priorFloor = floor(candles, index - WINDOW, WINDOW);

    // Rising floor -> buyers defending higher prices -> be invested.
    if (recentFloor > priorFloor && position === "cash") return "buy";

    // Floor broke lower -> structure failed -> stand aside.
    if (recentFloor < priorFloor && position === "btc") return "sell";

    return "hold";
  },
};
