/**
 * =============================================================================
 * Strategy: Drift t-Stat 60d (enter > 1, exit < 0)       — tried on 2026-11-16
 * =============================================================================
 * THE IDEA (momentum that asks "is the trend bigger than the noise?"):
 *   - Every momentum rule so far compared price to its own past (above the
 *     average, above a level, up over N days). None asked whether the move
 *     was statistically distinguishable from random noise. A +10% month on
 *     calm days is a real drift; a +10% month made of +8% and -7% days is
 *     almost nothing.
 *   - The t-statistic of the average daily return answers that:
 *         t = mean daily return / (stdev of daily returns / sqrt(N))
 *     Over N = 60 days, t = 1 means the average day is up by one standard
 *     error; t = 2 is the classic "significant" bar. It is return per unit
 *     of noise: a cousin of a trailing Sharpe ratio.
 *   - Rule with a built-in dead zone (hysteresis) so it does not chatter:
 *       BUY  when t rises above ENTER_T (1.0): drift is clearly positive
 *       SELL when t falls below EXIT_T  (0.0): drift has turned negative
 *     Between 0 and 1, keep whatever position we hold.
 *   - Nothing tuned: 60 days (about two months of data), thresholds 1 and 0
 *     are the natural round values; declared before running.
 *
 * WHY IT MIGHT WORK: it ignores big-but-noisy moves, which is where simple
 *   momentum rules get faked out, and it demands persistence of direction.
 * WHY IT MIGHT FAIL: it is still a lagging, return-based momentum rule in
 *   an era that has punished every one of those; with N = 60 the t-stat
 *   itself has wide noise, and it only gets strong AFTER a trend has been
 *   running for weeks (buys late), then lags on the way down (sells late).
 *
 * HOW TO CHANGE THINGS: tweak the constants below and re-run:
 *   node backtest/run.js strategies/2026-11-16-drift-tstat.js
 *   - WINDOW: days of returns in the estimate
 *   - ENTER_T / EXIT_T: the buy and sell thresholds (the gap is the dead zone)
 * =============================================================================
 */

const WINDOW = 60;   // daily returns used in the estimate
const ENTER_T = 1.0; // buy above this t-statistic
const EXIT_T = 0.0;  // sell below this t-statistic

/** t-statistic of the mean daily return over the WINDOW days ending at `index`. */
function driftT(candles, index) {
  const rets = [];
  for (let i = index - WINDOW + 1; i <= index; i++) {
    rets.push((candles[i].close - candles[i - 1].close) / candles[i - 1].close);
  }
  const mean = rets.reduce((a, b) => a + b, 0) / WINDOW;
  const variance = rets.reduce((a, r) => a + (r - mean) ** 2, 0) / (WINDOW - 1);
  const stdErr = Math.sqrt(variance / WINDOW);
  return stdErr === 0 ? 0 : mean / stdErr;
}

module.exports = {
  name: "Drift t-Stat 60d (1/0)",
  description:
    "Risk-adjusted momentum: buy when the 60-day t-statistic of average daily return exceeds 1 (drift beats noise), sell when it drops below 0, hold in between",

  decide({ candles, index, position }) {
    if (index < WINDOW) return "hold"; // warm-up: need WINDOW returns

    const t = driftT(candles, index);

    if (position === "cash" && t > ENTER_T) return "buy";
    if (position === "btc" && t < EXIT_T) return "sell";
    return "hold";
  },
};
