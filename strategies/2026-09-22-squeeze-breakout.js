/**
 * =============================================================================
 * Strategy: Volatility Squeeze Breakout                 — tried on 2026-09-22
 * =============================================================================
 * THE IDEA (volatility as a TIMING tool — a family not tried standalone yet):
 *   - Markets alternate between quiet "coiling" phases and explosive moves.
 *     A famous pattern: when volatility gets unusually LOW (a "squeeze"),
 *     a big move often follows soon — the calm before the storm.
 *   - This is timely: the market has been calming since the Feb 2026 vol
 *     spike, so squeezes are exactly the setups appearing right now.
 *   - SQUEEZE = today's 20-day volatility is in the lowest quarter of its
 *     own last 120 days (i.e. "quieter than 75% of the recent past").
 *   - BUY only when a squeeze is on AND price closes above the upper
 *     Bollinger band (20-day average + 2 standard deviations): the coil
 *     just released UPWARD, with us aboard from the very first day.
 *   - SELL on a close below the prior 10-day low — the exact exit that made
 *     Donchian Breakout the reigning champion.
 *
 * HOW THIS DIFFERS from the champion: Donchian buys EVERY new 20-day high.
 * This buys a much rarer event — a new high that erupts out of unusual
 * quiet — betting those breakouts are the highest-quality ones.
 * (Lesson applied from the Vol Regime Hybrid failures: volatility is used
 * only to FILTER a proven entry, not to switch between conflicting rules.)
 *
 * WHY IT MIGHT WORK: breakouts from compression have a natural "fuel tank" —
 * everyone who fell asleep during the quiet phase has to chase the move.
 * WHY IT MIGHT FAIL: the squeeze filter may be TOO picky — if it only fires
 * a handful of times in 2 years, one or two bad signals dominate the result,
 * and sitting in cash the rest of the time forfeits buy-and-hold gains.
 *
 * HOW TO CHANGE THINGS: tweak the constants below and re-run:
 *   node backtest/run.js strategies/2026-09-22-squeeze-breakout.js
 *   - SQUEEZE_PERCENTILE 0.25 -> 0.5 = looser squeeze definition, more trades
 *   - BAND_STDDEV 2 -> 1.5 = earlier (but less confirmed) breakout entries
 * =============================================================================
 */

const BB_DAYS = 20;              // Bollinger window: average + stddev of closes
const BAND_STDDEV = 2;           // upper band = SMA + 2 standard deviations
const SQUEEZE_LOOKBACK = 120;    // compare today's vol against this many days
const SQUEEZE_PERCENTILE = 0.25; // "squeeze" = vol in the lowest 25% of those
const EXIT_DAYS = 10;            // the champion's exit: close under 10-day low

/** Mean and standard deviation of the closes ending at `index`. */
function bollinger(candles, index, days) {
  if (index + 1 < days) return null;
  let sum = 0;
  for (let i = index - days + 1; i <= index; i++) sum += candles[i].close;
  const mean = sum / days;
  let variance = 0;
  for (let i = index - days + 1; i <= index; i++) {
    variance += (candles[i].close - mean) ** 2;
  }
  return { mean, sd: Math.sqrt(variance / days) };
}

/**
 * Is today's volatility in the lowest SQUEEZE_PERCENTILE of the last
 * SQUEEZE_LOOKBACK days? Volatility here = band width relative to price
 * (sd / mean), so it's comparable across different price levels.
 * Only reads candles up to `index` — no lookahead.
 */
function inSqueeze(candles, index) {
  if (index + 1 < BB_DAYS + SQUEEZE_LOOKBACK) return false;
  const widths = [];
  for (let i = index - SQUEEZE_LOOKBACK + 1; i <= index; i++) {
    const bb = bollinger(candles, i, BB_DAYS);
    widths.push(bb.sd / bb.mean);
  }
  const today = widths[widths.length - 1];
  const sorted = [...widths].sort((a, b) => a - b);
  const cutoff = sorted[Math.floor(sorted.length * SQUEEZE_PERCENTILE)];
  return today <= cutoff;
}

/** Lowest close of the `days` candles BEFORE `index` (today excluded). */
function lowestClose(candles, index, days) {
  if (index < days) return null;
  let l = Infinity;
  for (let i = index - days; i < index; i++) l = Math.min(l, candles[i].close);
  return l;
}

module.exports = {
  name: "Squeeze Breakout",
  description:
    "Volatility timing: buy only a breakout above the upper Bollinger band that erupts from a low-volatility squeeze; exit on a 10-day low",

  decide({ candles, index, position }) {
    // Warm-up: need the Bollinger window plus the squeeze history behind it.
    if (index + 1 < BB_DAYS + SQUEEZE_LOOKBACK) return "hold";

    const today = candles[index].close;

    if (position === "cash") {
      // Entry: the market is unusually quiet AND price just punched through
      // the upper band — the coil is releasing upward.
      const bb = bollinger(candles, index, BB_DAYS);
      const upperBand = bb.mean + BAND_STDDEV * bb.sd;
      if (inSqueeze(candles, index) && today > upperBand) return "buy";
    } else {
      // Exit: the proven fast escape — a close below the prior 10-day low.
      if (today < lowestClose(candles, index, EXIT_DAYS)) return "sell";
    }

    return "hold";
  },
};
