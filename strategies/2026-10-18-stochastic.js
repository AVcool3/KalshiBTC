/**
 * =============================================================================
 * Strategy: Stochastic Oscillator (14,3 / 20-80)        — tried on 2026-10-18
 * =============================================================================
 * THE IDEA (the last classic indicator the lab hasn't tested):
 *   - The stochastic oscillator (George Lane, 1950s) asks: WHERE inside its
 *     recent high-low range did price close?
 *       %K = (close - lowest low of 14 days) / (range of those 14 days) x 100
 *     0 = closing on the range floor, 100 = closing on the ceiling.
 *   - %D is a 3-day average of %K - a smoothed version of the same reading.
 *   - Classic rules, as the textbooks teach them:
 *       BUY  when %K crosses ABOVE %D while down in the oversold zone (<20):
 *            price stopped hugging the floor and turned up.
 *       SELL when %K crosses BELOW %D while up in the overbought zone (>80):
 *            price stopped hugging the ceiling and turned down.
 *   - This differs from RSI (which measures the SIZE of recent moves) by
 *     measuring POSITION within the range, and from the hammer (one day's
 *     shape) by using a two-week window. It is the last big name in the
 *     classic toolbox we have not measured.
 *
 * WHY IT MIGHT FAIL: it is still a buy-weakness oscillator at heart, and
 * the lab's ledger on those is grim - RSI (+1.5%), red streaks (+9.9%),
 * hammers (-8.2%) all found real bounces that fees and missed rallies ate.
 * And "overbought" exits sell into exactly the strength the Euphoria
 * Breaker proved you should hold through.
 *
 * HOW TO CHANGE THINGS: tweak the constants below and re-run:
 *   node backtest/run.js strategies/2026-10-18-stochastic.js
 *   - K_DAYS / D_DAYS: the classic 14 and 3
 *   - OVERSOLD / OVERBOUGHT: the 20/80 action zones
 * =============================================================================
 */

const K_DAYS = 14;      // range window for %K
const D_DAYS = 3;       // smoothing window for %D
const OVERSOLD = 20;    // buy-zone ceiling
const OVERBOUGHT = 80;  // sell-zone floor

/** Raw %K at `index`: where today's close sits in the 14-day high-low range. */
function pctK(candles, index) {
  let hi = -Infinity, lo = Infinity;
  for (let i = index - K_DAYS + 1; i <= index; i++) {
    hi = Math.max(hi, candles[i].high);
    lo = Math.min(lo, candles[i].low);
  }
  if (hi === lo) return 50; // flat range (never in practice) - neutral
  return ((candles[index].close - lo) / (hi - lo)) * 100;
}

/** %D at `index`: the D_DAYS-day average of %K. */
function pctD(candles, index) {
  let sum = 0;
  for (let i = index - D_DAYS + 1; i <= index; i++) sum += pctK(candles, i);
  return sum / D_DAYS;
}

module.exports = {
  name: "Stochastic 14,3 20/80",
  description:
    "Range position: buy a %K/%D upcross in the oversold zone (<20), sell a downcross in the overbought zone (>80) - the last untested classic indicator",

  decide({ candles, index, position }) {
    // Warm-up: %D at index-1 needs K_DAYS + D_DAYS of history behind it.
    if (index < K_DAYS + D_DAYS) return "hold";

    const k = pctK(candles, index);
    const d = pctD(candles, index);
    const kPrev = pctK(candles, index - 1);
    const dPrev = pctD(candles, index - 1);

    // Fresh upcross while oversold -> the floor-hugging just ended -> buy.
    if (position === "cash" && k > d && kPrev <= dPrev && k < OVERSOLD) {
      return "buy";
    }

    // Fresh downcross while overbought -> the ceiling-hugging ended -> sell.
    if (position === "btc" && k < d && kPrev >= dPrev && k > OVERBOUGHT) {
      return "sell";
    }

    return "hold";
  },
};
