/**
 * =============================================================================
 * Strategy: Dip in Uptrend (100d trend, RSI 40)          — tried on 2026-11-03
 * =============================================================================
 * THE IDEA (the classic "buy the pullback, but only in a bull market"):
 *   - The lab has tested dip-buying and trend-following separately, and
 *     both have the same flaw: dip-buyers (RSI +1.5%, red streaks, rubber
 *     band -26.6%) catch falling knives in downtrends; trend-followers buy
 *     late and sell late. The textbook fix is to COMBINE them: only buy a
 *     dip when the bigger trend is up, so you are buying weakness inside
 *     strength rather than weakness inside collapse.
 *   - Rules:
 *       TREND: close above the 100-day average = bull regime (dips allowed)
 *       BUY  : in a bull regime, 14-day RSI drops below 40 (a pullback)
 *       SELL : RSI recovers above 60 (bounce harvested), OR the close falls
 *              below the 100-day average (trend broke: abandon the dip trade)
 *   - Nothing here is tuned: 100 days is a round middle between the 50- and
 *     200-day lines; RSI 40/60 are the mild versions of the textbook 30/70
 *     (BTC rarely hits 30 in a bull market); 14 is Wilder's period.
 *
 * WHY IT MIGHT WORK: the trend gate removes the trades that killed the plain
 *   dip-buyers (dips inside bear markets), and the dip entry removes the
 *   late-entry problem of trend-followers.
 * WHY IT MIGHT FAIL: the trade count is tiny and each win is capped by the
 *   RSI-60 exit, while buy & hold in a bull market just keeps climbing; the
 *   strategy is out of the market most of the time, and every strategy that
 *   spent less time invested than buy & hold lost to it on this scoreboard
 *   until the champion (which is invested nearly always).
 *
 * HOW TO CHANGE THINGS: tweak the constants below and re-run:
 *   node backtest/run.js strategies/2026-11-03-dip-in-uptrend.js
 *   - TREND_DAYS: the trend filter's average length
 *   - RSI_PERIOD / BUY_BELOW / SELL_ABOVE: the dip and bounce thresholds
 * =============================================================================
 */

const TREND_DAYS = 100; // bull regime = close above this many days' average
const RSI_PERIOD = 14;  // Wilder's classic RSI length
const BUY_BELOW = 40;   // a pullback inside a bull market
const SELL_ABOVE = 60;  // bounce harvested

/** Average close of the TREND_DAYS days ending at `index`. */
function sma(candles, index, days) {
  let sum = 0;
  for (let i = index - days + 1; i <= index; i++) sum += candles[i].close;
  return sum / days;
}

/** RSI over the `period` days ending at `index` (same as the lab's RSI file). */
function rsi(candles, index, period) {
  let gains = 0;
  let losses = 0;
  for (let i = index - period + 1; i <= index; i++) {
    const change = candles[i].close - candles[i - 1].close;
    if (change > 0) gains += change;
    else losses -= change;
  }
  if (losses === 0) return 100;
  const rs = gains / period / (losses / period);
  return 100 - 100 / (1 + rs);
}

module.exports = {
  name: "Dip in Uptrend 100d/RSI40",
  description:
    "Trend-gated dip buying: in a bull regime (close above 100-day average) buy when RSI drops below 40, sell when RSI exceeds 60 or the trend breaks",

  decide({ candles, index, position }) {
    if (index + 1 < TREND_DAYS) return "hold"; // warm-up for the trend filter

    const close = candles[index].close;
    const bull = close > sma(candles, index, TREND_DAYS);
    const value = rsi(candles, index, RSI_PERIOD);

    // A pullback inside a bull market -> buy the dip.
    if (position === "cash" && bull && value < BUY_BELOW) return "buy";

    // Bounce harvested, or the trend itself failed -> get out.
    if (position === "btc" && (value > SELL_ABOVE || !bull)) return "sell";

    return "hold";
  },
};
