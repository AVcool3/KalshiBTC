/**
 * =============================================================================
 * Strategy: Efficiency Ratio Trend Gate 20/0.3           — tried on 2026-11-05
 * =============================================================================
 * THE IDEA (only trust momentum when the market is actually trending):
 *   - The last four-era comparison showed trend/momentum systems made money
 *     in the older, trendy eras and lost in the current choppy one. If the
 *     regime is the whole story, a strategy that MEASURES trendiness and
 *     stays out when the market is choppy should keep the good and skip the
 *     bad. That is what Perry Kaufman's Efficiency Ratio (ER) is for:
 *         ER = |price change over N days| / (sum of |each day's change|)
 *     If price walked straight up (or down) ER is near 1.0 - every step
 *     counted. If it zig-zagged and ended up where it started, ER is near
 *     0 - lots of travel, no progress. Kaufman's own KAMA average is built
 *     on it; here we use it as a plain regime gate.
 *   - Rule (N = 20 days, gate = 0.3, Kaufman's mid-range):
 *       BUY  when ER > 0.3 (trending) AND the 20-day change is UP
 *       SELL when the 20-day change turns DOWN (trend reversed)
 *     In choppy stretches ER stays low, so no new entries happen; an open
 *     trade is only exited when the 20-day change turns negative.
 *   - Nothing tuned: N=20 and 0.3 are declared before the run.
 *
 * WHY IT MIGHT WORK: it targets the exact weakness found in the lab's
 *   trend-followers (whipsaw in chop) with a measurement, not a guess, and
 *   keeps their strength (riding clean trends).
 * WHY IT MIGHT FAIL: ER is computed over the same 20 days that already
 *   contain the trend, so it confirms trends late; and choppy periods often
 *   end with a violent breakout that a low-ER gate misses by construction.
 *
 * HOW TO CHANGE THINGS: tweak the constants below and re-run:
 *   node backtest/run.js strategies/2026-11-05-efficiency-ratio.js
 *   - ER_DAYS: window for the net-change and travel measures
 *   - ER_GATE: minimum trendiness to open a new position
 * =============================================================================
 */

const ER_DAYS = 20;   // lookback for net change and total travel
const ER_GATE = 0.3;  // need at least this much "straightness" to buy

module.exports = {
  name: "Efficiency Ratio Gate 20/0.3",
  description:
    "Regime-aware momentum: buy when the 20-day change is up AND Kaufman's Efficiency Ratio shows a clean trend (>0.3), sell when the 20-day change turns down",

  decide({ candles, index, position }) {
    if (index < ER_DAYS) return "hold"; // warm-up

    // Net progress over the window (signed) and total distance travelled.
    const net = candles[index].close - candles[index - ER_DAYS].close;
    let travel = 0;
    for (let i = index - ER_DAYS + 1; i <= index; i++) {
      travel += Math.abs(candles[i].close - candles[i - 1].close);
    }
    const er = travel === 0 ? 0 : Math.abs(net) / travel; // 0 = chop, 1 = straight line

    // Clean uptrend -> buy.
    if (position === "cash" && net > 0 && er > ER_GATE) return "buy";

    // The 20-day trend reversed -> get out (no ER requirement to exit).
    if (position === "btc" && net < 0) return "sell";

    return "hold";
  },
};
