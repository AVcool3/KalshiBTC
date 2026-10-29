/**
 * =============================================================================
 * Strategy: Parabolic SAR 0.02/0.2                       — tried on 2026-10-29
 * =============================================================================
 * THE IDEA (Welles Wilder's "stop and reverse", 1978):
 *   - The Parabolic SAR is a trailing stop that ACCELERATES. While in an
 *     uptrend, the SAR dot sits below price and creeps upward every day;
 *     the longer the trend runs and the more new highs it makes, the faster
 *     the dot catches up (the "acceleration factor", AF, grows by a small
 *     step each time price makes a new high, up to a cap). The moment
 *     price TOUCHES the dot, the trend is declared over and the system
 *     flips to a downtrend (dot jumps above price, trailing it down).
 *   - Our long/cash version: hold BTC while the SAR says "uptrend", sit
 *     in cash while it says "downtrend". Wilder's original is always in
 *     the market (long or short); we only take the long side.
 *   - How this differs from the Chandelier Exit (+25.4%, a FIXED 3xATR
 *     trailing stop): the SAR's stop tightens faster the longer a trend
 *     lasts, so it gives young trends lots of room and old ones very
 *     little. It also reverses immediately instead of waiting for a
 *     separate re-entry signal.
 *
 * WHY IT MIGHT WORK: it is a pure trend-follower with a built-in exit and a
 *   built-in re-entry; it never needs a parameter for "how long a trend".
 * WHY IT MIGHT FAIL: the accelerating stop is TOO impatient for BTC - it
 *   tightens just as a healthy trend digests gains with ordinary pullbacks,
 *   getting stopped out of the middle of the move and re-entering after
 *   the next reversal. SAR is famous for whipsaw in non-trending markets.
 *
 * HOW TO CHANGE THINGS: tweak the constants below and re-run:
 *   node backtest/run.js strategies/2026-10-29-parabolic-sar.js
 *   - AF_START / AF_STEP: how fast the stop accelerates (smaller = patient)
 *   - AF_MAX: the cap on acceleration (0.2 is Wilder's classic)
 * =============================================================================
 */

const AF_START = 0.02; // initial acceleration factor
const AF_STEP = 0.02;  // added each time a new extreme is made
const AF_MAX = 0.2;    // acceleration never exceeds this

// ---------------------------------------------------------------------------
// SAR is a recursive series: today's dot depends on yesterday's dot. Compute
// it once per pass and cache. trend[i] and sar[i] depend only on
// candles[0..i], so reading them at `index` has no lookahead.
// ---------------------------------------------------------------------------
let cache = null; // { length, uptrend: [bool, ...] }

function computeSar(candles) {
  const uptrend = new Array(candles.length).fill(true);

  // Start long: first dot at the first candle's low, extreme point = its high.
  let isUp = true;
  let sar = candles[0].low;
  let extreme = candles[0].high; // highest high (uptrend) / lowest low (downtrend)
  let af = AF_START;

  for (let i = 1; i < candles.length; i++) {
    // Today's dot = yesterday's dot moved a fraction AF toward the extreme.
    sar = sar + af * (extreme - sar);

    if (isUp) {
      // The dot may never sit above the last two lows (it must stay under price).
      sar = Math.min(sar, candles[i - 1].low, i >= 2 ? candles[i - 2].low : candles[i - 1].low);
      if (candles[i].low < sar) {
        // Price touched the dot -> uptrend over -> flip to downtrend.
        isUp = false;
        sar = extreme;            // the dot jumps to the old peak
        extreme = candles[i].low; // new extreme point: lowest low
        af = AF_START;
      } else if (candles[i].high > extreme) {
        extreme = candles[i].high; // new high -> accelerate the stop
        af = Math.min(af + AF_STEP, AF_MAX);
      }
    } else {
      // Mirror image: in a downtrend the dot may never sit below the last two highs.
      sar = Math.max(sar, candles[i - 1].high, i >= 2 ? candles[i - 2].high : candles[i - 1].high);
      if (candles[i].high > sar) {
        // Price touched the dot from below -> downtrend over -> flip to uptrend.
        isUp = true;
        sar = extreme;             // the dot jumps to the old trough
        extreme = candles[i].high; // new extreme point: highest high
        af = AF_START;
      } else if (candles[i].low < extreme) {
        extreme = candles[i].low;
        af = Math.min(af + AF_STEP, AF_MAX);
      }
    }
    uptrend[i] = isUp;
  }
  return { length: candles.length, uptrend };
}

module.exports = {
  name: "Parabolic SAR 0.02/0.2",
  description:
    "Wilder's accelerating trailing stop: hold BTC while the SAR dot trails below price (uptrend), cash after price touches the dot and the trend flips",

  decide({ candles, index, position }) {
    if (index < 5) return "hold"; // warm-up so the first dots settle

    if (!cache || cache.length !== candles.length) cache = computeSar(candles);

    const up = cache.uptrend[index];
    if (up && position === "cash") return "buy";
    if (!up && position === "btc") return "sell";
    return "hold";
  },
};
