/**
 * =============================================================================
 * Strategy: Keltner Channel 20/2x10                      — tried on 2026-10-21
 * =============================================================================
 * THE IDEA (the last untested channel system):
 *   - The lab has tried two kinds of price channel:
 *       Donchian  - bands at the raw N-day HIGH and LOW (best classic so far)
 *       Bollinger - bands at +/- 2 standard deviations (the squeeze, 0% wins)
 *     The KELTNER CHANNEL (Chester Keltner, 1960) is the third classic:
 *     a 20-day EMA center line with bands placed 2 ATRs above and below.
 *     ATR (average true range) is the average size of a day's full travel,
 *     so the bands breathe with volatility like Bollinger's - but ATR moves
 *     slower and smoother than standard deviation, which supposedly means
 *     fewer head-fakes at the exact moment volatility regime shifts.
 *   - Rules, as the textbooks teach them:
 *       BUY  when the close breaks ABOVE the upper band (price escaped the
 *            'normal travel' envelope upward = genuine trend thrust)
 *       SELL when the close falls back BELOW the center EMA (trend over,
 *            don't wait for the lower band and give the whole move back)
 *
 * WHY IT MIGHT WORK: Donchian 20/10 (+40.5%) proved breakout entries can
 *   work on BTC; Keltner's entry is a volatility-scaled version of the same
 *   thrust detector, and its EMA exit cuts losers faster than Donchian's
 *   10-day-low exit did.
 * WHY IT MIGHT FAIL: the squeeze experiment showed Bollinger-style
 *   volatility bands produced 0 winning trades here, and an EMA exit may
 *   be TOO twitchy for BTC's noisy daily closes - shaken out of every
 *   trend it correctly enters, like the MACD (-36%) was.
 *
 * HOW TO CHANGE THINGS: tweak the constants below and re-run:
 *   node backtest/run.js strategies/2026-10-21-keltner-channel.js
 *   - EMA_DAYS: the center line (20 is classic)
 *   - ATR_DAYS: the volatility window (10 is Keltner's own choice)
 *   - BAND_ATRS: how many ATRs out the entry band sits (2 is classic)
 * =============================================================================
 */

const EMA_DAYS = 20;  // center line: 20-day exponential moving average
const ATR_DAYS = 10;  // average true range window
const BAND_ATRS = 2;  // upper band = EMA + this many ATRs

// ---------------------------------------------------------------------------
// EMA and ATR are cumulative series, so compute them once per pass and cache.
// ema[i] / atr[i] depend only on candles[0..i], so reading them at `index`
// has no lookahead. Same caching pattern as the MACD and OBV strategies.
// ---------------------------------------------------------------------------
let cache = null; // { length, ema: [...], atr: [...] }

function computeSeries(candles) {
  const ema = [candles[0].close];
  const kEma = 2 / (EMA_DAYS + 1); // standard EMA smoothing factor

  // True range: today's full travel, counting any gap from yesterday's close.
  const tr = [candles[0].high - candles[0].low];
  const atr = [tr[0]];
  const kAtr = 1 / ATR_DAYS; // Wilder-style smoothing for ATR

  for (let i = 1; i < candles.length; i++) {
    ema.push(candles[i].close * kEma + ema[i - 1] * (1 - kEma));
    const range = Math.max(
      candles[i].high - candles[i].low,
      Math.abs(candles[i].high - candles[i - 1].close),
      Math.abs(candles[i].low - candles[i - 1].close)
    );
    tr.push(range);
    atr.push(range * kAtr + atr[i - 1] * (1 - kAtr));
  }
  return { length: candles.length, ema, atr };
}

module.exports = {
  name: "Keltner Channel 20/2x10",
  description:
    "The third classic channel: buy a close above the 20-day EMA + 2 ATR band (volatility-scaled thrust), sell a close back below the EMA center line",

  decide({ candles, index, position }) {
    // Warm-up: let the EMA and ATR converge before trusting them.
    if (index < EMA_DAYS + ATR_DAYS) return "hold";

    if (!cache || cache.length !== candles.length) cache = computeSeries(candles);

    const close = candles[index].close;
    const upperBand = cache.ema[index] + BAND_ATRS * cache.atr[index];

    // Close escaped the normal-travel envelope upward -> trend thrust -> buy.
    if (position === "cash" && close > upperBand) return "buy";

    // Close back under the center line -> the thrust is spent -> stand aside.
    if (position === "btc" && close < cache.ema[index]) return "sell";

    return "hold";
  },
};
