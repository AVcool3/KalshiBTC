/**
 * =============================================================================
 * Strategy: Rubber Band (50-day)                         — tried on 2026-10-27
 * =============================================================================
 * THE IDEA (mean reversion measured as DISTANCE from an average):
 *   - Picture price attached to its 50-day average by a rubber band. When
 *     price stretches far BELOW the average, the band is taut and tends to
 *     snap price back up toward it. Rule:
 *       BUY  when the close is more than STRETCH (10%) below the 50-day SMA
 *       SELL when the close gets back up to the 50-day SMA (band relaxed)
 *   - Related lab results, and how this differs: RSI Mean Reversion
 *     (+1.5%) measured the SIZE of recent moves, Drawdown Bargain
 *     (+19.7%, one trade) measured distance from the 180-day HIGH, and Red
 *     Streak (+9.9%) counted consecutive down days. None measured distance
 *     from a moving AVERAGE, which is the textbook rubber-band signal
 *     (it is the core of Bollinger-style %b and "Z-score" reversion).
 *
 * WHY IT MIGHT WORK: the three buy-weakness tests above all found real
 *   bounces (win rates 80-100%), just too few or too small to beat holding.
 *   A 10% stretch is rare and deep, so each trade has room to pay the 1.2%
 *   round-trip fee, and the exit at the average has a clear anchor.
 * WHY IT MIGHT FAIL: in the real crashes (the thing that actually hurts BTC)
 *   price stays stretched below the average for weeks - the band "snaps"
 *   only after you have sat through the worst of it, and the lab's one
 *   validated edge says AVOIDING those periods beats buying them.
 *
 * HOW TO CHANGE THINGS: tweak the constants below and re-run:
 *   node backtest/run.js strategies/2026-10-27-rubber-band.js
 *   - SMA_DAYS: the average the band is tied to
 *   - STRETCH: how far below it price must fall before we buy (0.10 = 10%)
 * =============================================================================
 */

const SMA_DAYS = 50;   // the average price is "tied" to
const STRETCH = 0.10;  // buy when close is this far below that average

/** Simple average of the last SMA_DAYS closes ending at `index`. */
function sma(candles, index) {
  let sum = 0;
  for (let i = index - SMA_DAYS + 1; i <= index; i++) sum += candles[i].close;
  return sum / SMA_DAYS;
}

module.exports = {
  name: "Rubber Band 50d/10%",
  description:
    "Mean reversion to an average: buy when price is 10%+ below its 50-day SMA (band stretched), sell when it snaps back up to the average",

  decide({ candles, index, position }) {
    if (index < SMA_DAYS) return "hold"; // warm-up

    const close = candles[index].close;
    const avg = sma(candles, index);

    // Stretched far below the average -> expect the snap-back -> buy.
    if (position === "cash" && close < avg * (1 - STRETCH)) return "buy";

    // Back at the average -> the band has relaxed -> take the bounce.
    if (position === "btc" && close >= avg) return "sell";

    return "hold";
  },
};
