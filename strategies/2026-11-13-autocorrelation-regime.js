/**
 * =============================================================================
 * Strategy: Autocorrelation Regime 40d                   — tried on 2026-11-13
 * =============================================================================
 * THE IDEA (is the market currently trending or mean-reverting day to day?):
 *   - Lag-1 AUTOCORRELATION asks one statistical question about the last N
 *     daily returns: does today's return tend to have the SAME sign as
 *     yesterday's (positive autocorrelation = momentum: up days follow up
 *     days, down days follow down days), or the OPPOSITE sign (negative =
 *     mean reversion: every move gets partly undone the next day)?
 *   - The lab has measured regimes two other ways (Kaufman's Efficiency
 *     Ratio over 20 days; volatility level). Autocorrelation is a third,
 *     different statistic: it reads the day-to-day serial structure rather
 *     than the net path or the size of moves.
 *   - Rule: compute the correlation between each day's return and the
 *     previous day's return over the last WINDOW (40) days.
 *       correlation > 0  (momentum regime)       -> hold BTC
 *       correlation <= 0 (reversal/noise regime) -> cash
 *     Nothing else: no price level, no average, no stop.
 *   - Nothing tuned: 40 days is two trading-month-equivalents; the
 *     threshold is the natural zero. Declared before running.
 *
 * WHY IT MIGHT WORK: if returns have regime-dependent persistence, being
 *   invested only when they persist harvests momentum and avoids the
 *   whipsaw regime that hurts trend followers.
 * WHY IT MIGHT FAIL: with 40 observations, a sample correlation has
 *   standard error of about 0.16 - it flips sign on noise alone, so the
 *   signal may be a coin flip dressed up as a statistic. It also ignores
 *   DIRECTION: a persistent crash is a "momentum regime" too, so this can
 *   hold BTC straight down a cliff.
 *
 * HOW TO CHANGE THINGS: tweak the constants below and re-run:
 *   node backtest/run.js strategies/2026-11-13-autocorrelation-regime.js
 *   - WINDOW: number of return pairs in the estimate (longer = steadier)
 *   - THRESHOLD: required correlation to be long (0 = any positive)
 * =============================================================================
 */

const WINDOW = 40;     // return pairs used for the correlation
const THRESHOLD = 0;   // hold BTC while autocorrelation is above this

/** Close-to-close return on day i. */
function ret(candles, i) {
  return (candles[i].close - candles[i - 1].close) / candles[i - 1].close;
}

/** Lag-1 autocorrelation of daily returns over the WINDOW days ending at `index`. */
function autocorr(candles, index) {
  const xs = []; // yesterday's returns
  const ys = []; // today's returns
  for (let i = index - WINDOW + 1; i <= index; i++) {
    xs.push(ret(candles, i - 1));
    ys.push(ret(candles, i));
  }
  const mx = xs.reduce((a, b) => a + b, 0) / WINDOW;
  const my = ys.reduce((a, b) => a + b, 0) / WINDOW;
  let cov = 0, vx = 0, vy = 0;
  for (let k = 0; k < WINDOW; k++) {
    cov += (xs[k] - mx) * (ys[k] - my);
    vx += (xs[k] - mx) ** 2;
    vy += (ys[k] - my) ** 2;
  }
  return vx === 0 || vy === 0 ? 0 : cov / Math.sqrt(vx * vy);
}

module.exports = {
  name: "Autocorrelation Regime 40d",
  description:
    "Serial-structure regime switch: hold BTC while the 40-day lag-1 autocorrelation of daily returns is positive (momentum regime), cash while it is zero or negative",

  decide({ candles, index, position }) {
    if (index < WINDOW + 1) return "hold"; // warm-up: need WINDOW pairs of returns

    const momentumRegime = autocorr(candles, index) > THRESHOLD;

    if (momentumRegime && position === "cash") return "buy";
    if (!momentumRegime && position === "btc") return "sell";
    return "hold";
  },
};
