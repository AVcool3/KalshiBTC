/**
 * =============================================================================
 * Strategy: Donchian Channel Breakout (20/10)          — tried on 2026-09-20
 * =============================================================================
 * THE IDEA (breakout trading — the "turtle traders" classic from the 1980s):
 *   - The Donchian channel is simply the HIGHEST high and LOWEST low of the
 *     last N days. Price breaking OUT of that range is treated as news.
 *   - If today's close beats the highest close of the previous ENTRY_DAYS
 *     (20) days -> BUY. A fresh 20-day high means buyers are in control and
 *     a new trend may be starting.
 *   - If today's close drops below the lowest close of the previous
 *     EXIT_DAYS (10) days -> SELL. A fresh 10-day low means the move is over.
 *   - The exit window (10) is shorter than the entry window (20) on purpose:
 *     slow to enter (avoid fakeouts), quick to exit (protect profits).
 *
 * HOW THIS DIFFERS from the two strategies already tried:
 *   - SMA crossover smooths price into averages; this reacts to raw extremes.
 *   - RSI mean reversion buys weakness; this buys STRENGTH (new highs),
 *     betting that "what's rising keeps rising" — momentum, not bounce.
 *
 * WHY IT MIGHT WORK: BTC's biggest gains historically come in bursts right
 * after breaking to new highs — this is designed to always be aboard then.
 * WHY IT MIGHT FAIL: in a range-bound market, breakouts fail ("fakeouts"):
 * it buys the top of the range, price falls back, it sells the bottom.
 *
 * HOW TO CHANGE THINGS: tweak the constants below and re-run:
 *   node backtest/run.js strategies/2026-09-20-donchian-breakout.js
 *   - Bigger ENTRY_DAYS (e.g. 55) = only the strongest breakouts, fewer trades
 *   - Bigger EXIT_DAYS (e.g. 20)  = looser stop, rides trends longer but
 *     gives back more profit when they end
 * =============================================================================
 */

const ENTRY_DAYS = 20; // buy when today's close beats the prior 20-day high
const EXIT_DAYS = 10;  // sell when today's close breaks the prior 10-day low

/**
 * Highest close among the `days` candles BEFORE `index` (today excluded —
 * we compare today's close against the previous days' record).
 * Returns null during warm-up. Only reads candles[index-days .. index-1].
 */
function highestClose(candles, index, days) {
  if (index < days) return null;
  let highest = -Infinity;
  for (let i = index - days; i < index; i++) {
    if (candles[i].close > highest) highest = candles[i].close;
  }
  return highest;
}

/** Lowest close among the `days` candles BEFORE `index`. Null in warm-up. */
function lowestClose(candles, index, days) {
  if (index < days) return null;
  let lowest = Infinity;
  for (let i = index - days; i < index; i++) {
    if (candles[i].close < lowest) lowest = candles[i].close;
  }
  return lowest;
}

module.exports = {
  name: "Donchian Breakout 20/10",
  description:
    "Turtle-style momentum: buy a close above the prior 20-day high, sell a close below the prior 10-day low",

  /**
   * Called by the engine once per day.
   *  - candles[0..index] = all price history known "today"
   *  - position = "cash" or "btc"
   * Must return "buy", "sell", or "hold".
   */
  decide({ candles, index, position }) {
    const today = candles[index].close;
    const entryLevel = highestClose(candles, index, ENTRY_DAYS);
    const exitLevel = lowestClose(candles, index, EXIT_DAYS);

    if (entryLevel === null || exitLevel === null) return "hold"; // warm-up

    // New 20-day high while in cash -> momentum breakout, get in.
    if (today > entryLevel && position === "cash") return "buy";

    // New 10-day low while holding -> trend broke down, get out.
    if (today < exitLevel && position === "btc") return "sell";

    return "hold";
  },
};
