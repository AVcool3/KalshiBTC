/**
 * =============================================================================
 * Strategy: SMA Crossover (10-day vs 30-day)          — tried on 2026-09-17
 * =============================================================================
 * THE IDEA (classic trend-following):
 *   - Compute two Simple Moving Averages (SMAs) of the closing price:
 *     a FAST one (last 10 days) and a SLOW one (last 30 days).
 *   - When the fast SMA crosses ABOVE the slow SMA, price momentum is turning
 *     up -> BUY ("golden cross").
 *   - When the fast SMA crosses BELOW the slow SMA, momentum is turning
 *     down -> SELL ("death cross").
 *
 * WHY IT MIGHT WORK: BTC tends to move in long trends; riding the trend and
 * stepping aside when it flips can beat holding through big crashes.
 * WHY IT MIGHT FAIL: in sideways/choppy markets it "whipsaws" — buys high,
 * sells low, over and over, bleeding fees.
 *
 * HOW TO CHANGE THINGS: tweak FAST_DAYS / SLOW_DAYS below and re-run:
 *   node backtest/run.js strategies/2026-09-17-sma-crossover.js
 * =============================================================================
 */

const FAST_DAYS = 10; // lookback for the fast (reactive) moving average
const SLOW_DAYS = 30; // lookback for the slow (stable) moving average

/**
 * Simple Moving Average of closing prices over the `days` candles ending at
 * `index`. Returns null if there isn't enough history yet.
 */
function sma(candles, index, days) {
  if (index + 1 < days) return null; // not enough candles yet
  let sum = 0;
  for (let i = index - days + 1; i <= index; i++) {
    sum += candles[i].close;
  }
  return sum / days;
}

module.exports = {
  name: "SMA Crossover 10/30",
  description:
    "Trend-following: buy when the 10-day average crosses above the 30-day, sell when it crosses back below",

  /**
   * Called by the engine once per day.
   *  - candles[0..index] = all price history known "today"
   *  - position = "cash" or "btc" (what we're currently holding)
   * Must return "buy", "sell", or "hold".
   */
  decide({ candles, index, position }) {
    const fast = sma(candles, index, FAST_DAYS);
    const slow = sma(candles, index, SLOW_DAYS);

    // Warm-up period: not enough history to compute both averages yet.
    if (fast === null || slow === null) return "hold";

    // Fast above slow = uptrend -> we want to be IN the market.
    if (fast > slow && position === "cash") return "buy";

    // Fast below slow = downtrend -> we want to be OUT of the market.
    if (fast < slow && position === "btc") return "sell";

    return "hold"; // already positioned the way we want
  },
};
