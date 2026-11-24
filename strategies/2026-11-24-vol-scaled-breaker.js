/**
 * =============================================================================
 * Strategy: Vol-Scaled Drawdown Breaker (0.75 x sigma x sqrt(30), 10d clock)
 *                                                        — tried on 2026-11-24
 * =============================================================================
 * THE IDEA (make the breaker's trigger scale itself to the asset):
 *   - Yesterday's out-of-sample test put the Tight Drawdown Breaker (exit when
 *     the close is more than 10% below its 30-day peak, then a fixed 10-day
 *     clock) on ETH-USD instead of BTC. Its BTC-flat drawdowns (30-39% in
 *     every era) did not transfer: ETH's came out 30-61%. ETH moves about
 *     twice as much as BTC, so a "10% drop" is an ordinary Tuesday there but
 *     a real correction on BTC. A fixed percentage is calibrated to one
 *     asset's volatility.
 *   - Fix: express the line in units of volatility instead of percent.
 *       sigma = standard deviation of the last 60 daily returns (today
 *               included; no future data)
 *       A 30-day window of daily moves typically wanders about
 *       sigma x sqrt(30) from its start, so the trigger is a fraction of that:
 *           trip when the close is more than 0.75 x sigma x sqrt(30)
 *           below the highest close of the last 30 days
 *     At BTC's usual ~2.4% daily sigma this lands almost exactly on 10%
 *     (0.75 x 2.4% x 5.48 = 9.9%), so on BTC it should behave like the
 *     fixed rule; on ETH (sigma ~3.5-4%) the line widens to ~15%. Everything
 *     else is yesterday's mechanics: invested by default; sell on a trip;
 *     fixed 10-day clock that restarts while the trip holds; then buy back
 *     unconditionally.
 *   - Nothing tuned: 0.75 was fixed by the arithmetic above (to match the
 *     10% rule on BTC) BEFORE running, and 60 / 30 / 10 days are the same
 *     windows used throughout. The commit reports BTC (five eras) and ETH
 *     (four eras) next to yesterday's fixed rule.
 *
 * WHY IT MIGHT WORK: if the failure on ETH was purely about scale, a
 *   scale-free trigger should reproduce BTC-like protection on any coin.
 * WHY IT MIGHT FAIL: sigma is a trailing estimate that jumps AFTER a
 *   crash starts, so the line widens just when we want it tight (the
 *   earlier Relative Breaker test showed this on BTC). And the difference
 *   between BTC and ETH may not be just scale: ETH's deep-bear era (-94%)
 *   was nearly twice as deep.
 *
 * HOW TO CHANGE THINGS: tweak the constants below and re-run:
 *   node backtest/run.js strategies/2026-11-24-vol-scaled-breaker.js
 *   - SIGMA_DAYS: how many days of returns define volatility
 *   - PEAK_DAYS: how far back the recent peak looks
 *   - K: fraction of sigma x sqrt(PEAK_DAYS) that trips the breaker
 *   - COOLDOWN_DAYS: the fixed sit-out
 * =============================================================================
 */

const SIGMA_DAYS = 60;     // days of returns in the volatility estimate
const PEAK_DAYS = 30;      // the peak is the highest close in this many days
const K = 0.75;            // trip line = K x sigma x sqrt(PEAK_DAYS)
const COOLDOWN_DAYS = 10;  // fixed sit-out; restarts while the trip condition holds

// Module-level state (fine for this engine: one sequential pass).
let cooldownLeft = 0;
let lastIndexSeen = -1;

/** Highest close over the PEAK_DAYS days ending at `index` (today included). */
function recentPeak(candles, index) {
  let peak = -Infinity;
  for (let i = Math.max(0, index - PEAK_DAYS + 1); i <= index; i++) {
    peak = Math.max(peak, candles[i].close);
  }
  return peak;
}

/** Standard deviation of the SIGMA_DAYS daily returns ending at `index`. */
function dailySigma(candles, index) {
  const rets = [];
  for (let i = index - SIGMA_DAYS + 1; i <= index; i++) {
    rets.push((candles[i].close - candles[i - 1].close) / candles[i - 1].close);
  }
  const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
  const variance = rets.reduce((a, r) => a + (r - mean) ** 2, 0) / rets.length;
  return Math.sqrt(variance);
}

module.exports = {
  name: "Vol-Scaled Breaker 0.75sd x sqrt30 + 10d clock",
  description:
    "Scale-free drawdown breaker: sell when the close is more than 0.75 x (60-day daily sigma) x sqrt(30) below its 30-day peak (about 10% on BTC), fixed 10-day clock, then buy back",

  decide({ candles, index, position }) {
    // Fresh pass detection (engine re-run on same module) -> reset state.
    if (index <= lastIndexSeen) cooldownLeft = 0;
    lastIndexSeen = index;

    // Until we have a volatility estimate there is nothing to trip: be invested.
    if (index < SIGMA_DAYS) return position === "cash" ? "buy" : "hold";

    const peak = recentPeak(candles, index);
    const drop = (peak - candles[index].close) / peak;
    const tripLine = K * dailySigma(candles, index) * Math.sqrt(PEAK_DAYS);

    // ---- Tripped: too far below the recent peak FOR THIS ASSET'S volatility ----
    if (drop > tripLine) {
      cooldownLeft = COOLDOWN_DAYS;
      if (position === "btc") return "sell";
      return "hold"; // already in cash; the clock restarts
    }

    // ---- Cooling down -----------------------------------------------------------
    if (cooldownLeft > 0) {
      cooldownLeft--;
      return "hold";
    }

    // ---- Clear: be invested (the default state) ----------------------------------
    if (position === "cash") return "buy";
    return "hold";
  },
};
