/**
 * =============================================================================
 * Strategy: Chop Harvester (BB 20/2 + ER gate)           — tried on 2026-11-06
 * =============================================================================
 * THE IDEA (harvest sideways markets, but ONLY when it is actually sideways):
 *   - Every mean-reversion test so far (RSI, red streaks, hammer, rubber
 *     band, stochastic) bought weakness WITHOUT asking what kind of market
 *     it was in, and they all lost: in a real downtrend, "cheap" keeps
 *     getting cheaper. Yesterday's Efficiency Ratio (ER) gave us a way to
 *     measure that: ER near 0 = price is zig-zagging in place (chop),
 *     ER near 1 = price is walking in a straight line (trend).
 *   - This is the mirror of yesterday's strategy: allow mean-reversion
 *     trades ONLY while the market is choppy.
 *       BUY  when the close falls below the lower Bollinger band
 *            (20-day mean minus 2 standard deviations) AND 20-day ER < 0.25
 *            (choppy: the dip is likely to snap back, not the start of a slide)
 *       SELL when the close gets back up to the 20-day mean (the snap-back),
 *            or after MAX_HOLD days (a bounce that hasn't come in 10 days is
 *            not coming; do not get stuck in a trend that started)
 *   - Nothing tuned: Bollinger 20/2 and ER 20 are the textbook defaults;
 *     0.25 is the low-trendiness half of Kaufman's range; 10 days matches
 *     the lab's champion cooldown. All declared before running.
 *
 * WHY IT MIGHT WORK: this era has been range-bound (the user noticed BTC
 *   getting less volatile); a strategy built for range-bound markets, and
 *   disabled when trends are present, is the one design that fits it.
 * WHY IT MIGHT FAIL: a close below the lower band is a rare event; with the
 *   ER requirement on top it may trade a handful of times in two years, so
 *   the result would be noise. And a low ER measured over the 20 days that
 *   include the plunge itself is hard to get: a fast drop makes ER HIGH.
 *   The gate may block nearly every real dip.
 *
 * HOW TO CHANGE THINGS: tweak the constants below and re-run:
 *   node backtest/run.js strategies/2026-11-06-chop-harvester.js
 *   - BB_DAYS / BB_SIGMAS: the band; ER_DAYS / ER_MAX: how choppy to demand
 *   - MAX_HOLD: forced exit if the snap-back never comes
 * =============================================================================
 */

const BB_DAYS = 20;     // window for the mean and standard deviation
const BB_SIGMAS = 2;    // lower band = mean - this many standard deviations
const ER_DAYS = 20;     // efficiency-ratio window
const ER_MAX = 0.25;    // only buy when ER is BELOW this (choppy market)
const MAX_HOLD = 10;    // days; give up on a bounce that does not come

// Module-level state: when we bought (to count hold days).
let entryIndex = -1;
let lastIndexSeen = -1;

module.exports = {
  name: "Chop Harvester BB20/2 ER<0.25",
  description:
    "Range-bound mean reversion: buy a close below the lower Bollinger band only when the Efficiency Ratio says the market is choppy, sell at the 20-day mean or after 10 days",

  decide({ candles, index, position }) {
    const need = Math.max(BB_DAYS, ER_DAYS + 1);
    if (index < need) return "hold"; // warm-up

    // Fresh pass detection (engine re-run on same module) -> reset state.
    if (index <= lastIndexSeen) entryIndex = -1;
    lastIndexSeen = index;

    // ---- Bollinger statistics over the last BB_DAYS closes ------------------
    let sum = 0;
    for (let i = index - BB_DAYS + 1; i <= index; i++) sum += candles[i].close;
    const mean = sum / BB_DAYS;
    let sq = 0;
    for (let i = index - BB_DAYS + 1; i <= index; i++) sq += (candles[i].close - mean) ** 2;
    const lowerBand = mean - BB_SIGMAS * Math.sqrt(sq / BB_DAYS);

    const close = candles[index].close;

    // ---- In a trade: take the snap-back, or give up after MAX_HOLD days ----
    if (position === "btc") {
      if (close >= mean) return "sell";
      if (index - entryIndex >= MAX_HOLD) return "sell";
      return "hold";
    }

    // ---- In cash: is it a dip, and is the market choppy (not sliding)? -----
    if (close < lowerBand) {
      const net = Math.abs(close - candles[index - ER_DAYS].close);
      let travel = 0;
      for (let i = index - ER_DAYS + 1; i <= index; i++) {
        travel += Math.abs(candles[i].close - candles[i - 1].close);
      }
      const er = travel === 0 ? 0 : net / travel; // 0 = chop, 1 = straight line
      if (er < ER_MAX) {
        entryIndex = index;
        return "buy";
      }
    }
    return "hold";
  },
};
