/**
 * =============================================================================
 * Strategy: Chaikin Money Flow 20                        — tried on 2026-11-04
 * =============================================================================
 * THE IDEA (volume weighted by WHERE the close landed in the day's range):
 *   - Marc Chaikin's Money Flow asks, for every day: did buyers or sellers
 *     WIN the day? Not by close-vs-yesterday (OBV's test) but by where the
 *     close sits inside that day's own high-low range:
 *       close at the high  -> +1 (buyers owned the day)
 *       close at the low   -> -1 (sellers owned the day)
 *       close mid-range    ->  0
 *     That "close location" is multiplied by the day's volume, summed over
 *     20 days, and divided by 20 days' total volume. Result: a number
 *     between -1 and +1 - positive = net accumulation, negative = net
 *     distribution, WITH big-volume days counting more.
 *   - Rule: hold BTC while CMF(20) is above +BAND; cash while below -BAND;
 *     between the bands, keep the current position (no churn near zero).
 *   - How this differs from earlier volume strategies: Volume Surge (-12%)
 *     reacted to single loud days, OBV (-44%) used only the sign of
 *     close-to-close change, and Hammer (-8%) used candle shape without
 *     volume. CMF is the first to fuse shape AND volume over a window.
 *
 * WHY IT MIGHT WORK: closing near the high on heavy volume is the textbook
 *   footprint of real accumulation, and the 20-day window smooths out the
 *   single-day noise that wrecked Volume Surge.
 * WHY IT MIGHT FAIL: crypto trades 24/7 so a "daily range" has no real
 *   close, volume is scattered across venues, and CMF is a trend-ish
 *   oscillator - the lab's whole momentum family sells after the drop and
 *   buys after the rally.
 *
 * HOW TO CHANGE THINGS: tweak the constants below and re-run:
 *   node backtest/run.js strategies/2026-11-04-chaikin-money-flow.js
 *   - CMF_DAYS: the accumulation window (20 is Chaikin's own)
 *   - BAND: dead zone around zero (0.05 is the common 'real signal' line)
 * =============================================================================
 */

const CMF_DAYS = 20;  // window for the money-flow sums
const BAND = 0.05;    // buy above +BAND, sell below -BAND

/** Chaikin Money Flow at `index`, from candles[index - CMF_DAYS + 1 .. index]. */
function cmf(candles, index) {
  let flow = 0;
  let volume = 0;
  for (let i = index - CMF_DAYS + 1; i <= index; i++) {
    const { high, low, close, volume: v } = candles[i];
    const range = high - low;
    // Close location value: +1 at the high, -1 at the low (0 on a flat candle).
    const clv = range === 0 ? 0 : ((close - low) - (high - close)) / range;
    flow += clv * v;
    volume += v;
  }
  return volume === 0 ? 0 : flow / volume;
}

module.exports = {
  name: "Chaikin Money Flow 20",
  description:
    "Volume weighted by close location: hold BTC while 20-day Chaikin Money Flow is above +0.05 (accumulation), cash while below -0.05 (distribution)",

  decide({ candles, index, position }) {
    if (index + 1 < CMF_DAYS) return "hold"; // warm-up

    const value = cmf(candles, index);

    // Net accumulation -> buyers keep winning the day -> be invested.
    if (value > BAND && position === "cash") return "buy";

    // Net distribution -> sellers keep winning the day -> stand aside.
    if (value < -BAND && position === "btc") return "sell";

    // Between the bands: keep whatever we hold.
    return "hold";
  },
};
