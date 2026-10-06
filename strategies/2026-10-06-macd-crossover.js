/**
 * =============================================================================
 * Strategy: MACD Crossover (12/26/9)                    — tried on 2026-10-06
 * =============================================================================
 * THE IDEA (the most famous indicator we haven't tested yet):
 *   - MACD = "Moving Average Convergence Divergence", the 1970s classic.
 *   - Take two EXPONENTIAL moving averages of price (12-day and 26-day).
 *     EMAs weight recent days more than old ones, so they turn faster than
 *     the simple averages our first strategy used.
 *   - MACD LINE = fast EMA minus slow EMA. Positive and rising = upward
 *     momentum building; negative and falling = downward momentum.
 *   - SIGNAL LINE = a 9-day EMA of the MACD line itself (a smoothed
 *     version of the momentum reading).
 *   - BUY when the MACD line crosses ABOVE its signal line (momentum just
 *     turned up faster than its own trend). SELL on the cross below.
 *
 * THE EXPERIMENT: this is the EMA-based cousin of our day-one SMA
 * Crossover 10/30 (+2.88%, whipsawed to death). MACD reacts faster and
 * triggers on momentum-vs-its-own-smoothing rather than price-vs-price.
 * Does the extra responsiveness help, or just whipsaw even faster?
 *
 * WHY IT MIGHT FAIL: crossover systems of any flavor have lost here —
 * faster signals usually mean MORE trades, and the scoreboard says fees
 * punish every extra round-trip (0.6% per side).
 *
 * HOW TO CHANGE THINGS: tweak the constants below and re-run:
 *   node backtest/run.js strategies/2026-10-06-macd-crossover.js
 *   - FAST/SLOW/SIGNAL are the classic 12/26/9; try 19/39/9 for a slower,
 *     less whipsaw-prone variant.
 * =============================================================================
 */

const FAST = 12;   // fast EMA window (days)
const SLOW = 26;   // slow EMA window (days)
const SIGNAL = 9;  // EMA window applied to the MACD line itself

/**
 * Exponential moving average of a plain array of numbers.
 * Seeded with the first value; k = 2/(n+1) is the standard EMA weight.
 * Returns the full EMA series (same length as values).
 */
function emaSeries(values, n) {
  const k = 2 / (n + 1);
  const out = [values[0]];
  for (let i = 1; i < values.length; i++) {
    out.push(values[i] * k + out[i - 1] * (1 - k));
  }
  return out;
}

// ---------------------------------------------------------------------------
// MACD is naturally a whole-series computation (EMAs build on all history),
// so we compute it once on first call and cache it. The cache only ever
// holds values derived from candles[0..i] at each position i — reading
// macdLine[index] uses no future data, so there is no lookahead.
// ---------------------------------------------------------------------------
let cache = null; // { length, macd: [...], signal: [...] }

function computeMacd(candles) {
  const closes = candles.map((c) => c.close);
  const fastEma = emaSeries(closes, FAST);
  const slowEma = emaSeries(closes, SLOW);
  const macd = closes.map((_, i) => fastEma[i] - slowEma[i]);
  const signal = emaSeries(macd, SIGNAL);
  return { length: candles.length, macd, signal };
}

module.exports = {
  name: "MACD Crossover 12/26/9",
  description:
    "Classic momentum: buy when the MACD line crosses above its 9-day signal line, sell when it crosses back below - the EMA cousin of the day-one SMA crossover",

  decide({ candles, index, position }) {
    // Warm-up: let the EMAs stabilize past their seed values.
    if (index < SLOW + SIGNAL) return "hold";

    // (Re)build the cached series when a new backtest pass starts.
    if (!cache || cache.length !== candles.length) cache = computeMacd(candles);

    const above = cache.macd[index] > cache.signal[index];
    const aboveYesterday = cache.macd[index - 1] > cache.signal[index - 1];

    // Fresh cross UP -> momentum turned positive -> buy.
    if (above && !aboveYesterday && position === "cash") return "buy";

    // Fresh cross DOWN -> momentum turned negative -> sell.
    if (!above && aboveYesterday && position === "btc") return "sell";

    // Also handle being on the wrong side without a fresh cross (e.g. the
    // warm-up ended mid-trend): align with the current side once.
    if (above && position === "cash") return "buy";
    if (!above && position === "btc") return "sell";

    return "hold";
  },
};
