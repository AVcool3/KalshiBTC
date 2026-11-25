/**
 * =============================================================================
 * Strategy: Vol-Scaled Belt and Suspenders              — tried on 2026-11-25
 * =============================================================================
 * THE IDEA (marry the return-oriented lead to the risk-oriented survivor):
 *   - Belt and Suspenders (the lab's lower-risk survivor) holds BTC only while
 *     two alarms are quiet: the 200-day line (slow bears) and the fixed -5%
 *     crash-day breaker (fast cascades). It cuts drawdowns well on BTC
 *     (23-41% in the old eras), but its BTC-tuned -5% day does not transfer to
 *     more volatile coins, and it gives up most of the upside.
 *   - Yesterday's Vol-Scaled Breaker (sell when the close is more than
 *     0.75 x sigma x sqrt(30) below its 30-day peak, fixed 10-day clock)
 *     transferred to ETH and LTC on RETURN, but its drawdowns stayed huge
 *     (55-86%): it has no slow bear-market guard.
 *   - So combine them with nothing re-tuned. Hold the coin only while BOTH:
 *       (a) the 200-day line says bull (close more than 2% above the line,
 *           with the 2% hysteresis band exactly as in Belt and Suspenders), and
 *       (b) no vol-scaled drawdown cooldown is running (yesterday's rule,
 *           unchanged: trip line 0.75 x 60-day daily sigma x sqrt(30) below the
 *           30-day peak, then 10 days; the clock restarts while the trip holds).
 *     Either alarm means cash. The 200-day half needs 200 days of history.
 *   - Nothing tuned: every constant is copied from one of the two parents,
 *     and the whole rule was declared before running. The commit reports it
 *     on BTC and on seven more coins (BCH, ETC, XLM, LINK, ADA, DOGE, SOL)
 *     next to both parents and the champion.
 *
 * WHY IT MIGHT WORK: the line guards against the long grinds the breaker
 *   misses (2018, 2022); the scaled breaker handles fast crashes on any coin
 *   without a BTC-specific percentage; each covers the other's blind spot.
 * WHY IT MIGHT FAIL: stacking two alarms adds their false alarms; the 200-day
 *   line is slow to re-enter after a bottom, so the rule can miss most of a
 *   recovery, and it is out of the market a large share of the time.
 *
 * HOW TO CHANGE THINGS: tweak the constants below and re-run:
 *   node backtest/run.js strategies/2026-11-25-vol-scaled-belt.js
 *   - SMA_DAYS / BUFFER: the slow trend line and its hysteresis band
 *   - SIGMA_DAYS / PEAK_DAYS / K / COOLDOWN_DAYS: the scaled breaker
 * =============================================================================
 */

// --- 200-day line (Belt and Suspenders, unchanged) ---
const SMA_DAYS = 200;
const BUFFER = 0.02; // only flip regime on a clear 2% break of the line

// --- Vol-scaled drawdown breaker (yesterday's rule, unchanged) ---
const SIGMA_DAYS = 60;     // days of returns in the volatility estimate
const PEAK_DAYS = 30;      // the peak is the highest close in this many days
const K = 0.75;            // trip line = K x sigma x sqrt(PEAK_DAYS)
const COOLDOWN_DAYS = 10;  // fixed sit-out; restarts while the trip holds

// Module-level state (fine for this engine: one sequential pass).
let cooldownLeft = 0;
let lineBull = true; // current side of the 200-day line (with hysteresis)
let lastIndexSeen = -1;

/** Simple moving average of closes over `days` ending at `index`. */
function sma(candles, index, days) {
  let sum = 0;
  for (let i = index - days + 1; i <= index; i++) sum += candles[i].close;
  return sum / days;
}

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
  name: "Vol-Scaled Belt and Suspenders",
  description:
    "Belt and Suspenders with the breaker swapped for the vol-scaled drawdown breaker: hold only while price is above the 200-day line AND no scaled-breaker cooldown is running; either alarm means cash",

  decide({ candles, index, position }) {
    if (index + 1 < SMA_DAYS) return "hold"; // warm-up for the long average

    // Fresh pass detection (engine re-run on same module) -> reset state.
    if (index <= lastIndexSeen) { cooldownLeft = 0; lineBull = true; }
    lastIndexSeen = index;

    const close = candles[index].close;

    // ---- Alarm 1: vol-scaled drawdown breaker (fast crashes) ---------------
    const peak = recentPeak(candles, index);
    const drop = (peak - close) / peak;
    const tripLine = K * dailySigma(candles, index) * Math.sqrt(PEAK_DAYS);
    if (drop > tripLine) cooldownLeft = COOLDOWN_DAYS;
    else if (cooldownLeft > 0) cooldownLeft--;

    // ---- Alarm 2: the 200-day line (slow bears), with 2% hysteresis --------
    const line = sma(candles, index, SMA_DAYS);
    if (close > line * (1 + BUFFER)) lineBull = true;
    else if (close < line * (1 - BUFFER)) lineBull = false;
    // (between the bands: keep the previous regime)

    // ---- Hold only while BOTH say it is safe -------------------------------
    const safe = lineBull && cooldownLeft === 0;
    if (safe && position === "cash") return "buy";
    if (!safe && position === "btc") return "sell";
    return "hold";
  },
};
